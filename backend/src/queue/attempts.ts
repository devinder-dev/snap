import type { Message, Options } from 'amqplib'

// The attempt counter every snap job carries (SCALING-PLAN.md 7.3). Our own
// header, not RabbitMQ's x-death: x-death also records the 24-hour timer's own
// dead-lettering, and a replay has to start the count again anyway.
//
// Used by the worker (retries) and scripts/dead-letters.ts (replay).
export const ATTEMPT_HEADER = 'x-attempt'

// 1 for a job fresh from the timer; retry copies carry the number.
export function readAttempt(msg: Message): number {
    const value = Number(msg.properties.headers?.[ATTEMPT_HEADER] ?? 1)
    return Number.isSafeInteger(value) && value >= 1 ? value : 1
}

// The properties for sending a job on again, as this attempt. Same messageId,
// so one job can be followed through every attempt in the logs. The headers
// are only ours: RabbitMQ writes its own x-death again on the next trip.
export function jobProperties(msg: Message, attempt: number): Options.Publish {
    return {
        messageId: msg.properties.messageId,
        timestamp: msg.properties.timestamp,
        type: msg.properties.type,
        appId: msg.properties.appId,
        contentType: msg.properties.contentType,
        persistent: true,
        headers: { [ATTEMPT_HEADER]: attempt },
    }
}
