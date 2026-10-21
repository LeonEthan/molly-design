import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const require = createRequire(import.meta.url)
const { build } = createRequire(new URL('../../cli/package.json', import.meta.url))('esbuild')
const directory = await mkdtemp(join(tmpdir(), 'molly-image-preview-export-'))
try {
  const html = await readFile(new URL('../src/renderer/index.html', import.meta.url), 'utf8')
  const csp = html.match(/content="(default-src [^"]+)"/)?.[1]
  if (!csp) throw new Error('Renderer CSP missing')
  await writeFile(
    join(directory, 'index.html'),
    `<!doctype html><meta http-equiv="Content-Security-Policy" content="${csp}"><script src="renderer.js"></script>`
  )
  await writeFile(
    join(directory, 'preload.cjs'),
    `const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('__MOLLY_ELECTRON__', true)
contextBridge.exposeInMainWorld('ipc', {
  invoke: (...args) => ipcRenderer.invoke(...args),
  on: () => () => {},
  send: () => {}
})`
  )
  await build({
    entryPoints: [fileURLToPath(new URL('image-preview-export-probe-main.ts', import.meta.url))],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    outfile: join(directory, 'main.cjs')
  })
  await build({
    entryPoints: [
      fileURLToPath(new URL('image-preview-export-probe-renderer.ts', import.meta.url))
    ],
    bundle: true,
    platform: 'browser',
    tsconfig: fileURLToPath(new URL('../../../packages/components/tsconfig.json', import.meta.url)),
    outfile: join(directory, 'renderer.js')
  })
  const environment = { ...process.env }
  delete environment.ELECTRON_RUN_AS_NODE
  const child = spawn(
    require('electron'),
    [join(directory, 'main.cjs'), '-ApplePersistenceIgnoreState', 'YES'],
    {
      env: environment,
      stdio: 'inherit'
    }
  )
  const status = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => resolve(code ?? 1))
  })
  if (status !== 0) throw new Error(`Image preview export probe failed (${status})`)
} finally {
  await rm(directory, { recursive: true, force: true })
}
