import { connect, type ChannelModel, type ConfirmChannel, type RecoveringChannelModel } from 'amqplib'
import { config } from '../config'
import { declareTopology } from './topology'

// One connection to RabbitMQ per process, kept alive by amqplib's built-in
// recovery. When the connection drops, amqplib reconnects on its own: 1 s, 2 s,
// 4 s … up to 30 s between tries, each a little random, so several API copies
// that lost RabbitMQ at the same moment don't all knock at the same instant.
//
// What recovery does NOT do is bring back channels — they die with the old
// connection. So setup() below runs after every successful connect: it opens a
// fresh confirm channel and declares the topology again, which also rebuilds a
// RabbitMQ that came back empty.

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
export async function connectQueue(clientName: string): Promise<void> {
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
            async setup(model: ChannelModel) {
                const channel = await model.createConfirmChannel()

                // A channel error with no listener crashes the whole process.
                // 'close' always follows, and that's where we act.
                channel.on('error', (err: AmqpError) => {
                    console.warn(`RabbitMQ channel error: ${describe(err)}`)
                })

                channel.on('close', () => {
                    if (channel !== publishChannel) return
                    publishChannel = null

                    // The channel can die while the connection is fine — say
                    // someone deleted snap.events in the web UI and the next
                    // publish hit the hole. Recovery only watches the connection,
                    // so close it too: amqplib reconnects and setup() rebuilds
                    // everything. If the connection is already gone this is a no-op.
                    if (!stopping) model.close().catch(() => {})
                })

                await declareTopology(channel)
                publishChannel = channel
            },
        },
    })

    connection.on('connect', () => {
        console.log('RabbitMQ connected, topology declared')
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

// Stops recovery and closes the connection; its channel goes with it.
export async function closeQueue(): Promise<void> {
    stopping = true
    publishChannel = null
    await connection?.close()
}

// Network errors come with an empty message and only a code.
function describe(err: AmqpError): string {
    return err.message || String(err.code)
}
