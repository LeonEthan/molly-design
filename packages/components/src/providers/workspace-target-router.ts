import {
  getSessionIdFromRoomId,
  PREVIEW_COMMENT_DOC_PREFIX,
  type MachineId,
  type SessionId,
} from '@molly/shared';

/** Matches loro-repo's room and route shapes. */
export type WorkspaceTransportRoom = {
  readonly kind: 'meta' | 'doc' | 'flock-doc';
  readonly id: string;
};
export type WorkspaceTransportRoute = { readonly transportIds: ReadonlyArray<string> };
export type WorkspaceTargetPlane = 'local' | 'cloud';

type WorkspaceTargetRouterDeps = { readonly onRouteChange?: () => void };

function sessionIdFromRoom(roomId: string): SessionId | null {
  const sessionId = getSessionIdFromRoomId(roomId);
  if (sessionId) return sessionId;
  return roomId.startsWith(PREVIEW_COMMENT_DOC_PREFIX)
    ? (roomId.slice(PREVIEW_COMMENT_DOC_PREFIX.length) as SessionId)
    : null;
}

function machineIdFromMeta(meta: unknown): MachineId | null {
  if (!meta || typeof meta !== 'object') return null;
  const machineId = (meta as { machineId?: unknown }).machineId;
  return typeof machineId === 'string' && machineId.length > 0 ? (machineId as MachineId) : null;
}

/**
 * Keeps the session owner assertion for old document readback. The desktop has
 * one local transport, so room placement and Machine RPC never depend on an
 * owner being published or on a remote machine being reachable.
 */
export class WorkspaceTargetRouter {
  private readonly onRouteChange?: () => void;
  private readonly machineBySessionId = new Map<SessionId, MachineId>();

  constructor(deps: WorkspaceTargetRouterDeps = {}) {
    this.onRouteChange = deps.onRouteChange;
  }

  setLocalMachineId(_machineId: MachineId | null): void {
    this.onRouteChange?.();
  }

  observeDocMeta(roomId: string, meta: unknown): void {
    const sessionId = sessionIdFromRoom(roomId);
    const machineId = machineIdFromMeta(meta);
    if (!sessionId || !machineId) return;
    try {
      this.rememberSessionTarget(sessionId, machineId);
    } catch (error) {
      console.error('WorkspaceTargetRouter: ignored conflicting session owner', {
        roomId,
        machineId,
        error,
      });
    }
  }

  rememberSessionTarget(sessionId: SessionId, machineId: MachineId): void {
    const existing = this.machineBySessionId.get(sessionId);
    if (existing && existing !== machineId) {
      throw new Error(
        `workspace_target_conflict: session ${sessionId} is owned by ${existing}, not ${machineId}`
      );
    }
    if (existing === machineId) return;
    this.machineBySessionId.set(sessionId, machineId);
    this.onRouteChange?.();
  }

  getPlaneForMachine(_machineId: MachineId): WorkspaceTargetPlane {
    return 'local';
  }

  async resolvePlaneForMachine(
    _machineId: MachineId,
    _options: { timeoutMs?: number } = {}
  ): Promise<WorkspaceTargetPlane> {
    return 'local';
  }

  getPlaneForSession(_sessionId: SessionId): WorkspaceTargetPlane {
    return 'local';
  }

  getPlaneForDocRoom(_roomId: string): WorkspaceTargetPlane {
    return 'local';
  }

  getPlaneForFlockDoc(_flockDocId: string): WorkspaceTargetPlane {
    return 'local';
  }

  resolveTransportRoute(_room: WorkspaceTransportRoom): WorkspaceTransportRoute {
    return { transportIds: ['local'] };
  }

  getReadinessTransportForRoom(_room: WorkspaceTransportRoom): WorkspaceTargetPlane {
    return 'local';
  }

  async prepareSessionTarget(
    sessionId: SessionId,
    assertedMachineId?: MachineId | null
  ): Promise<WorkspaceTargetPlane> {
    if (assertedMachineId) this.rememberSessionTarget(sessionId, assertedMachineId);
    return 'local';
  }

  async prepareDocTarget(
    roomId: string,
    patch?: Record<string, unknown>
  ): Promise<WorkspaceTargetPlane> {
    if (patch) this.observeDocMeta(roomId, patch);
    return 'local';
  }
}
