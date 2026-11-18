import { describe, expect, test } from 'bun:test'
import { hideSecrets } from './hide-secrets'

describe('hideSecrets: what a failing e2e check may print', () => {
    test('hides values under secret-sounding keys, at any depth', () => {
        const response = {
            status: 201,
            body: {
                tokens: { access_token: 'abc', refresh_token: 'def' },
                user: { username: 'anna', password: 'correct horse' },
            },
        }
        expect(hideSecrets(response)).toEqual({
            status: 201,
            body: { tokens: '[hidden]', user: { username: 'anna', password: '[hidden]' } },
        })
    })

    test('hides JWT-shaped strings even under an innocent key', () => {
        expect(hideSecrets({ value: 'eyJhbGciOi.eyJ1c2VyIjoi.c2lnbmF0dXJl' })).toEqual({ value: '[hidden]' })
    })

    test('leaves everything else as it was', () => {
        const push = { snap_id: '42', sender_username: 'anna', type: 'photo', file: 'snap.png' }
        expect(hideSecrets(push)).toEqual(push)
        expect(hideSecrets([1, 'two', null, true])).toEqual([1, 'two', null, true])
        expect(hideSecrets(undefined)).toBeUndefined()
    })
})
