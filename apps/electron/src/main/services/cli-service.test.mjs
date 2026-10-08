import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { compileFunction } from 'node:vm'

const require = createRequire(import.meta.url)
const { build } = createRequire(new URL('../../../../cli/package.json', import.meta.url))('esbuild')
const compiled = await build({
  entryPoints: [fileURLToPath(new URL('./cli-service.ts', import.meta.url))],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  external: ['*']
})

for (const inheritedPlatform of ['cloud', 'invalid']) {
  for (const source of ['process', 'shell']) {
    void test(`private helper pins local identity over ${source} ${inheritedPlatform}`, async () => {
      const dataDir = '/synthetic/resolved-molly'
      const shellEnv = {
        MOLLY_DATA_DIR: '/synthetic/shell-profile',
        ...(source === 'shell' ? { MOLLY_PLATFORM: inheritedPlatform } : {})
      }
      const child = new EventEmitter()
      child.stdout = new PassThrough()
      child.stdin = new PassThrough()
      const started = Promise.withResolvers()
      const module = { exports: {} }
      compileFunction(compiled.outputFiles[0].text, ['module', 'exports', 'require', 'process'])(
        module,
        module.exports,
        (name) => {
          if (name === '../platform') return { mainPlatformKind: 'local' }
          if (name === './shell-env') return { getUserShellEnvCached: async () => shellEnv }
          if (name === './system-proxy-env')
            return { applyProxyEnvFallback() {}, resolveSystemProxyEnv: async () => ({}) }
          if (name === 'node:fs')
            return {
              existsSync: (path) =>
                path ===
                join('/synthetic/resources', 'app.asar.unpacked', 'resources', 'cli', 'index.js')
            }
          if (name === 'node:child_process')
            return {
              spawn(runtime, args, options) {
                started.resolve({ runtime, args, options })
                return child
              }
            }
          if (name === 'electron') return { app: { isPackaged: false } }
          if (name === '@molly/shared/node/installation-profile')
            return {
              getMollyDataDir(platform) {
                assert.equal(platform, 'local')
                return dataDir
              }
            }
          if (name === '@molly/shared/node/local-ipc')
            return { getLocalDaemonRunFilePath: () => `${dataDir}/run/daemon.json` }
          if (name === '@molly/shared/node/local-cli-host-lease')
            return { getLocalCliHostEndpoint: () => ({}) }
          if (name.startsWith('@molly/') || name === 'effect') return {}
          return require(name)
        },
        {
          env: source === 'process' ? { MOLLY_PLATFORM: inheritedPlatform } : {},
          resourcesPath: '/synthetic/resources',
          execPath: '/synthetic/electron',
          platform: 'darwin'
        }
      )
      const service = Object.create(module.exports.CliService.prototype)
      service.trackedCliChildren = new Set()
      const result = service.runPrivateHelper(['__internal', 'mcp-list-tools'], '{}', {
        timeoutMs: 1_000,
        maxOutputBytes: 1_024
      })
      const { options } = await started.promise
      child.stdout.emit('data', Buffer.from('{"ok":true,"tools":[],"truncated":false}\n'))
      child.emit('close', 0)
      assert.equal((await result).kind, 'exited')
      assert.equal(options.env.MOLLY_PLATFORM, 'local')
      assert.equal(options.env.MOLLY_DATA_DIR, dataDir)
      assert.equal(options.env.ELECTRON_RUN_AS_NODE, '1')
    })
  }
}

function loadCliServiceWithSettings(savedSettings) {
  const powerSave = { started: 0, stopped: 0, active: false }
  const module = { exports: {} }
  const anyFunction = new Proxy({}, { get: () => () => ({}) })
  compileFunction(compiled.outputFiles[0].text, ['module', 'exports', 'require', 'process'])(
    module,
    module.exports,
    (name) => {
      if (name === '../platform') return { mainPlatformKind: 'local' }
      if (name === './shell-env') return { getUserShellEnvCached: async () => ({}) }
      if (name === './system-proxy-env')
        return { applyProxyEnvFallback() {}, resolveSystemProxyEnv: async () => ({}) }
      if (name === 'electron')
        return {
          app: { isPackaged: false },
          powerSaveBlocker: {
            start() {
              powerSave.started += 1
              powerSave.active = true
              return 1
            },
            stop() {
              powerSave.stopped += 1
              powerSave.active = false
            },
            isStarted: () => powerSave.active
          }
        }
      if (name === 'node:fs')
        return {
          existsSync: () => savedSettings !== undefined,
          readFileSync: () => JSON.stringify(savedSettings),
          writeFileSync() {},
          mkdirSync() {}
        }
      if (name === '@molly/shared/node/installation-profile')
        return { getMollyDataDir: () => '/synthetic/resolved-molly' }
      if (name.startsWith('@molly/')) return anyFunction
      return require(name)
    },
    {
      env: {},
      resourcesPath: '/synthetic/resources',
      execPath: '/synthetic/electron',
      platform: 'darwin'
    }
  )
  return { service: new module.exports.CliService(), powerSave }
}

void test('sleep is blocked only while a run is active', () => {
  const { service, powerSave } = loadCliServiceWithSettings(undefined)
  assert.equal(service.getPreventSleepEnabled(), true)
  assert.equal(powerSave.started, 0)
  service.setRunActive(true)
  assert.equal(powerSave.started, 1)
  assert.equal(powerSave.active, true)
  service.setRunActive(false)
  assert.equal(powerSave.stopped, 1)
  assert.equal(powerSave.active, false)
})

void test('turning the setting off keeps sleep allowed even during a run', () => {
  const { service, powerSave } = loadCliServiceWithSettings({ preventSleepEnabled: false })
  assert.equal(service.getPreventSleepEnabled(), false)
  service.setRunActive(true)
  assert.equal(powerSave.started, 0)
})

void test('turning the setting off during a run releases the block', () => {
  const { service, powerSave } = loadCliServiceWithSettings(undefined)
  service.setRunActive(true)
  service.setPreventSleepEnabled(false)
  assert.equal(powerSave.active, false)
})
