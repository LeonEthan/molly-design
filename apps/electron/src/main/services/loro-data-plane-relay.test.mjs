import assert from 'node:assert/strict'
import net from 'node:net'
import test from 'node:test'
import { LOCAL_LORO_DATA_PLANE_PROTOCOL_VERSION } from '@molly/shared/local-loro-data-plane'
import { LoroDataPlaneRelay } from './loro-data-plane-relay.ts'

void test('probes the required local data plane when the renderer sends', async () => {
  let connectionAttempts = 0
  const relay = new LoroDataPlaneRelay('/unused/local-data-plane.sock', () => {
    connectionAttempts += 1
    const socket = new net.Socket()
    queueMicrotask(() => socket.emit('error', new Error('test socket unavailable')))
    return socket
  })
  const ping = {
    type: 'ping',
    protocolVersion: LOCAL_LORO_DATA_PLANE_PROTOCOL_VERSION
  }

  relay.send(ping)
  assert.equal(connectionAttempts, 1)

  relay.destroy()
  await Promise.resolve()
})
