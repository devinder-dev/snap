import { expect, test } from 'bun:test'

test.each([undefined, 'too short', 'é'.repeat(37)])(
    'seed refuses missing, short, and oversized credentials before connecting',
    (password) => {
        const result = Bun.spawnSync([process.execPath, '--no-env-file', 'run', 'seed:demo'], {
            cwd: `${import.meta.dir}/..`,
            env: password === undefined ? {} : { SNAP_DEMO_PASSWORD: password },
            stdout: 'pipe',
            stderr: 'pipe',
        })
        const output = result.stdout.toString() + result.stderr.toString()
        expect(result.exitCode).toBe(1)
        expect(output).toContain('Set SNAP_DEMO_PASSWORD to at least 12 characters and at most 72 bytes.')
        if (password !== undefined) expect(output).not.toContain(password)
    },
)
