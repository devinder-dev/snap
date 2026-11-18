// `bun run dead-letters <list|replay|purge>`: snap.dead.queue, by hand
// (SCALING-PLAN.md section 8).
//
//   list    show what's parked and why; it stays parked
//   replay  send every parked job back to the worker, attempt count reset to 1
//   purge   delete every parked job for good
//
// Look first, always: list (and the worker's DEAD-LETTERED log line) tells you
// why a job died. Replay once the cause is fixed; purge what can never succeed.
// Either way nothing is lost: the sweep deletes any expired snap whose job is gone.

import { connect, type ConfirmChannel } from 'amqplib'
import { config } from '../src/config'
import { jobProperties, readAttempt } from '../src/queue/attempts'
import { publishDelivered } from '../src/queue/delivered'
import { QUEUES } from '../src/queue/topology'

const COMMANDS = ['list', 'replay', 'purge']
const command = process.argv[2] ?? ''

if (!COMMANDS.includes(command)) {
    console.error('Usage: bun run dead-letters <list|replay|purge>')
    process.exit(1)
}

// Step 1: Connect. No recovery here: a script that can't reach RabbitMQ should
// just fail and say so.
const connection = await connect(config.rabbitmqUrl, {
    clientProperties: { connection_name: `dead-letters@${config.instanceId}` },
})
const channel = await connection.createConfirmChannel()

try {
    // Step 2: How many are parked. A passive check: it never creates the queue.
    const { messageCount } = await channel.checkQueue(QUEUES.dead)

    // Step 3: The command.
    if (command === 'list') await list(channel, messageCount)
    if (command === 'replay') await replay(channel, messageCount)
    if (command === 'purge') {
        const { messageCount: purged } = await channel.purgeQueue(QUEUES.dead)
        console.log(`🗑️ Purged ${purged} message(s) from ${QUEUES.dead}`)
    }
} finally {
    // Step 4: The channel first, then the connection. Closing the channel waits
    // for RabbitMQ's answer, and RabbitMQ handles a channel's frames in order,
    // so the last ack is processed before it. Closing only the connection can
    // overtake that ack, and the replayed job would stay parked as well (seen in
    // testing). Closing also hands back anything taken but not acked (list).
    await channel.close()
    await connection.close()
}

// AMQP has no "peek". So take each message without acking it, print it, and
// let the connection close put them all back where they were. They come back
// marked "redelivered", which is harmless.
async function list(channel: ConfirmChannel, count: number): Promise<void> {
    if (count === 0) {
        console.log(`✅ ${QUEUES.dead} is empty`)
        return
    }

    console.log(`${count} message(s) in ${QUEUES.dead}:`)
    for (let i = 1; i <= count; i++) {
        const msg = await channel.get(QUEUES.dead, { noAck: false })
        if (!msg) break

        // The newest x-death entry says how it got here: 'rejected' by the
        // worker, or 'expired'/'maxlen' by a queue limit.
        const death = msg.properties.headers?.['x-death']?.[0]
        console.log(`  ${i}. ${msg.content.toString()}`)
        console.log(`     attempts: ${readAttempt(msg)}, reason: ${death?.reason ?? '?'}, `
            + `from: ${death?.queue ?? '?'}, messageId: ${msg.properties.messageId ?? '?'}`)
    }
}

// Each job goes straight back into the work queue, snap.expire.queue, as
// attempt 1 — by name, through the default exchange. Publish, wait until that
// queue really has it, then ack the parked copy: if anything fails in between,
// the parked copy is still there. (Not through the snap.expire exchange: any
// other queue bound there, say one added to watch traffic, would also count as
// "delivered" while the work queue itself was missing.)
//
// Only the `count` jobs that were parked when it started: a job that fails
// again at once and comes straight back isn't replayed in a loop.
async function replay(channel: ConfirmChannel, count: number): Promise<void> {
    let replayed = 0

    for (let i = 0; i < count; i++) {
        const msg = await channel.get(QUEUES.dead, { noAck: false })
        if (!msg) break

        try {
            await publishDelivered(channel, '', QUEUES.expire, msg.content, jobProperties(msg, 1))
        } catch (err) {
            // Not acked, so closing the channel puts this job back where it was.
            const why = err instanceof Error ? err.message : String(err)
            console.error(`❌ Replay stopped after ${replayed} job(s): ${why}. `
                + `The rest stay parked. Does ${QUEUES.expire} exist?`)
            process.exitCode = 1
            return
        }

        channel.ack(msg)
        replayed++
    }

    console.log(`✅ Replayed ${replayed} job(s) to ${QUEUES.expire}; a running worker picks them up now`)
}
