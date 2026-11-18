import type { ApiMessage } from '../http/types'
import type { SnapType } from '../repository/types'

// Every event the backend publishes to snap.events: its routing key, and the
// JSON body that goes with it.
//
// One map, so `publishEvent('snap.created', payload)` only compiles when the
// payload is the one that belongs to snap.created.
//
// Like the socket payloads, these carry usernames, never ids, and timestamps
// as ISO strings.
export type Events = {
    'message.created': ApiMessage

    // One event per snap, not per recipient: the snap needs exactly one timer.
    'snap.created': {
        snap_id: string
        sender_username: string
        recipients: string[]
        type: SnapType
        created_at: string
        expires_at: string
    }

    // Goes to the snap's sender; `by` took the screenshot.
    'snap.screenshot': {
        snap_id: string
        sender_username: string
        by: string
        created_at: string
    }

    'friend.requested': {
        from: string
        to: string
        created_at: string
    }

    // Both people are told; each gets the other's name.
    'friend.accepted': {
        users: [string, string]
        created_at: string
    }
}

export type RoutingKey = keyof Events

export type EventPayload<K extends RoutingKey> = Events[K]
