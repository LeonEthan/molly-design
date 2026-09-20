import { createHash } from 'node:crypto';
import type { Writable } from 'node:stream';
import type { McpServer, PromptResponse } from '@agentclientprotocol/sdk';
import {
  HarnessRunOutcomeSchema,
  HarnessRunSnapshotSchema,
  HarnessSessionBindingSchema,
  ModelSelectionSchema,
  type HarnessSessionBinding,
  McpCredentialBindingSchema,
  HarnessMcpPreparationSchema,
  mcpCredentialMatchesServer,
  type McpCredentialBinding,
  type HarnessMcpPreparation,
  HarnessImageImportRequestSchema,
  McpImageBindingSchema,
  MOLLY_BUILTIN_MCP_CONNECTION,
  type HarnessImageImportRequest,
  type HarnessImageImportResult,
  HarnessImageRecoveryRequestSchema,
  type HarnessImageRecoveryRequest,
  type HarnessImageRecoveryResult,
} from '@molly/shared/embedded-harness';
import {
  WorkerConfigSchema,
  WorkerCredentialGrantSchema,
  WorkerMcpCredentialGrantSchema,
  type WorkerConfig,
} from '@molly/harness-pi/worker-config';
import type { HarnessCredentialBroker } from './harness-credential-broker';

/** Host half of the inherited private pipe. Never forwards grants over ACP or logs them. */
export class EmbeddedHarnessControl {
  private binding?: HarnessSessionBinding;
  private retired = false;
  private busy = false;
  private mcpConnections: McpCredentialBinding[] = [];
  private activeController?: AbortController;
  private activeRun?: { runId: string; turnId: string };
  private selectedMcp: readonly McpServer[] = [];
  private stopPromise?: Promise<void>;
  private stopOnce(): Promise<void> {
    return (this.stopPromise ??= this.stop());
  }
  private readonly imageConnection: ReturnType<HarnessCredentialBroker['imageCatalog']>;
  constructor(
    readonly config: WorkerConfig,
    private readonly pipe: Writable,
    private readonly broker: HarnessCredentialBroker,
    private readonly stop: () => Promise<void>
  ) {
    this.config = WorkerConfigSchema.parse(config);
    this.imageConnection = broker.imageCatalog();
    // A rejected/closed child pipe must be handled without logging its payload.
    pipe.on('error', () => {
      this.retired = true;
    });
    pipe.on('close', () => {
      this.retired = true;
    });
  }

  private async write(value: unknown): Promise<void> {
    if (this.retired || this.pipe.destroyed) throw new Error('harness_worker_retired');
    const packet = Buffer.from(`${JSON.stringify(value)}\n`);
    try {
      await new Promise<void>((resolve, reject) =>
        this.pipe.write(packet, (error) =>
          error ? reject(new Error('harness_control_write_failed')) : resolve()
        )
      );
    } finally {
      packet.fill(0);
    }
  }

  bootstrap(): Promise<void> {
    return this.write(this.config);
  }

  configureMcp(servers: readonly McpServer[]): void {
    if (this.busy || this.binding) throw new Error('harness_mcp_already_bound');
    this.selectedMcp = structuredClone(servers);
    this.mcpConnections = servers.flatMap((server) => {
      const metadata = server._meta?.mollyMcpCredential;
      if (metadata === undefined) return [];
      const binding = McpCredentialBindingSchema.parse(metadata);
      const catalog = server._meta?.mollyConnection;
      if (
        binding.workspaceId !== this.config.workspaceId ||
        !mcpCredentialMatchesServer(binding, server) ||
        !catalog ||
        typeof catalog !== 'object' ||
        !('id' in catalog) ||
        catalog.id !== binding.serverId
      )
        throw new Error('harness_mcp_binding_mismatch');
      return [binding];
    });
  }

