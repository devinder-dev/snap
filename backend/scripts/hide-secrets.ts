// What a failing e2e check prints about a response — without its secrets. CI
// logs are public, and a response often carries tokens: a value under a key
// like "access_token" or "password" becomes "[hidden]", and so does any string
// shaped like a JWT, wherever it sits.

const SECRET_KEY = /token|password|secret|authorization/i
const JWT = /^[\w-]+\.[\w-]+\.[\w-]+$/

export function hideSecrets(value: unknown): unknown {
    if (typeof value === 'string') return JWT.test(value) ? '[hidden]' : value
    if (Array.isArray(value)) return value.map(hideSecrets)

    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).map(([key, inner]) => [key, SECRET_KEY.test(key) ? '[hidden]' : hideSecrets(inner)])
        )
    }

    return value
}
