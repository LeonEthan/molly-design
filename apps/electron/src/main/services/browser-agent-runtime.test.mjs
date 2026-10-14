import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { compileFunction } from 'node:vm'

const require = createRequire(import.meta.url)
const { build } = createRequire(new URL('../../../../cli/package.json', import.meta.url))('esbuild')
const compiled = await build({
  entryPoints: [fileURLToPath(new URL('./browser-agent-runtime.ts', import.meta.url))],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  alias: {
    'acp-extension-dsh/capabilities': fileURLToPath(
      new URL('../../../../../packages/acp-extension-dsh/src/capabilities.ts', import.meta.url)
    ),
    '@molly/shared/browser-agent-rpc': fileURLToPath(
      new URL('../../../../../packages/shared/src/browser-agent-rpc.ts', import.meta.url)
    )
  }
})

class NativeReplyFixture {
  constructor() {
    let child
    const module = { exports: {} }
    compileFunction(compiled.outputFiles[0].text, ['module', 'exports', 'require'])(
      module,
      module.exports,
      (name) => {
        if (name === 'electron') return { app: { isPackaged: false } }
        if (name === 'node:child_process')
          return {
            spawn: () => {
              child = Object.assign(new EventEmitter(), {
                stdout: new EventEmitter(),
                kill: () => {
                  throw new Error('Unexpected child termination')
                }
              })
              return child
            }
          }
        return require(name)
      }
    )
    let revoked = false
    this.runtime = new module.exports.BrowserAgentRuntime(
      () => {
        if (revoked) throw new Error('Browser control was revoked')
      },
      () => {
        revoked = true
      }
    )
    Reflect.set(this.runtime, 'binary', '/native-fixture/agent-browser')
    Reflect.set(this.runtime, 'directory', '/native-fixture/session')
    Reflect.set(this.runtime, 'daemon', new EventEmitter())
    this.reply = (text, code = 0) => {
      child.stdout.emit('data', Buffer.from(text))
      child.emit('close', code, null)
    }
    this.isRevoked = () => revoked
  }
}

void test('native successful connect and snapshot replies accept Rust Option null fields', async () => {
  const fixture = new NativeReplyFixture()
  const connect = fixture.runtime.call(['connect', 'ws://127.0.0.1/native-fixture'])
  fixture.reply(JSON.stringify({ success: true, data: null, error: null }))
  assert.equal((await connect).success, true)
  assert.equal(fixture.isRevoked(), false)
  const snapshot = fixture.runtime.call(['snapshot'])
  const data = { snapshot: '- heading "Native research"' }
  fixture.reply(JSON.stringify({ success: true, data, error: null }))
  assert.deepEqual((await snapshot).data, data)
  assert.equal(fixture.isRevoked(), false)
})

void test('native failed reply with absent data retains its error without revoking observation', async () => {
  const fixture = new NativeReplyFixture()
  const result = fixture.runtime.call(['snapshot'])
  fixture.reply(JSON.stringify({ success: false, data: null, error: 'stale_ref' }), 1)
  assert.equal((await result).error, 'stale_ref')
  assert.equal(fixture.isRevoked(), false)
})

void test('native omitted optional fields remain compatible', async () => {
  const fixture = new NativeReplyFixture()
  const result = fixture.runtime.call(['connect', 'ws://127.0.0.1/native-fixture'])
  fixture.reply(JSON.stringify({ success: true }))
  assert.deepEqual(await result, { success: true })
  assert.equal(fixture.isRevoked(), false)
})

void test('malformed native replies revoke the lease and report an unknown outcome', async () => {
  for (const text of [
    'not JSON',
    JSON.stringify({ success: true, data: [], error: null }),
    JSON.stringify({ success: true, data: {}, error: 4 })
  ]) {
    const fixture = new NativeReplyFixture()
    const result = fixture.runtime.call(['snapshot'])
    fixture.reply(text)
    await assert.rejects(result, /Browser outcome is unknown/)
    assert.equal(fixture.isRevoked(), true)
    await assert.rejects(fixture.runtime.call(['snapshot']), /Browser control was revoked/)
  }
})
