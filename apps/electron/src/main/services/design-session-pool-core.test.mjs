import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { DesignSessionPool } from './design-session-pool-core.ts'

const deferred = () => Promise.withResolvers()

function fixture() {
  const failures = []
  const pool = new DesignSessionPool(
    () => {
      const state = {
        protocol: null,
        request: null,
        data: 'old artwork',
        code: 'old code',
        auth: 'old auth',
        connections: true
      }
      const isolated = {
        state,
        protocol: {
          unhandle: () => {
            state.protocol = null
          }
        },
        webRequest: {
          onBeforeRequest: (handler) => {
            state.request = handler
          }
        },
        setPermissionRequestHandler: () => {},
        setPermissionCheckHandler: () => {},
        clearData: async () => {
          state.data = null
        },
        clearCodeCaches: async () => {
          state.code = null
        },
        clearAuthCache: async () => {
          state.auth = null
        },
        closeAllConnections: async () => {
          state.connections = false
        }
      }
      return isolated
    },
    (error) => failures.push(error)
  )
  return { pool, failures }
}

function contents(session) {
  const value = new EventEmitter()
  value.session = session
  value.destroyed = false
  value.isDestroyed = () => value.destroyed
  value.close = () => {
    value.closing = true
  }
  value.destroy = () => {
    value.destroyed = true
    value.emit('destroyed')
  }
  return value
}

void test('serial leases reuse only after all storage, code, auth and connections are cleared', async () => {
  const { pool } = fixture()
  const first = await pool.acquire()
  const cleaned = deferred()
  first.session.clearData = async () => {
    await cleaned.promise
    first.session.state.data = null
  }
  first.dispose()
  let acquired = false
  const next = pool.acquire().then((lease) => {
    acquired = true
    return lease
  })
  assert.equal(acquired, false)
  let response
  first.session.state.request({}, (value) => {
    response = value
  })
  assert.deepEqual(response, { cancel: true })
  cleaned.resolve()
  const second = await next
  assert.equal(second.session, first.session)
  assert.deepEqual(second.session.state, {
    protocol: null,
    request: second.session.state.request,
    data: null,
    code: null,
    auth: null,
    connections: false
  })
  assert.throws(first.assertActive, /Retired canvas/)
  second.assertActive()
})

void test('active and still-closing contents are exclusive; destruction makes the old session reusable', async () => {
  const { pool } = fixture()
  const first = await pool.acquire()
  const view = first.own(() => ({ webContents: contents(first.session) }))
  const sibling = await pool.acquire()
  assert.notEqual(sibling.session, first.session)
  first.dispose()
  assert.equal(view.webContents.closing, true)
  const third = await pool.acquire()
  assert.notEqual(third.session, first.session)
  view.webContents.destroy()
  const reused = await pool.acquire()
  assert.equal(reused.session, first.session)
  // A second disposal of the old lease must not revoke its new owner.
  first.dispose()
  reused.assertActive()
  sibling.assertActive()
})

void test('retirement rejects delayed request mutations and drains requests before reuse without blocking other opens', async () => {
  const { pool } = fixture()
  const first = await pool.acquire()
  const body = deferred()
  let document = 'saved artwork'
  const request = first.run(async () => {
    await body.promise
    first.assertActive()
    document = 'stale overwrite'
  })
  const rejected = assert.rejects(request, /Retired canvas/)
  first.dispose()
  const sibling = await pool.acquire()
  assert.notEqual(sibling.session, first.session)
  body.resolve()
  await rejected
  assert.equal(document, 'saved artwork')
  const reused = await pool.acquire()
  assert.equal(reused.session, first.session)
  await assert.rejects(
    first.run(async () => 'old request'),
    /Retired canvas/
  )
  assert.equal(await reused.run(async () => 'new request'), 'new request')
})

void test('an already accepted operation drains before reuse and cannot return a stale response', async () => {
  const { pool } = fixture()
  const first = await pool.acquire()
  const saved = deferred()
  const response = first.run(async () => {
    await saved.promise
    return 'old response'
  })
  const rejected = assert.rejects(response, /Retired canvas/)
  first.dispose()
  const sibling = await pool.acquire()
  assert.notEqual(sibling.session, first.session)
  saved.resolve()
  await rejected
  assert.equal((await pool.acquire()).session, first.session)
})

void test('cleanup failure quarantines the session and does not poison a sibling or later acquisitions', async () => {
  const { pool, failures } = fixture()
  const first = await pool.acquire()
  const sibling = await pool.acquire()
  first.session.clearData = async () => {
    throw Error('storage unavailable')
  }
  first.dispose()
  const replacement = await pool.acquire()
  assert.notEqual(replacement.session, first.session)
  assert.notEqual(replacement.session, sibling.session)
  assert.match(failures[0].message, /storage unavailable/)
  assert.throws(first.assertActive, /Retired canvas/)
  sibling.assertActive()
  let response
  first.session.state.request({}, (value) => {
    response = value
  })
  assert.deepEqual(response, { cancel: true })
})

void test('concurrent acquisitions waiting for cleanup still get distinct sessions', async () => {
  const { pool } = fixture()
  const first = await pool.acquire()
  const cleaned = deferred()
  first.session.clearData = () => cleaned.promise
  first.dispose()
  const a = pool.acquire(),
    b = pool.acquire()
  cleaned.resolve()
  const leases = await Promise.all([a, b])
  assert.notEqual(leases[0].session, leases[1].session)
  assert.equal(
    leases.some((lease) => lease.session === first.session),
    true
  )
})

void test('failed native construction retires an unused lease; retired leases cannot create contents', async () => {
  const { pool } = fixture()
  const first = await pool.acquire()
  assert.throws(
    () =>
      first.own(() => {
        throw Error('native construction failed')
      }),
    /native construction/
  )
  assert.throws(first.assertActive, /Retired canvas/)
  assert.equal((await pool.acquire()).session, first.session)
  assert.throws(
    () =>
      first.own(() => {
        throw Error('must not construct')
      }),
    /Retired canvas/
  )
})