  async importImages(
    raw: HarnessImageImportRequest,
    receive: (
      request: HarnessImageImportRequest,
      signal: AbortSignal
    ) => Promise<HarnessImageImportResult>
  ): Promise<HarnessImageImportResult> {
    const request = HarnessImageImportRequestSchema.parse(raw);
    const run = this.activeRun;
    const controller = this.activeController;
    const server = this.selectedMcp.find((entry) => entry.name === request.serverName);
    const image = McpImageBindingSchema.safeParse(server?._meta?.mollyImageBinding);
    const catalog = server?._meta?.mollyConnection;
    const builtin =
      catalog &&
      typeof catalog === 'object' &&
      'id' in catalog &&
      'revision' in catalog &&
      catalog.id === MOLLY_BUILTIN_MCP_CONNECTION.id &&
      catalog.revision === MOLLY_BUILTIN_MCP_CONNECTION.revision;
    const ownsImage = builtin
      ? this.imageConnection?.id === request.connectionId &&
        this.imageConnection.revision === request.connectionRevision &&
        JSON.stringify(this.imageConnection) === JSON.stringify(this.broker.imageCatalog()) &&
        ['molly_generate_image', 'molly_edit_image'].includes(request.toolName)
      : catalog &&
        typeof catalog === 'object' &&
        'id' in catalog &&
        'revision' in catalog &&
        catalog.id === request.connectionId &&
        catalog.revision === request.connectionRevision &&
        image.success &&
        [image.data.generate?.tool, image.data.edit?.tool].includes(request.toolName);
    if (
      !this.config.designImageImport ||
      this.retired ||
      !this.busy ||
      !run ||
      !controller ||
      controller.signal.aborted ||
      request.runId !== run.runId ||
      request.turnId !== run.turnId ||
      request.runtimeEpoch !== this.config.runtimeEpoch ||
      request.productSessionId !== this.config.productSessionId ||
      !ownsImage
    )
      throw new Error('harness_image_import_not_owned');
    const result = await receive(request, controller.signal);
    controller.signal.throwIfAborted();
    if (this.retired || this.activeRun !== run) throw new Error('harness_image_import_not_owned');
    return result;
  }

  async recoverImages(
    raw: HarnessImageRecoveryRequest,
    receive: (
      request: HarnessImageRecoveryRequest,
      signal: AbortSignal
    ) => Promise<HarnessImageRecoveryResult>
  ): Promise<HarnessImageRecoveryResult> {
    const request = HarnessImageRecoveryRequestSchema.parse(raw);
    const run = this.activeRun;
    const controller = this.activeController;
    if (
      !this.config.designImageRecovery ||
      this.retired ||
      !this.busy ||
      !run ||
      !controller ||
      controller.signal.aborted ||
      request.runId !== run.runId ||
      request.turnId !== run.turnId ||
      request.runtimeEpoch !== this.config.runtimeEpoch ||
      request.productSessionId !== this.config.productSessionId
    )
      throw new Error('harness_image_recovery_not_owned');
    const result = await receive(request, controller.signal);
    controller.signal.throwIfAborted();
    if (this.retired || this.activeRun !== run) throw new Error('harness_image_recovery_not_owned');
    return result;
  }

  /** Catalog ownership can revoke an idle or active worker, never retarget it. */
  async invalidate(): Promise<void> {
    this.retired = true;
    this.activeController?.abort();
    await this.stopOnce();
  }

  assertSelection(selection: unknown): void {
    const parsed = ModelSelectionSchema.safeParse(selection);
    if (!parsed.success || JSON.stringify(parsed.data) !== JSON.stringify(this.config.selection)) {
      throw new Error('harness_model_selection_requires_new_worker');
    }
  }

  needsReplacement(selection: unknown): boolean {
    if (this.busy) throw new Error('harness_run_busy');
    const selected = ModelSelectionSchema.parse(selection);
    const connection = this.broker
      .catalog()
      .find((entry) => entry.id === selected.connectionId && entry.enabled);
    if (!connection) throw new Error('harness_connection_unavailable');
    return (
      this.retired ||
      JSON.stringify(selected) !== JSON.stringify(this.config.selection) ||
      JSON.stringify(connection) !== JSON.stringify(this.config.connection) ||
      JSON.stringify(this.imageConnection) !== JSON.stringify(this.broker.imageCatalog())
    );
  }

  bind(binding: HarnessSessionBinding): void {
    binding = HarnessSessionBindingSchema.parse(binding);
    if (
      this.binding ||
      binding.runtimeEpoch !== this.config.runtimeEpoch ||
      JSON.stringify(binding.harness) !== JSON.stringify(this.config.harness)
    )
      throw new Error('harness_worker_identity_mismatch');
    this.binding = binding;
  }

