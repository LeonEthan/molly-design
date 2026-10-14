import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { compileFunction } from 'node:vm'

const require = createRequire(import.meta.url)
const { build } = createRequire(new URL('../../../../cli/package.json', import.meta.url))('esbuild')
const compiled = await build({
  stdin: {
    contents: `export { restartMolly } from './app-restart.ts'`,
    resolveDir: fileURLToPath(new URL('.', import.meta.url)),
    loader: 'ts'
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  external: ['../utils', '../window-state']
})

const events = []
const module = { exports: {} }
compileFunction(compiled.outputFiles[0].text, ['module', 'exports', 'require', 'process'])(
  module,
  module.exports,
  (id) => {
    if (id === '../utils')
      return {
        formatUnknownError: (error) => (error instanceof Error ? error.message : String(error))
      }
    if (id === '../window-state')
      return {
        setAppQuitting: (quitting) => events.push(`quitting:${quitting}`)
      }
    return require(id)
  },
  process
)
const { restartMolly } = module.exports

await test('restart stops before relaunching when the update gate refuses', async () => {
  events.length = 0
  const result = await restartMolly({
    prepareRestart: async () => {
      throw new Error('Wait for Agent execution and design processing to finish before updating')
    },
    relaunch: () => events.push('relaunch'),
    quit: () => events.push('quit')
  })
  assert.deepEqual(result, {
    ok: false,
    error: 'Wait for Agent execution and design processing to finish before updating'
  })
  assert.deepEqual(events, [])
})

await test('restart relaunches before quitting once the gate has passed', async () => {
  events.length = 0
  const release = async () => events.push('released')
  const result = await restartMolly({
    prepareRestart: async () => release,
    relaunch: () => events.push('relaunch'),
    quit: () => events.push('quit')
  })
  assert.deepEqual(result, { ok: true })
  assert.deepEqual(events, ['quitting:true', 'relaunch', 'quit'])
})

await test('restart releases the gate and clears quitting state when relaunch fails', async () => {
  events.length = 0
  const result = await restartMolly({
    prepareRestart: async () => async () => events.push('released'),
    relaunch: () => {
      throw new Error('synthetic relaunch failure')
    },
    quit: () => events.push('quit')
  })
  assert.deepEqual(result, { ok: false, error: 'synthetic relaunch failure' })
  assert.deepEqual(events, ['quitting:true', 'quitting:false', 'released'])
})
