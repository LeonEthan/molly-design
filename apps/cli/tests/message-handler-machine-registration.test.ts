import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type LocalProjectId,
  type MachineLegacyMetaFields,
  type MachineId,
  type MachineMeta,
  type SessionId,
  type WorkspaceId,
} from '@molly/shared';
import { MessageHandler } from '../src/lib/message-handler';
import type { LoroDocumentManager } from '../src/lib/loro/doc';
import type { SessionManager } from '../src/session/session-manager';
import type { Logger } from '../src/utils/logger';
import { createTestCloudPort } from './test-cloud-port';

const createSilentLogger = (): Logger => ({
  info: () => {},
  warn: () => {},
  error: () => {},
  success: () => {},
  debug: () => {},
  setLevel: () => {},
  child: () => createSilentLogger(),
  close: async () => {},
});

describe('MessageHandler machine registration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preserves synced name without rewriting legacy bulky machine metadata on registration', async () => {
    const logger = createSilentLogger();
    const machineId = 'machine-1' as MachineId;
    const localProjectId = 'local-project-1' as LocalProjectId;
    const queuedDeleteSessionId = 'session-to-delete-1' as SessionId;

    const existingMachineMeta: MachineMeta & MachineLegacyMetaFields = {
      id: machineId,
      name: 'existing-machine-name',
      ownerUserId: 'user-1',
      cliVersion: '0.0.1',
      os: 'darwin',
      sessions: [],
      localProjects: {
        [localProjectId]: {
          id: localProjectId,
          name: 'sample-project',
          rootPath: '/tmp/sample-project',
          createdAtMs: 1,
          lastOpenedAtMs: 2,
        },
      },
      needToArchiveSessions: {},
      needToDeleteSessions: { [queuedDeleteSessionId]: true },
      raceLimits: {},
      lastSeen: 123,
    };

    const workspaceDocument = {
      sessions: new Map<SessionId, unknown>(),
      restoreMachineDocument: vi.fn(async () => {}),
      watchMachineDocumentExistence: vi.fn(() => {}),
      registerMachine: vi.fn(async () => {}),
      repo: {
        watch: vi.fn(() => ({ unsubscribe: vi.fn() })),
        getDocMeta: vi.fn(async () => ({ meta: existingMachineMeta })),
      },
    };

    const sessionManager = {
      on: vi.fn(),
      setRequestPermissionHandler: vi.fn(),
      getSession: vi.fn(),
      finishSession: vi.fn(),
      cleanUp: vi.fn(async () => {}),
      setSessionError: vi.fn(),
      terminateSession: vi.fn(),
      hasSession: vi.fn(),
      initialize: vi.fn(),
      createSession: vi.fn(),
      releaseGitHubRepoOwner: vi.fn(),
    };
    const registerMachineAccess = vi.fn(async () => {});

    const handler = new MessageHandler(
      sessionManager as unknown as SessionManager,
      workspaceDocument as unknown as LoroDocumentManager,
      logger,
      {
        token: 'token',
        workspaceId: 'workspace-1' as WorkspaceId,
        userId: 'user-1',
        machineId,
        machineName: 'new-machine-name',
        cliVersion: '1.2.3',
        cloudPort: createTestCloudPort({
          access: { registerMachineAccess },
        }),
      }
    );

    await handler.registerMachine();

    const [registeredMachineId, registeredMeta] = workspaceDocument.registerMachine.mock
      .calls[0] as [MachineId, MachineMeta & MachineLegacyMetaFields];

    expect(registeredMachineId).toBe(machineId);
    expect(registeredMeta.localProjects).toBeUndefined();
    expect(registeredMeta.needToArchiveSessions).toBeUndefined();
    expect(registeredMeta.needToDeleteSessions).toBeUndefined();
    expect(registeredMeta.name).toBe('existing-machine-name');
    expect(registeredMeta.cliVersion).toBe('1.2.3');
    expect(registerMachineAccess).not.toHaveBeenCalled();

    await handler.cleanup();
  });

  it('publishes local machine capabilities without a remote RPC version', async () => {
    const logger = createSilentLogger();
    const machineId = 'machine-rpc' as MachineId;
    const workspaceDocument = {
      sessions: new Map<SessionId, unknown>(),
      restoreMachineDocument: vi.fn(async () => {}),
      watchMachineDocumentExistence: vi.fn(() => {}),
      registerMachine: vi.fn(async () => {}),
      repo: {
        watch: vi.fn(() => ({ unsubscribe: vi.fn() })),
        getDocMeta: vi.fn(async () => undefined),
      },
    };

    const sessionManager = {
      on: vi.fn(),
      setRequestPermissionHandler: vi.fn(),
      getSession: vi.fn(),
      finishSession: vi.fn(),
      cleanUp: vi.fn(async () => {}),
      setSessionError: vi.fn(),
      terminateSession: vi.fn(),
      hasSession: vi.fn(),
      initialize: vi.fn(),
      createSession: vi.fn(),
      releaseGitHubRepoOwner: vi.fn(),
    };

    const handler = new MessageHandler(
      sessionManager as unknown as SessionManager,
      workspaceDocument as unknown as LoroDocumentManager,
      logger,
      {
        token: 'token',
        workspaceId: 'workspace-1' as WorkspaceId,
        userId: 'user-1',
        machineId,
        machineName: 'machine-name',
        cliVersion: '1.2.3',
        cloudPort: createTestCloudPort(),
      }
    );

    await handler.registerMachine();

    const [, registeredMeta] = workspaceDocument.registerMachine.mock.calls[0] as [
      MachineId,
      MachineMeta,
    ];

    expect(registeredMeta.rpcVersion).toBeUndefined();
    expect(registeredMeta.name).toBe('machine-name');
    // Exhaustive on purpose: registration is where a capability key and its
    // version reach every client, so adding one must be acknowledged here.
    expect(registeredMeta.protocolCapabilities).toEqual({
      sessionStopControl: 1,
      acpAuthenticationInteractions: 2,
      localProjectRemoval: 1,
      localFileResources: 1,
      localSessionAttachments: 1,
      designCanvasSerialEditing: 1,
      designToolHooks: 2,
      providerSetup: 1,
      acpProtocolAuthentication: 2,
      subagentCancellation: 1,
    });

    await handler.cleanup();
  });
});
