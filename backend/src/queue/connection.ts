import { connect, type Channel, type ChannelModel, type ConfirmChannel, type RecoveringChannelModel } from 'amqplib'
import { config } from '../config'
import { declareTopology } from './topology'

// One connection to RabbitMQ per process, kept alive by amqplib's built-in
// recovery. When the connection drops, amqplib reconnects on its own: 1 s, 2 s,
// 4 s … up to 30 s between tries, each a little random, so several API copies
// that lost RabbitMQ at the same moment don't all knock at the same instant.
//
// What recovery does NOT do is bring back channels or consumers — they die with
// the old connection. So setup() below runs after every successful connect: it
// opens a fresh confirm channel, declares the topology again (which also
// rebuilds a RabbitMQ that came back empty), and starts this process's own
// consumers again: the API's relay, and from Step 4 the worker.

// Starts a process's consumers on a fresh connection. Runs on every
// (re)connect, after the topology exists and before publishing opens. It gets
// the new connection's publish channel too, for consumers that publish as part
// of their work (the worker sends failed jobs to snap.retry.wait).
export type OnConnect = (model: ChannelModel, publish: ConfirmChannel) => Promise<void>

// The kinds of error amqplib hands us. `code` is a string for network errors
// ('ECONNREFUSED', with an empty message) and a number for an AMQP refusal
// inside setup() (406). A refused login has no code; it's only in the message.
type AmqpError = Error & { code?: string | number }

let connection: RecoveringChannelModel | null = null
let publishChannel: ConfirmChannel | null = null
let stopping = false

// The channel to publish on, or null while there's no working connection.
export function getPublishChannel(): ConfirmChannel | null {
    return publishChannel
}

// `clientName` shows in the web UI's Connections tab, e.g. snap-api@<pod name>.
// `onReady` runs after each connection amqplib has accepted — setup done, its
// own watching in place — never for an attempt that failed half-way.
export async function connectQueue(clientName: string, onConnect?: OnConnect, onReady?: () => void): Promise<void> {
    connection = await connect(config.rabbitmqUrl, {
        clientProperties: { connection_name: `${clientName}@${config.instanceId}` },
        recovery: {
            // Resolve right away instead of waiting for RabbitMQ to answer, so the
            // HTTP server starts even while RabbitMQ is down.
            waitForConnect: false,
            initialDelay: 1_000,
            maxDelay: 30_000,

            // Runs after every successful (re)connect, before 'connect' fires. If
            // it throws, amqplib closes that connection and tries again later.
            setup: createSetup(onConnect),
        },
    })

    connection.on('connect', () => {
        console.log('RabbitMQ connected, topology declared')
        onReady?.()
    })

    connection.on('disconnect', (err: AmqpError) => {
        console.warn(`RabbitMQ disconnected: ${describe(err)}`)
    })

    connection.on('connect-failed', onConnectFailed)

    connection.on('reconnect-scheduled', ({ attempt, delay }) => {
        console.warn(`RabbitMQ: retry ${attempt} in ${(delay / 1000).toFixed(1)} s`)
    })

    // Recovery passes connection errors on here. Without a listener they would
    // crash the process; 'disconnect' follows and logs the same thing.
    connection.on('error', () => {})
}

// What runs on every fresh connection, before amqplib hands it over. Its own
// function so a test can drive it with a fake connection (connection.test.ts).
export function createSetup(onConnect?: OnConnect): (model: ChannelModel) => Promise<void> {
    return async (model: ChannelModel) => {
        // amqplib only starts watching this connection after setup() has
        // returned, so watch it ourselves meanwhile:
        //   - 'error': the connection passes socket errors on as an 'error'
        //     event, and an 'error' event that nobody listens to crashes the
        //     process. Note it and carry on: the close follows, and the step
        //     in progress fails.
        //   - 'close': fail this attempt even if every step had succeeded,
        //     and amqplib connects again.
        let closedDuringSetup = false
        const onClose = () => { closedDuringSetup = true }
        const onError = (err: AmqpError) => { console.warn(`⚠️ RabbitMQ error during setup: ${describe(err)}`) }
        model.once('close', onClose)
        model.on('error', onError)

        try {
            // Step 1: The channel to publish on, in confirm mode.
            const channel = await model.createConfirmChannel()
            watchChannel(model, channel, 'publish')
            channel.on('close', () => {
                if (channel === publishChannel) publishChannel = null
            })

            // Step 2: Every exchange, queue and binding from section 5.
            await declareTopology(channel)

            // Step 3: This process's consumers, BEFORE publishing opens. An
            // event published before this copy's realtime queue is bound
            // could match no binding at all and land in snap.unrouted,
            // which is there to catch typos, not real events.
            if (onConnect) await onConnect(model, channel)

            // Step 4: Open for publishing — unless the connection closed
            // meanwhile: then this attempt failed, and amqplib tries again.
            if (closedDuringSetup) throw new Error('RabbitMQ connection closed during setup')
            publishChannel = channel
        } finally {
            // Safe to stop here: between setup() returning and amqplib adding
            // its own listeners there is no waiting, so no event can arrive.
            model.off('close', onClose)
            model.off('error', onError)
        }
    }
}

// Runs every time a connection attempt fails: RabbitMQ unreachable, a refused
// login, or setup() throwing (a queue whose settings changed: 406). Return, and
// amqplib tries again after the backoff delay. Call process.exit(1) to give up.
function onConnectFailed(err: AmqpError): void {
    // Step 1: A setup mistake: a wrong password, or a queue whose settings
    // changed. Waiting can't fix either, so stop loudly, like a missing S3_*
    // variable does. In Kubernetes the crash stops a bad rollout, and a restart
    // reads the Secret again, which fixes a password changed while running.
    const setupMistake = err.code === 406 || err.message.includes('ACCESS-REFUSED')

    if (setupMistake) {
        console.error(`❌ RabbitMQ setup mistake, stopping: ${describe(err)}`)
        process.exit(1)
    }

    // Step 2: Anything else is the network or RabbitMQ being down: log the
    // reason and return. amqplib retries, and 'reconnect-scheduled' logs when.
    console.warn(`⚠️ RabbitMQ connect failed: ${describe(err)}`)
}

// Every channel gets this, the publish channel and each consumer's.
//
// A channel error with no listener crashes the whole process; 'close' always
// follows, and that's where we act. A channel can die while the connection is
// fine: say someone deleted snap.events in the web UI and the next publish hit
// the hole. Recovery only watches the connection, so close it too: amqplib
// reconnects and setup() rebuilds everything. If the connection is already
// gone this is a no-op.
export function watchChannel(model: ChannelModel, channel: Channel, name: string): void {
    channel.on('error', (err: AmqpError) => {
        console.warn(`⚠️ RabbitMQ ${name} channel error: ${describe(err)}`)
    })

    channel.on('close', () => {
        if (!stopping) model.close().catch(() => {})
    })
}

// Stops recovery and closes the connection; its channels go with it.
export async function closeQueue(): Promise<void> {
    stopping = true
    publishChannel = null
    await connection?.close()
}

// Network errors come with an empty message and only a code.
function describe(err: AmqpError): string {
    return err.message || String(err.code)
}
