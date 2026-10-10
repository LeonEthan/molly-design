import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const work = await mkdtemp(join(tmpdir(), 'molly-browser-navigation-'))
const requireElectron = createRequire(join(root, 'apps/electron/package.json'))
const { build } = createRequire(join(root, 'apps/cli/package.json'))('esbuild')

await symlink(join(root, 'apps/electron/node_modules'), join(work, 'node_modules'), 'dir')
await symlink(join(root, 'apps/electron/resources'), join(work, 'resources'), 'dir')
await build({
  entryPoints: [join(root, 'apps/electron/scripts/browser-navigation-probe-main.ts')],
  outfile: join(work, 'main.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  packages: 'external',
  alias: {
    '@molly/shared/browser-url': join(root, 'packages/shared/src/browser-url.ts'),
    '@molly/shared/browser-import-cookie': join(
      root,
      'packages/shared/src/browser-import-cookie.ts'
    ),
    '@molly/shared/electron-ipc': join(root, 'packages/shared/src/electron-ipc.ts')
  },
  define: { PROBE_OUTPUT: JSON.stringify(work) }
})

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const outcome = await new Promise((accept, reject) => {
  const child = spawn(
    requireElectron('electron'),
    [join(work, 'main.cjs'), '-ApplePersistenceIgnoreState', 'YES'],
    {
      cwd: work,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    }
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
  child.on('error', (error) => {
    clearTimeout(timeout)
    reject(error)
  })
  child.on('close', (code, signal) => {
    clearTimeout(timeout)
    accept({ code, signal, output, timedOut })
  })
})
await writeFile(join(work, 'electron.log'), outcome.output)
await writeFile(join(work, 'process.json'), JSON.stringify(outcome, null, 2))
console.log(`Evidence: ${work}`)
if (outcome.code !== 0 || outcome.signal || outcome.timedOut) {
  console.error(`Native browser navigation failed: ${JSON.stringify(outcome)}`)
  process.exitCode = 1
} else {
  const result = JSON.parse(await readFile(join(work, 'result.json'), 'utf8'))
  if (!result.ok) throw new Error('Native browser navigation did not complete')
  await rm(join(work, 'profile'), { recursive: true, force: true })
}
