import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SessionStatusFactory,
  type MachineId,
  type SessionId,
  type SessionStatus,
} from '@molly/shared';
import type { Logger } from '@/utils/logger';
import type { LoroDocumentManager } from './doc';
import { SessionActivePresenceController } from './session-active-presence';

const sessionId = 'session-active-presence-1' as SessionId;
const machineId = 'machine-active-presence-1' as MachineId;

const createLogger = (): Logger =>
  ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }) as unknown as Logger;

function fixture() {
  const presence = new Map<
    SessionId,
    { machineId: MachineId; status: SessionStatus; at: number }
  >();
  const workspaceDocument = {
    publishSessionPresence: (id: SessionId, owner: MachineId, status: SessionStatus) => {
      presence.set(id, { machineId: owner, status, at: Date.now() });
    },
    clearSessionPresence: (id: SessionId) => {
      presence.delete(id);
    },
  };
  const controller = new SessionActivePresenceController(
    workspaceDocument as unknown as LoroDocumentManager,
    machineId,
    createLogger(),
    { intervalMs: 1_000 }
  );
  return { presence, controller };
}

describe('SessionActivePresenceController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('publishes fallback thinking presence on start and clears on release', () => {
    const { presence, controller } = fixture();
    controller.start(sessionId);
    expect(presence.get(sessionId)).toEqual({
      machineId,
      status: SessionStatusFactory.running(),
      at: 0,
    });
    controller.clear(sessionId);
    expect(presence.has(sessionId)).toBe(false);
  });

  it('updates phase through the same owner without clearing between phases', () => {
    const { presence, controller } = fixture();
    controller.start(sessionId, 'initializing');
    controller.setPhase(sessionId, 'acp');
    controller.start(sessionId, 'thinking');
    controller.setPhase(sessionId, 'requestPermission');
    controller.setPhase(sessionId, 'requestPermission');
    expect(presence.get(sessionId)?.status).toEqual(SessionStatusFactory.requestPermission());
    expect(controller.has(sessionId)).toBe(true);
  });

  it('publishes managed runtime progress as initializing presence detail', () => {
    const { presence, controller } = fixture();
    controller.start(sessionId, 'managed-runtime', 'Downloading Codex runtime 42%');
    controller.setPhase(sessionId, 'managed-runtime', 'Downloading Codex runtime 43%');
    expect(presence.get(sessionId)?.status).toEqual(
      SessionStatusFactory.initializing('managed-runtime', 'Downloading Codex runtime 43%')
    );
  });

  it('refreshes active presence on the heartbeat interval and stops after clear', () => {
    const { presence, controller } = fixture();
    controller.start(sessionId, 'image_generation');
    expect(presence.get(sessionId)?.at).toBe(0);
    vi.advanceTimersByTime(1_000);
    expect(presence.get(sessionId)).toEqual({
      machineId,
      status: SessionStatusFactory.running('image_generation'),
      at: 1_000,
    });
    controller.clear(sessionId);
    vi.advanceTimersByTime(2_000);
    expect(presence.has(sessionId)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('owns only the presence heartbeat across the first active minute and repeated starts', () => {
    const { presence, controller } = fixture();
    controller.start(sessionId, 'initializing');
    controller.start(sessionId, 'thinking');
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(60_000);
    expect(presence.get(sessionId)).toEqual({
      machineId,
      status: SessionStatusFactory.running(),
      at: 60_000,
    });
    expect(vi.getTimerCount()).toBe(1);
  });

  it('tracks active sessions and clears all owned entries', () => {
    const { presence, controller } = fixture();
    const otherSessionId = 'session-active-presence-2' as SessionId;
    controller.start(sessionId, 'initializing');
    controller.start(otherSessionId, 'thinking');
    expect(controller.has(sessionId)).toBe(true);
    expect(controller.getStatus(sessionId)).toEqual(SessionStatusFactory.initializing());
    expect(controller.getStatus('missing-session' as SessionId)).toBeNull();
    expect(controller.activeSessionCount()).toBe(2);
    controller.clearAll();
    expect(controller.has(sessionId)).toBe(false);
    expect(controller.activeSessionCount()).toBe(0);
    expect(presence.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
