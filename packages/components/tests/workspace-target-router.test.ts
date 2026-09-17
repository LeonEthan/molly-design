import { describe, expect, it, vi } from 'vitest';
import { getSessionRoomId, type MachineId, type SessionId } from '@molly/shared';
import { WorkspaceTargetRouter } from '../src/providers/workspace-target-router';

const sessionId = 'session-local' as SessionId;
const firstMachineId = 'machine-first' as MachineId;
const secondMachineId = 'machine-second' as MachineId;

describe('WorkspaceTargetRouter', () => {
  it('routes all durable rooms and Machine RPC through the local plane', async () => {
    const router = new WorkspaceTargetRouter();
    const rooms = [
      { kind: 'meta', id: 'meta' },
      { kind: 'doc', id: getSessionRoomId(sessionId) },
      { kind: 'flock-doc', id: 'workspace:task-index' },
    ] as const;
    for (const room of rooms) {
      expect(router.resolveTransportRoute(room)).toEqual({ transportIds: ['local'] });
      expect(router.getReadinessTransportForRoom(room)).toBe('local');
    }
    expect(router.getPlaneForMachine(secondMachineId)).toBe('local');
    await expect(router.resolvePlaneForMachine(secondMachineId)).resolves.toBe('local');
    await expect(router.prepareSessionTarget(sessionId)).resolves.toBe('local');
    await expect(router.prepareDocTarget(getSessionRoomId(sessionId))).resolves.toBe('local');
  });

  it('preserves an immutable session owner assertion while routing locally', async () => {
    const onRouteChange = vi.fn();
    const router = new WorkspaceTargetRouter({ onRouteChange });
    router.observeDocMeta(getSessionRoomId(sessionId), { machineId: firstMachineId });
    expect(() => router.rememberSessionTarget(sessionId, secondMachineId)).toThrow(
      'workspace_target_conflict'
    );
    await expect(router.prepareSessionTarget(sessionId, firstMachineId)).resolves.toBe('local');
    expect(router.getPlaneForSession(sessionId)).toBe('local');
  });
});
