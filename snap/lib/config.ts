/**
 * The two switches every network module in `lib/` agrees on.
 *
 * Kept here, not in `api.ts`, because both the HTTP client and the realtime
 * socket need them — and neither should import the other just for a constant.
 */

/** true = in-memory mock, no backend needed. false = talk to the server below. */
export const USE_MOCK = false;

/**
 * `localhost` is the PHONE, not your Mac — see `.env.example`. Requests that hang
 * with no error are almost always this pointing at the wrong address.
 */
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
