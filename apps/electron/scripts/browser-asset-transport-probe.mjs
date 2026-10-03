import { execFile, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const work = await mkdtemp(join(tmpdir(), 'molly-browser-asset-transport-'))
const requireElectron = createRequire(join(root, 'apps/electron/package.json'))
const { build } = createRequire(join(root, 'apps/cli/package.json'))('esbuild')

try {
  await promisify(execFile)('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    join(work, 'fixture-key.pem'),
    '-out',
    join(work, 'fixture-cert.pem'),
    '-days',
    '1',
    '-subj',
    '/CN=localhost',
    '-addext',
    'subjectAltName=DNS:localhost,IP:127.0.0.1'
  ])
  await symlink(join(root, 'apps/electron/node_modules'), join(work, 'node_modules'), 'dir')
  await build({
    entryPoints: [join(root, 'apps/electron/scripts/browser-asset-transport-probe-main.ts')],
    outfile: join(work, 'main.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    packages: 'external',
    define: { PROBE_OUTPUT: JSON.stringify(work) }
  })
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const outcome = await new Promise((resolve, reject) => {
    const child = spawn(
      requireElectron('electron'),
      [join(work, 'main.cjs'), '-ApplePersistenceIgnoreState', 'YES'],
      { cwd: work, env, stdio: ['ignore', 'pipe', 'pipe'] }
    )
    let output = ''
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, 60_000)
    child.stdout.on('data', (chunk) => {
      output += chunk
      process.stdout.write(chunk)
    })
    child.stderr.on('data', (chunk) => {
      output += chunk
      process.stderr.write(chunk)
    })
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('close', (code, signal) => {
      clearTimeout(timeout)
      resolve({ code, signal, output, timedOut })
    })
  })
  await writeFile(join(work, 'electron.log'), outcome.output)
  await writeFile(join(work, 'process.json'), JSON.stringify(outcome, null, 2))
  console.log(`Evidence: ${work}`)
  if (outcome.code !== 0 || outcome.signal || outcome.timedOut) {
    throw new Error(`Native asset transport failed: ${JSON.stringify(outcome)}`)
  }
  const result = JSON.parse(await readFile(join(work, 'result.json'), 'utf8'))
  if (!result.ok) throw new Error('Native asset transport did not complete')
} finally {
  await rm(join(work, 'temporary-profile'), { recursive: true, force: true })
  await rm(join(work, 'fixture-key.pem'), { force: true })
  await rm(join(work, 'fixture-cert.pem'), { force: true })
}
