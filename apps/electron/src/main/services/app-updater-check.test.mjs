import assert from 'node:assert/strict'
import test from 'node:test'
import {
  beginSparkleCheck,
  createCheckingWatchdog,
  nextSparkleEventGate,
  recoverUnansweredCheck,
  shouldResetPhaseForManualCheck
} from './app-updater-check.ts'

void test('an unanswered Sparkle check is cancelled before another check can start', () => {
  const order = []
  const sparkle = {
    cancelCheck() {
      order.push('cancel')
    },
    checkForUpdates() {
      order.push('check')
    }
  }

  const recovered = recoverUnansweredCheck({
    sparkle,
    sparkleSessionOpen: true
  })
  assert.deepEqual(order, ['cancel'])
  assert.equal(recovered.sparkleSessionOpen, false)
  assert.equal(recovered.ignoreUntilChecking, true)

  const started = beginSparkleCheck({ bridge: sparkle, sessionOpen: recovered.sparkleSessionOpen })
  assert.deepEqual(order, ['cancel', 'check'])
  assert.equal(started.started, true)
  assert.equal(started.sessionOpen, true)
  assert.equal(started.ignoreUntilChecking, false)

  const dropped = nextSparkleEventGate(recovered.ignoreUntilChecking, 'error')
  assert.equal(dropped.deliver, false)
  assert.equal(dropped.ignoreUntilChecking, true)
  const delivered = nextSparkleEventGate(dropped.ignoreUntilChecking, 'checking')
  assert.equal(delivered.deliver, true)
  assert.equal(delivered.ignoreUntilChecking, false)
})

void test('a second Sparkle check cancels the session that is still open', () => {
  const order = []
  const sparkle = {
    cancelCheck() {
      order.push('cancel')
    },
    checkForUpdates() {
      order.push('check')
    }
  }
  const started = beginSparkleCheck({ bridge: sparkle, sessionOpen: true })
  assert.deepEqual(order, ['cancel'])
  assert.equal(started.started, false)
  assert.equal(started.sessionOpen, false)
  assert.equal(started.ignoreUntilChecking, true)
  const retried = beginSparkleCheck({ bridge: sparkle, sessionOpen: started.sessionOpen })
  assert.deepEqual(order, ['cancel', 'check'])
  assert.equal(retried.started, true)
})

void test('a manual check keeps an in-progress or ready download', () => {
  assert.equal(shouldResetPhaseForManualCheck('downloading'), false)
  assert.equal(shouldResetPhaseForManualCheck('downloaded'), false)
  assert.equal(shouldResetPhaseForManualCheck('disabled'), false)
  assert.equal(shouldResetPhaseForManualCheck('idle'), true)
  assert.equal(shouldResetPhaseForManualCheck('checking'), true)
  assert.equal(shouldResetPhaseForManualCheck('up_to_date'), true)
  assert.equal(shouldResetPhaseForManualCheck('error'), true)
})

void test('an unanswered check becomes retryable and a later phase cancels the timer', () => {
  let pending = null
  let phase = 'idle'
  const watchdog = createCheckingWatchdog({
    delayMs: 30_000,
    schedule(callback, delayMs) {
      assert.equal(delayMs, 30_000)
      pending = callback
      return {
        cancel() {
          pending = null
        }
      }
    },
    isChecking: () => phase === 'checking',
    onUnanswered() {
      phase = 'error'
      unanswered = true
    }
  })
  let unanswered = false

  watchdog.sync('checking')
  phase = 'checking'
  assert.equal(typeof pending, 'function')
  pending()
  assert.equal(unanswered, true)
  assert.equal(phase, 'error')

  unanswered = false
  phase = 'checking'
  watchdog.sync('checking')
  watchdog.sync('downloading')
  assert.equal(pending, null)
  assert.equal(unanswered, false)
})

