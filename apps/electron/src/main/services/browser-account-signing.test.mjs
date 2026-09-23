import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hasStableMacSigningIdentity } from './browser-account-signing.ts'

void test('account persistence accepts a stable macOS signing team', () => {
  assert.equal(
    hasStableMacSigningIdentity(
      'Identifier=dev.molly-design.app\nAuthority=Developer ID Application: Example (A1B2C3D4E5)\nTeamIdentifier=A1B2C3D4E5\n'
    ),
    true
  )
})

void test('ad-hoc and unsigned development builds cannot import persistent accounts', () => {
  assert.equal(hasStableMacSigningIdentity('Signature=adhoc\nTeamIdentifier=not set\n'), false)
  assert.equal(hasStableMacSigningIdentity('Identifier=dev.molly-design.app\n'), false)
})
