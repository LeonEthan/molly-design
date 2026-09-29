import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { compileFunction } from 'node:vm'

const require = createRequire(import.meta.url)
const { build } = createRequire(new URL('../../../../cli/package.json', import.meta.url))('esbuild')
const compiled = await build({
  stdin: {
    contents: `
      export { PublicBrowserAgentController } from './public-browser-agent-controller.ts'
      export { BrowserMcpDriver } from './browser-mcp-driver.ts'
    `,
    resolveDir: fileURLToPath(new URL('.', import.meta.url)),
    loader: 'ts'
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  alias: {
    '@molly/shared/browser-url': fileURLToPath(
      new URL('../../../../../packages/shared/src/browser-url.ts', import.meta.url)
    )
  }
})
const module = { exports: {} }
compileFunction(compiled.outputFiles[0].text, ['module', 'exports', 'require'])(
  module,
  module.exports,
  (name) => (name === 'electron' ? { app: { isPackaged: false } } : require(name))
)
const { PublicBrowserAgentController, BrowserMcpDriver } = module.exports

const timeoutMessage = 'Browser page is still loading; observe again after it settles.'
const blockedMessage =
  'Agent browser network blocked: The browser could not verify a public response peer.'
const scope = {
  sessionId: 'session',
  browserId: 'browser',
  runId: 'run',
  sites: ['8.8.8.8']
}
const command = { kind: 'navigate', url: 'https://8.8.8.8/' }

class NavigationFixture {
  constructor(perform) {
    const controller = new PublicBrowserAgentController()
    const contents = {
      id: 1,
      session: { resolveProxy: async () => 'DIRECT' },
      isDestroyed: () => false,
      stop: () => {},
      getURL: () => command.url
    }
    const lease = {
      scope,
      contents,
      disposed: false,
      networkError: null,
      verifiedDocuments: new Set(),
      ready: false
    }
    const leases = Reflect.get(controller, 'leases')
    leases.set(contents.id, lease)
    const driver = new BrowserMcpDriver(contents, {
      assertActive: () => Reflect.get(controller, 'assertSameLease').call(controller, lease)
    })
    const events = {
      rejectPeer: () =>
        Reflect.get(controller, 'observeNetwork').call(
          controller,
          lease,
          'Network.responseReceived',
          {
            requestId: 'document',
            type: 'Document',
            response: { url: command.url, remoteIPAddress: '127.0.0.1' }
          }
        )
    }
    Reflect.set(driver, 'client', {
      callTool: async () => {
        await perform({ lease, leases, ...events })
        return {
          isError: true,
          content: [{ type: 'text', text: 'Timeout 15000ms exceeded during navigation.' }]
        }
      }
    })
    lease.driver = driver
    this.lease = lease
    this.run = () => controller.execute(contents, scope, command)
  }
}

void test('navigation reports the known response-policy denial instead of the driver timeout', async () => {
  const { run } = new NavigationFixture(({ rejectPeer }) => rejectPeer())
  await assert.rejects(run(), { message: blockedMessage })
})

void test('navigation retains the known response-policy denial after a driver transport failure', async () => {
  const { run } = new NavigationFixture(({ rejectPeer }) => {
    rejectPeer()
    throw new Error('Synthetic MCP transport failure')
  })
  await assert.rejects(run(), { message: blockedMessage })
})

void test('navigation keeps the ordinary timeout when no response was blocked', async () => {
  const { run } = new NavigationFixture(() => {})
  await assert.rejects(run(), { message: timeoutMessage })
})

void test('a new navigation clears the previous network denial before reporting its own timeout', async () => {
  const { run, lease } = new NavigationFixture(() => {})
  lease.networkError = 'Previous navigation was blocked.'
  await assert.rejects(run(), { message: timeoutMessage })
})

void test('revocation and replacement retain ownership errors even with a recorded policy denial', async () => {
  for (const retire of [
    ({ lease }) => {
      lease.disposed = true
    },
    ({ lease, leases }) => leases.set(lease.contents.id, { ...lease })
  ]) {
    const { run } = new NavigationFixture((state) => {
      state.rejectPeer()
      retire(state)
    })
    await assert.rejects(run(), {
      message: 'Agent browser control was revoked before the result was returned.'
    })
  }
})
