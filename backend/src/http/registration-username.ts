import { BadRequest } from '../errors'

export function assertRegistrationUsername(username: string): void {
    // These names appear as URL path segments. Clients normalize single and double dots.
    if (!/^[A-Za-z0-9_.-]{1,32}$/.test(username) || username === '.' || username === '..') {
        throw new BadRequest('Username must be 1–32 characters: letters A–Z, digits, underscores, dots or hyphens. Use a name other than "." or "..".')
    }
}