async function loadUpdaterService(platform = 'win32', failReplacement = false) {
  const { EventEmitter } = await import('node:events')
  const { createRequire } = await import('node:module')
  const { fileURLToPath } = await import('node:url')
  const { compileFunction } = await import('node:vm')
  const check = await import('./app-updater-check.ts')
  const require = createRequire(import.meta.url)
  const { build } = createRequire(new URL('../../../../cli/package.json', import.meta.url))(
    'esbuild'
  )
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL('./app-updater-service.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    external: ['*'],
    define: { 'import.meta.env': '{}' }
  })
  const updaters = []
  class Updater extends EventEmitter {
    constructor() {
      super()
      if (failReplacement && updaters.length) throw new Error('replacement unavailable')
      updaters.push(this)
      this.result = Promise.withResolvers()
    }
    checkForUpdates() {
      this.emit('checking-for-update')
      return this.result.promise
    }
  }
  const module = { exports: {} }
  compileFunction(compiled.outputFiles[0].text, [
    'module',
    'exports',
    'require',
    'setInterval',
    'process'
  ])(
    module,
    module.exports,
    (name) => {
      if (name === 'electron-updater')
        return {
          autoUpdater: new Updater(),
          MacUpdater: Updater,
          NsisUpdater: Updater
        }
      if (name === 'electron')
        return {
          app: { getVersion: () => '0.1.2', getPath: () => '/synthetic', isPackaged: true },
          BrowserWindow: { getAllWindows: () => [] }
        }
      if (name === './app-updater-check') return check
      if (name === './app-updater-sparkle-policy') return { shouldUseSparkleUpdater: () => false }
      if (name === './app-updater-metadata') return { readUpdaterReleaseMetadata: () => ({}) }
      if (name === '../utils') return { formatUnknownError: (error) => error.message }
      if (name === '@molly/shared/electron-ipc')
        return {
          IPC_PUSH_CHANNELS: { updaterState: 'updater.state' },
          UPDATE_CHECK_UNANSWERED: 'unanswered'
        }
      if (
        name === 'electron-sparkle-updater' ||
        name === './app-updater-sparkle-events' ||
        name === '../window-state'
      )
        return {}
      return require(name)
    },
    () => undefined,
    { platform, env: {} }
  )
  let timeout
  const service = new module.exports.AppUpdaterService({
    enabled: true,
    scheduleTimeout(callback) {
      timeout = callback
      return { cancel() {} }
    }
  })
  service.start()
  return { service, updaters, expire: () => timeout() }
}

for (const platform of ['win32', 'darwin']) {
  for (const phase of ['checking', 'downloading', 'error']) {
    void test(`retired ${platform} updater events and rejection cannot overwrite a retry's ${phase} state`, async () => {
      const { service, updaters, expire } = await loadUpdaterService(platform)
      const stale = updaters[0]
      expire()
      const retry = service.checkForUpdates()
      const current = updaters.at(-1)
      if (phase === 'downloading') current.emit('update-available', { version: '0.1.3' })
      if (phase === 'error') current.emit('error', new Error('retry failed'))
      const expected = { ...service.getState() }
      assert.equal(expected.phase, phase)
      stale.emit('update-not-available')
      stale.emit('error', new Error('stale failure'))
      stale.emit('update-available', { version: '0.1.4' })
      stale.emit('download-progress', { percent: 50 })
      stale.emit('update-downloaded', { version: '0.1.4', downloadedFile: '/stale' })
      stale.result.reject(new Error('stale rejection'))
      await stale.result.promise.catch(() => undefined)
      assert.deepEqual(service.getState(), expected)
      assert.equal(stale.autoDownload, false)
      assert.equal(stale.autoInstallOnAppQuit, false)
      current.result.resolve(null)
      await retry
      service.stop()
    })
  }
}

void test('replacement construction failure leaves the timed-out generation retired', async () => {
  const { service, updaters, expire } = await loadUpdaterService('win32', true)
  expire()
  assert.equal(service.getState().phase, 'error')
  assert.equal(service.getState().error, 'unanswered')
  const retry = await service.checkForUpdates()
  assert.deepEqual(retry, { started: false, error: 'replacement unavailable' })
  updaters[0].emit('update-not-available')
  assert.equal(service.getState().error, 'replacement unavailable')
  assert.equal(service.getState().phase, 'error')
  service.stop()
})
