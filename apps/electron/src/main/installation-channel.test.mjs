import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { compileFunction } from 'node:vm'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { build } = createRequire(new URL('../../../cli/package.json', import.meta.url))('esbuild')
const compiled = await build({
  entryPoints: [fileURLToPath(new URL('./user-data-migration.ts', import.meta.url))],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  external: ['electron', '@molly/*'],
  define: { 'import.meta.env.VITE_MOLLY_PLATFORM': '"local"' }
})

function boot({ root, metadata, isPackaged = true, env = {} }) {
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(metadata))
  const paths = { appData: path.join(root, 'appData') }
  const app = {
    isPackaged,
    getAppPath: () => root,
    getName: () => 'Molly',
    getPath: (name) => paths[name],
    setPath: (name, value) => {
      paths[name] = value
    },
    commandLine: { getSwitchValue: () => env.MOLLY_ELECTRON_USER_DATA_DIR ?? '' }
  }
  const processState = { env: { ...env } }
  compileFunction(compiled.outputFiles[0].text, ['require', 'process'])((name) => {
    if (name === 'electron') return { app }
    if (name === 'node:os') return { homedir: () => root }
    if (name === '@molly/shared/platform-kind') {
      return require('../../../../packages/shared/src/platform-kind.ts')
    }
    if (name === '@molly/shared/node/installation-profile') {
      return require('../../../../packages/shared/src/node/installation-profile.cjs')
    }
    if (name.startsWith('@molly/')) return {}
    return require(name)
  }, processState)
  return { env: processState.env, paths }
}

void test('packaged Preview selects isolated paths before stores initialize and skips legacy migration', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'molly-preview-bootstrap-'))
  try {
    fs.mkdirSync(path.join(root, 'appData', 'Geon'), { recursive: true })
    fs.mkdirSync(path.join(root, '.geon'))
    const result = boot({
      root,
      metadata: { mollyChannel: 'preview' },
      env: {
        MOLLY_INSTALLATION_CHANNEL: 'stable',
        MOLLY_DATA_DIR: path.join(root, '.molly'),
        MOLLY_ELECTRON_USER_DATA_DIR: path.join(root, 'appData', 'Molly Design')
      }
    })
    assert.equal(result.env.MOLLY_INSTALLATION_CHANNEL, 'preview')
    assert.equal(result.env.MOLLY_DATA_DIR, path.join(root, '.molly-preview'))
    assert.equal(result.paths.userData, path.join(root, 'appData', 'Molly Preview'))
    assert.ok(fs.existsSync(path.join(root, 'appData', 'Geon')))
    assert.ok(fs.existsSync(path.join(root, '.geon')))
    assert.equal(fs.existsSync(path.join(root, '.molly')), false)
    const finder = boot({ root, metadata: { mollyChannel: 'preview' } })
    assert.equal(finder.paths.userData, result.paths.userData)
    assert.equal(finder.env.MOLLY_DATA_DIR, result.env.MOLLY_DATA_DIR)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

void test('release and development ignore an inherited Preview channel and retain explicit test paths', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'molly-stable-bootstrap-'))
  try {
    const userData = path.join(root, 'isolated-test')
    for (const isPackaged of [false, true]) {
      const result = boot({
        root,
        metadata: {},
        isPackaged,
        env: {
          MOLLY_INSTALLATION_CHANNEL: 'preview',
          MOLLY_ELECTRON_USER_DATA_DIR: userData
        }
      })
      assert.equal(result.env.MOLLY_INSTALLATION_CHANNEL, 'stable')
      assert.equal(result.paths.userData, userData)
    }
    assert.throws(() => boot({ root, metadata: { mollyChannel: 'typo' } }), /Unsupported packaged/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
