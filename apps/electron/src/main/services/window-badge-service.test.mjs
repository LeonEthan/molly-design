import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { compileFunction } from 'node:vm'

const require = createRequire(import.meta.url)
const { build } = createRequire(new URL('../../../../cli/package.json', import.meta.url))('esbuild')
const compiled = await build({
  entryPoints: [fileURLToPath(new URL('./window-badge-service.ts', import.meta.url))],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  external: ['*']
})
const module = { exports: {} }
compileFunction(compiled.outputFiles[0].text, ['module', 'exports', 'require', 'process'])(
  module,
  module.exports,
  (name) => (name === 'electron' ? { app: { on() {} } } : require(name)),
  { platform: 'darwin' }
)
const { WindowBadgeService, parseWindowBadge, aggregateBadges } = module.exports

function service(changes) {
  return new WindowBadgeService({
    platform: 'linux',
    getApp: () => ({ setBadgeCount() {} }),
    onChange: (next) => changes.push(next)
  })
}

void test('working counts add up across windows and drop with a closed window', () => {
  const changes = []
  const badges = service(changes)
  badges.setBadge(1, { unread: 0, waiting: 0, working: 1 })
  badges.setBadge(2, { unread: 2, waiting: 0, working: 2 })
  assert.equal(badges.getAggregated().working, 3)
  badges.clearWindow(1)
  assert.equal(badges.getAggregated().working, 2)
  badges.clearWindow(2)
  assert.equal(changes.at(-1).working, 0)
})

void test('a reset reports no running work', () => {
  const changes = []
  const badges = service(changes)
  badges.setBadge(1, { unread: 0, waiting: 0, working: 1 })
  badges.reset()
  assert.equal(changes.at(-1).working, 0)
})

void test('a badge report must carry a valid working count', () => {
  assert.deepEqual(parseWindowBadge({ unread: 1, waiting: 2, working: 3 }), {
    unread: 1,
    waiting: 2,
    working: 3
  })
  assert.equal(parseWindowBadge({ unread: 1, waiting: 2 }), undefined)
  assert.equal(parseWindowBadge({ unread: 1, waiting: 2, working: -1 }), undefined)
  assert.equal(aggregateBadges([]).working, 0)
})
