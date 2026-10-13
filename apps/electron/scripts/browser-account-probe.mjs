import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const require = createRequire(import.meta.url)
const { build } = createRequire(new URL('../../cli/package.json', import.meta.url))('esbuild')
const directory = await mkdtemp(join(tmpdir(), 'molly-browser-account-probe-'))
try {
  const entry = join(directory, 'main.cjs')
  await build({
    entryPoints: [fileURLToPath(new URL('browser-account-probe-main.ts', import.meta.url))],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    outfile: entry
  })
  const environment = {
    ...process.env,
    MOLLY_BROWSER_ACCOUNT_PROBE_DIRECTORY: join(directory, 'profile')
  }
  delete environment.ELECTRON_RUN_AS_NODE
  const child = spawn(require('electron'), [entry], { env: environment, stdio: 'inherit' })
  const status = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => resolve(code ?? 1))
  })
  if (status !== 0) throw new Error(`Synthetic browser account probe failed (${status})`)
} finally {
  await rm(directory, { recursive: true, force: true })
}
