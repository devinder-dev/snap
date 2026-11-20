import { expect, test } from 'bun:test'
import { BadRequest } from '../errors'
import { assertRegistrationUsername } from './registration-username'

test('registration accepts routable names from one to 32 characters', () => {
    for (const name of ['a', 'Z9_.-test', 'a'.repeat(32)]) {
        expect(() => assertRegistrationUsername(name)).not.toThrow()
    }
})

test('registration rejects ambiguous, empty and oversized path segments', () => {
    for (const name of ['', '.', '..', 'a'.repeat(33), ...['%', '/', '\\', '?', '#', ';', '\0', ' ', 'å'].map((char) => `a${char}b`)]) {
        expect(() => assertRegistrationUsername(name)).toThrow(BadRequest)
    }
})