  async prompt(input: {
    turnId: string;
    signal: AbortSignal;
    prepareMcp?: (preparation: HarnessMcpPreparation, signal: AbortSignal) => Promise<unknown>;
    prompt: (
      snapshot: ReturnType<typeof HarnessRunSnapshotSchema.parse>
    ) => Promise<PromptResponse>;
  }): Promise<PromptResponse> {
    if (this.retired || this.busy || !this.binding) throw new Error('harness_worker_unavailable');
    input.signal.throwIfAborted();
    this.busy = true;
    let snapshot = HarnessRunSnapshotSchema.parse({
      schemaVersion: 1,
      // Turn identity, not process identity: a restart may not replay a dispatched user task.
      runId: createHash('sha256')
        .update(JSON.stringify([this.config.productSessionId, input.turnId]))
        .digest('hex'),
      runtimeEpoch: this.config.runtimeEpoch,
      sessionId: this.config.productSessionId,
      turnId: input.turnId,
      connection: this.config.connection,
      imageConnection: this.imageConnection ?? undefined,
      ...(this.mcpConnections.length ? { mcpConnections: this.mcpConnections } : {}),
      selection: this.config.selection,
      harness: this.config.harness,
      toolsetHash: this.binding.toolsetHash,
      pluginSetHash: this.binding.pluginSetHash,
      permissionProfileId: this.config.permissionProfileId,
    });
    const controller = new AbortController();
    this.activeController = controller;
    const abort = () => controller.abort();
    input.signal.addEventListener('abort', abort, { once: true });
    let stopping: Promise<boolean> | undefined;
    const stopWorker = () =>
      (stopping ??= this.stopOnce().then(
        () => true,
        () => false
      ));
    const retire = () => {
      this.retired = true;
      controller.abort();
      void stopWorker();
    };
    let lease: ReturnType<HarnessCredentialBroker['acquire']> | undefined;
    let mcpLease: ReturnType<HarnessCredentialBroker['acquireMcp']> | undefined;
    try {
      if (this.mcpConnections.length) {
        if (!input.prepareMcp) throw new Error('harness_mcp_preparation_required');
        const preparation = HarnessMcpPreparationSchema.parse({
          version: 1,
          runId: snapshot.runId,
          runtimeEpoch: snapshot.runtimeEpoch,
          sessionId: snapshot.sessionId,
          turnId: snapshot.turnId,
          workspaceId: this.config.workspaceId,
          connection: this.config.connection,
          mcpConnections: this.mcpConnections,
        });
        mcpLease = this.broker.acquireMcp(preparation, {
          signal: controller.signal,
          active: () => !this.retired && this.busy && !controller.signal.aborted,
          revoke: retire,
        });
        const credentials = await mcpLease.credentials;
        controller.signal.throwIfAborted();
        const grant = WorkerMcpCredentialGrantSchema.safeParse({
          type: 'mcp-credentials',
          runId: preparation.runId,
          runtimeEpoch: preparation.runtimeEpoch,
          credentials,
        });
        if (!grant.success) throw new Error('harness_mcp_credential_limit');
        await this.write(grant.data);
        const prepared = HarnessSessionBindingSchema.parse(
          await input.prepareMcp(preparation, controller.signal)
        );
        controller.signal.throwIfAborted();
        if (
          prepared.runtimeEpoch !== this.binding.runtimeEpoch ||
          JSON.stringify(prepared.harness) !== JSON.stringify(this.binding.harness) ||
          prepared.pluginSetHash !== this.binding.pluginSetHash ||
          prepared.nativeSessionFile !== this.binding.nativeSessionFile
        )
          throw new Error('harness_mcp_preparation_mismatch');
        this.binding = prepared;
        snapshot = HarnessRunSnapshotSchema.parse({
          ...snapshot,
          toolsetHash: prepared.toolsetHash,
        });
      }
      lease = this.broker.acquire(snapshot, {
        signal: controller.signal,
        active: () => !this.retired && this.busy && !controller.signal.aborted,
        revoke: retire,
      });
      const apiKey = await lease.credential;
      controller.signal.throwIfAborted();
      await this.write(
        WorkerCredentialGrantSchema.parse({
          type: 'credential',
          runtimeEpoch: snapshot.runtimeEpoch,
          runId: snapshot.runId,
          apiKey,
        })
      );
      controller.signal.throwIfAborted();
      this.activeRun = { runId: snapshot.runId, turnId: snapshot.turnId };
      const response = await input.prompt(snapshot);
      controller.signal.throwIfAborted();
      const outcome = HarnessRunOutcomeSchema.safeParse(response._meta?.mollyNativeOutcome);
      if (
        !outcome.success ||
        response._meta?.mollyRunId !== snapshot.runId ||
        response._meta?.mollyRuntimeEpoch !== snapshot.runtimeEpoch ||
        (response.stopReason === 'end_turn'
          ? outcome.data.status !== 'completed'
          : response.stopReason !== 'cancelled' || outcome.data.status !== 'cancelled')
      ) {
        throw new Error('harness_native_outcome_invalid');
      }
      return response;
    } catch (error) {
      // A channel containing an unread grant cannot safely serve another run.
      this.retired = true;
      // eslint-disable-next-line preserve-caught-error -- The diagnostic must not carry transport payloads.
      if (!(await stopWorker())) throw new Error('harness_worker_exit_unconfirmed');
      throw error;
    } finally {
      input.signal.removeEventListener('abort', abort);
      lease?.release();
      mcpLease?.release();
      this.busy = false;
      this.activeController = undefined;
      this.activeRun = undefined;
    }
  }
}
