// `bun run migrate [dbmate command]` — defaults to `up`.
//
// dbmate refuses the local docker Postgres unless sslmode=disable is on the
// URL, while Bun's own driver is fine without it. So the app's DATABASE_URL
// stays as it is and the flag is added here, for dbmate only.
import { $ } from 'bun'

const base = process.env.DATABASE_URL
if (!base) throw new Error('Set DATABASE_URL!')

const url = new URL(base)
if (!url.searchParams.has('sslmode')) url.searchParams.set('sslmode', 'disable')

const command = process.argv.slice(2)

await $`bunx dbmate --url ${url.toString()} --migrations-dir db/migrations --no-dump-schema ${command.length ? command : ['up']}`
