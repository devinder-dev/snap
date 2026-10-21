import { S3Client } from 'bun'

// Presigned GETs for snaps should be short-lived — the URL is a bearer token
// for that object, and anyone holding it can read the snap until it expires.
// Bun's own default is 24 hours, which is far too long for this.
const DEFAULT_EXPIRY_SECONDS = 300

// Bun loads .env into process.env at startup. Fail here rather than on the
// first upload: missing credentials are a config mistake, not a runtime state.
function required(name: string): string {
    const value = process.env[name]
    if (!value) throw new Error(`Set ${name}!`)
    return value
}

// Bun reads credentials from env vars only — no IAM roles, ~/.aws profiles or
// SSO like the AWS SDK — so on every machine the keys arrive this way.
//
// The last two are optional. S3_ENDPOINT points at an S3-compatible server
// instead of AWS (the stand-in CI uses, so CI never holds real keys), and
// S3_SESSION_TOKEN comes with temporary credentials. `|| undefined` so an empty
// line in .env counts as unset rather than as an empty endpoint.
const client = new S3Client({
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    endpoint: process.env.S3_ENDPOINT || undefined,
    sessionToken: process.env.S3_SESSION_TOKEN || undefined,
})

// Uint8Array covers Buffer too, which is what a multipart form part gives you.
export type UploadBody = string | ArrayBuffer | Uint8Array | Blob

// Upload (or replace) an object. Bun switches to a multipart upload on its own
// for large bodies, so the same call works for a 2 KB text snap and a 5 MB photo.
export async function uploadFile(
    key: string,
    body: UploadBody,
    contentType: string
): Promise<void> {
    await client.file(key).write(body, { type: contentType })
}

// Presigned GET for an existing object.
// This is synchronous and makes no network request — it's an HMAC computed
// locally, so it costs nothing and it does NOT verify that the key exists.
// A URL for a missing key is signed happily and 404s when fetched.
//
// The URL inherits this client's permissions, it doesn't bypass them: it works
// only because the IAM user has s3:GetObject.
export function getPresignedUrl(
    key: string,
    expiresIn: number = DEFAULT_EXPIRY_SECONDS
): string {
    return client.presign(key, { expiresIn, method: 'GET' })
}

// Delete an object. S3 answers a delete of a missing key with success, so this
// is idempotent — two instances cleaning up the same snap is harmless.
export async function deleteFile(key: string): Promise<void> {
    await client.delete(key)
}
