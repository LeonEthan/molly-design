import assert from 'node:assert/strict'
import test from 'node:test'
import { retireDesignSession } from './design-session-disposal.ts'

function surface() {
  const retained = {
    protocol: () => 'document',
    permissionRequest: (_contents, _permission, done) => done(false),
    permissionCheck: () => false,
    request: ({ url }, done) => done({ cancel: !url.startsWith('molly-design://canvas/') })
  }
  const session = {
    protocol: {
      unhandle: (scheme) => {
        assert.equal(scheme, 'molly-design')
        retained.protocol = null
      }
    },
    setPermissionRequestHandler: (handler) => {
      retained.permissionRequest = handler
    },
    setPermissionCheckHandler: (handler) => {
      retained.permissionCheck = handler
    },
    webRequest: {
      onBeforeRequest: (handler) => {
        retained.request = handler
      }
    }
  }
  return { session, retained }
}

void test('retirement replaces every surface closure and keeps requests and permissions denied', () => {
  const { session, retained } = surface()
  const old = new Set(Object.values(retained))
  retireDesignSession(session)
  assert.equal(retained.protocol, null)
  for (const handler of Object.values(retained).filter(Boolean))
    assert.equal(old.has(handler), false)
  for (const url of [
    'molly-design://canvas/editor.html',
    'https://example.invalid',
    'data:text/plain,old',
    'blob:molly-design://canvas/old'
  ]) {
    let response
    retained.request({ url }, (value) => {
      response = value
    })
    assert.deepEqual(response, { cancel: true })
  }
  let permission
  retained.permissionRequest(null, 'clipboard-read', (allowed) => {
    permission = allowed
  })
  assert.equal(permission, false)
  assert.equal(retained.permissionCheck(null, 'clipboard-read'), false)
})

void test('repeated retirement affects only its own session, not a live sibling', () => {
  const retired = surface(),
    sibling = surface()
  const siblingHandlers = { ...sibling.retained }
  retireDesignSession(retired.session)
  retireDesignSession(retired.session)
  assert.deepEqual(sibling.retained, siblingHandlers)
  let response
  sibling.retained.request({ url: 'molly-design://canvas/editor.html' }, (value) => {
    response = value
  })
  assert.deepEqual(response, { cancel: false })
  assert.equal(sibling.retained.protocol(), 'document')
})
