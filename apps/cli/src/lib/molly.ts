import { LoroDocumentManager } from '@/lib/loro/doc';
import { MachineRuntime } from '@/lib/machine-runtime';
import { Logger } from '@/utils/logger';
import {
  type LocalProjectId,
  MachineId,
  type SessionId,
  WorkspaceId,
  type LocalSessionControlRequest,
  type LocalSessionControlResponse,
  type LocalMachineRpcRequestValidated,
  type LocalMachineRpcResponse,
  type MachineLifecycleCapability,
} from '@molly/shared';
import { getLoginShellEnv } from '@/agent/login-shell-env';
import { SessionManager } from '@/session/session-manager';
import pkg from '@/pkg';
import type { LocalWorkspaceCatalogService } from '@/lib/local-workspace-catalog';
import type { MachineProcessLifecycleAction } from './machine-lifecycle';
import { traceAsync } from '@/utils/trace-span';
import type { MemoryPressureSnapshotSource } from '@/monitor/memory-pressure-sampler';
import type { WorkspaceWatchCoordinatorApi } from '@/lib/code-collab/workspace-watch-coordinator';
import type { CloudPort } from '@molly/platform';

interface MollyOptions {
  logger: Logger;
  supportRegistryAgentTypes?: string[];
  workspaceId: WorkspaceId;
  workspaceSlug?: string;
  token: string;
  userId: string;
  machineId: MachineId;
  machineName: string;
  localWorkspaceCatalog?: LocalWorkspaceCatalogService;
  memoryPressure: MemoryPressureSnapshotSource;
  machineLifecycleCapability: MachineLifecycleCapability;
  closeSessionTerminals?: (sessionId: SessionId) => void;
  cleanupLocalProjectWorktreeSetupIfUnreferenced?: (
    localProjectId: LocalProjectId
  ) => Promise<void>;
  onFatalAuthFailure?: (error: Error) => void;
  onProcessLifecycleAction?: (action: MachineProcessLifecycleAction) => void;
  workspaceWatchCoordinator?: WorkspaceWatchCoordinatorApi;
  cloudPort: CloudPort;
}
export class Molly {
  private logger: Logger;
  private userId: string;
  private workspaceId: WorkspaceId;
  private workspaceSlug?: string;
  private token: string;
  private machineId: MachineId;
  private machineName: string;
  private runtime: MachineRuntime;
  private supportRegistryAgentTypes: string[];
  static async create(options: MollyOptions): Promise<Molly> {
    const manager = await traceAsync(
      options.logger,
      'startup.loro_document_manager',
      { workspaceId: options.workspaceId },
      async () =>
        await LoroDocumentManager.create(options.workspaceId, options.userId, options.logger, {
          streamsTokens: options.cloudPort.streamsTokens,
          cloudBilling: options.cloudPort.billing,
        })
    );
    return new Molly(options, manager);
  }

  constructor(
    public readonly options: MollyOptions,
    public readonly documentManager: LoroDocumentManager
  ) {
    this.logger = options.logger;

    this.userId = options.userId;
    this.workspaceId = options.workspaceId;
    this.workspaceSlug = options.workspaceSlug ?? undefined;
    this.token = options.token;
    this.machineId = options.machineId;
    this.machineName = options.machineName;
    this.supportRegistryAgentTypes = options.supportRegistryAgentTypes ?? [];
    this.runtime = new MachineRuntime({
      sessionManagerFactory: () =>
        new SessionManager(
          this.logger,
          this.token,
          this.machineId,
          this.workspaceId,
          documentManager,
          { cloudPort: options.cloudPort }
        ),
      workspaceDocument: documentManager,
      memoryPressure: options.memoryPressure,
      handlerConfig: {
        token: this.token,
        workspaceId: this.workspaceId,
        workspaceSlug: this.workspaceSlug,
        userId: this.userId,
        machineId: this.machineId,
        machineName: this.machineName,
        cliVersion: pkg.version,
        machineLifecycleCapability: options.machineLifecycleCapability,
        supportRegistryAgentTypes: this.supportRegistryAgentTypes,
        ...(options.localWorkspaceCatalog
          ? { localWorkspaceCatalog: options.localWorkspaceCatalog }
          : {}),
        closeSessionTerminals: options.closeSessionTerminals,
        cleanupLocalProjectWorktreeSetupIfUnreferenced:
          options.cleanupLocalProjectWorktreeSetupIfUnreferenced,
        onFatalAuthFailure: options.onFatalAuthFailure,
        onProcessLifecycleAction: options.onProcessLifecycleAction,
        workspaceWatchCoordinator: options.workspaceWatchCoordinator,
        cloudPort: options.cloudPort,
      },
      logger: this.logger,
    });
  }

  async start(): Promise<void> {
    // Warm the login-shell env probe (~100-300ms) concurrently with startup so
    // synchronous terminal environment callbacks usually read a populated PATH.
    // ACP startup awaits the same cached probe before spawning. Fire-and-forget:
    // getLoginShellEnv swallows failures and fails open to an empty overlay.
    void getLoginShellEnv();
    await traceAsync(
      this.logger,
      'startup.machine_runtime',
      { workspaceId: this.workspaceId },
      async () => await this.runtime.initialize()
    );
    this.documentManager.ensureMachineFlockDocJoined(this.machineId, { reason: 'lody-start' });
  }

  cleanup = async () => await this.runtime.cleanup();

  async dispatchLocalControl(
    message: LocalSessionControlRequest,
    options: { onResponse?: (response: LocalSessionControlResponse) => void } = {}
  ): Promise<LocalSessionControlResponse[]> {
    const responses = await this.runtime.dispatchLocalMessageForResponse(message, options);
    return responses as LocalSessionControlResponse[];
  }

  async dispatchLocalMachineRpc(
    message: LocalMachineRpcRequestValidated
  ): Promise<LocalMachineRpcResponse> {
    return await this.runtime.dispatchLocalMachineRpc(message);
  }

  isControlPlaneReady(): boolean {
    // Ready == nothing needs recovering. Deliberately NOT gated on
    // `isTransportConnected()`: that is the raw aggregate status, which reads
    // `connecting` whenever any room is lazily joining — ordinary churn in a
    // workspace with thousands of rooms, not a degraded control plane. See
    // `LoroStreamsHealth` in `loro/connection-recovery.ts`.
    return !this.documentManager.isTransportRecovering();
  }

  isControlPlaneRecovering(): boolean {
    return this.documentManager.isTransportRecovering();
  }

  getActiveSessionCount(): number {
    return this.runtime.getActiveSessionCount();
  }

  async resolveSessionWorkdir(sessionId: SessionId): Promise<string | null> {
    return await this.runtime.resolveSessionWorkdir(sessionId);
  }

  onSessionTerminated(handler: (sessionId: SessionId) => void): () => void {
    return this.runtime.onSessionTerminated(handler);
  }

  getConnectedRoomCount(): number {
    return this.documentManager.getConnectedRoomCount();
  }
}
