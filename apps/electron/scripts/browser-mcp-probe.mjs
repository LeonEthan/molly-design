/* eslint-disable @typescript-eslint/explicit-function-return-type -- Standalone JavaScript probe. */
// Isolated compatibility probe, not a product entry point. No browser install or CDP listener.
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile, mkdtemp, rm, symlink } from 'node:fs/promises'
import { dirname, resolve, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const commit = '3fecd4f931666fecd1fbd7c214ce544409ead6e8'
const deps = join(tmpdir(), 'molly-browser-mcp-probe-deps')
const product = process.argv.includes('--product')
const destination = process.argv.slice(2).find((arg) => arg !== '--product')
const output = destination
  ? resolve(destination)
  : join(root, 'e2e/artifacts/acceptance/browser-mcp-probe')
await mkdir(deps, { recursive: true })
await mkdir(output, { recursive: true })
const dependencies = {
  '@playwright/mcp': '0.0.82',
  playwright: '1.64.0-alpha-1789764292000',
  '@modelcontextprotocol/sdk': '1.29.0',
  esbuild: '0.24.2'
}
await writeFile(
  join(deps, 'package.json'),
  JSON.stringify({ private: true, dependencies }, null, 2)
)
const run = (exe, args, options = {}) =>
  new Promise((accept, reject) => {
    const child = spawn(exe, args, { stdio: 'inherit', ...options })
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 ? accept() : reject(new Error(`${exe} exited ${code}`))))
  })
if (!product)
  await run('npm', ['install', '--prefix', deps, '--ignore-scripts', '--no-audit', '--no-fund'])
const { build } = createRequire(join(root, 'apps/cli/package.json'))('esbuild')
await writeFile(
  join(output, product ? 'pnpm-lock.yaml' : 'dependency-lock.json'),
  await readFile(product ? join(root, 'pnpm-lock.yaml') : join(deps, 'package-lock.json'))
)
const sources = new Map()
const upstream = {
  name: 'pinned-vscode-sources',
  setup(builder) {
    builder.onResolve({ filter: /^vscode:/ }, (args) => ({
      path: args.path.slice(7),
      namespace: 'vscode'
    }))
    builder.onResolve({ filter: /^\./, namespace: 'vscode' }, (args) => ({
      path: posix
        .normalize(posix.join(posix.dirname(args.importer), args.path))
        .replace(/\.js$/, '.ts'),
      namespace: 'vscode'
    }))
    builder.onLoad({ filter: /.*/, namespace: 'vscode' }, async (args) => {
      const url = `https://raw.githubusercontent.com/microsoft/vscode/${commit}/${args.path}`
      const response = await fetch(url)
      if (!response.ok) throw new Error(`Pinned source unavailable: ${url} (${response.status})`)
      const contents = await response.text()
      sources.set(args.path, { url, sha256: createHash('sha256').update(contents).digest('hex') })
      return { contents, loader: 'ts' }
    })
  }
}
const work = await mkdtemp(join(tmpdir(), 'molly-mcp-electron-'))
try {
  if (product)
    await symlink(join(root, 'apps/electron/node_modules'), join(work, 'node_modules'), 'dir')
  const result = await build({
    entryPoints: [
      join(
        root,
        `apps/electron/scripts/${product ? 'browser-driver-probe-main' : 'browser-mcp-probe-main'}.ts`
      )
    ],
    outfile: join(work, 'main.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    packages: 'external',
    plugins: [upstream],
    metafile: true,
    alias: { '@molly/shared/browser-url': join(root, 'packages/shared/src/browser-url.ts') },
    define: { PROBE_DEPENDENCIES: JSON.stringify(deps), PROBE_OUTPUT: JSON.stringify(output) }
  })
  const license = await fetch(
    `https://raw.githubusercontent.com/microsoft/vscode/${commit}/LICENSE.txt`
  )
  if (!license.ok) throw new Error('VS Code license unavailable')
  await writeFile(join(output, 'VSCODE-LICENSE.txt'), await license.text())
  await writeFile(
    join(output, 'upstream-sources.json'),
    JSON.stringify(
      {
        commit,
        dependencies,
        files: Object.fromEntries(sources),
        bundleInputs: result.metafile.inputs
      },
      null,
      2
    )
  )
  const require = createRequire(join(root, 'apps/electron/package.json'))
  const executable = require('electron')
  const env = { ...process.env, NODE_PATH: join(root, 'apps/electron/node_modules') }
  delete env.ELECTRON_RUN_AS_NODE
  await run(executable, [join(work, 'main.cjs')], { cwd: output, env, timeout: 60_000 })
  console.log(`Evidence: ${output}`)
} finally {
  await rm(work, { recursive: true, force: true })
  await rm(join(output, 'temporary-profile'), { recursive: true, force: true })
}
