import { realpath } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type * as acp from '@agentclientprotocol/sdk';
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import { LODY_EXTENSION_METHODS, SessionUsageAccumulator } from 'acp-extension-core';
import {
  HarnessIdentitySchema,
  HarnessRunSnapshotSchema,
  ModelConnectionSchema,
  ModelSelectionSchema,
  type HarnessRunSnapshot,
  PI_ENGINE_VERSION,
  MOLLY_BUILTIN_MCP_CONNECTION,
  ImageOperationResultSchema,
  MOLLY_PROVIDER_IDS,
  MOLLY_PREPARE_MCP_METHOD,
  HarnessMcpPreparationSchema,
  McpCredentialBindingSchema,
  McpImageBindingSchema,
  StoredMcpCredentialSchema,
  mcpCredentialMatchesServer,
  type HarnessMcpPreparation,
  HarnessImageImportRequestSchema,
  HARNESS_INLINE_IMAGE_RESULT_META,
  type HarnessImageImportRequest,
  type HarnessImageImportResult,
  HARNESS_QUESTION_DISMISS_METHOD,
  HarnessQuestionIdentitySchema,
  SESSION_ATTACHMENTS_DIR_RELATIVE,
} from '@molly/shared/embedded-harness';
import { createMollySession, type CreateMollySessionInput } from './session-factory';
import { NativeRunOutcome } from './run-outcome';
import { RunJournal } from './run-journal';
import { hashToolset, type ToolApproval } from './approved-tools';
import { describeToolCall } from './tool-presentation';
import { connectMcpBridge } from './mcp-bridge';
import { ToolOperationJournal } from './tool-operation-journal';
import { z } from 'zod';
import { resolveMcpContent } from './mcp-content';
import { createImageRecoveryTool, type ImageRecoveryProvider } from './image-recovery-tool';
import { createExtensionUI } from './extension-ui';
import { QUESTION_EXTENSION_IDENTITY } from './question-extension';

type OwnedSession = Awaited<ReturnType<typeof createMollySession>>;
type AcpPeer = Pick<acp.AgentSideConnection, 'sessionUpdate'> &
  Partial<
    Pick<acp.AgentSideConnection, 'extNotification' | 'extMethod' | 'unstable_createElicitation'>
  >;
export type RunCredentialProvider = (
  snapshot: HarnessRunSnapshot,
  signal: AbortSignal
) => Promise<string>;
export type McpCredentialProvider = (
  preparation: HarnessMcpPreparation,
  signal: AbortSignal
) => Promise<Array<ReturnType<typeof StoredMcpCredentialSchema.parse>>>;
export type ImageImportProvider = (
  request: HarnessImageImportRequest,
  signal: AbortSignal
) => Promise<HarnessImageImportResult>;

/** One owned native context per worker. The daemon remains the only task dispatcher. */
export class MollyAcpAdapter implements acp.Agent {
  private owned?: OwnedSession;
  private running?: {
    tracker: NativeRunOutcome;
    snapshot: HarnessRunSnapshot;
    controller: AbortController;
    sideEffectOutcomeUnknown?: boolean;
    paidOperationFailed?: boolean;
    questionFailed?: boolean;
    extensionFailed?: boolean;
  };
  private claimed = false;
  private closed = false;
  private streamedText = false;
  private readonly journal: RunJournal;
  private readonly usage = new SessionUsageAccumulator();
  private bridge?: Awaited<ReturnType<typeof connectMcpBridge>>;
  private toolsetHash: string;
  private pluginSetHash: string;
  private questionUI?: ReturnType<typeof createExtensionUI>;
  private protectedServers: acp.McpServer[] = [];
  private protectedBridge?: Awaited<ReturnType<typeof connectMcpBridge>>;
  private bridgeOptions?: Parameters<typeof connectMcpBridge>[1];
  private sessionInput?: CreateMollySessionInput;
  private preparing?: AbortController;
  private prepared?: HarnessMcpPreparation;

  constructor(
    private readonly peer: AcpPeer,
    private readonly input: CreateMollySessionInput & {
      runtimeEpoch: string;
      productSessionId: string;
      toolsetHash: string;
      pluginSetHash: string;
      permissionProfileId: string;
      harness: HarnessRunSnapshot['harness'];
      workspaceId?: string;
    },
    private readonly createSession = createMollySession,
    private readonly credentialProvider: RunCredentialProvider = async () => {
      if (!input.apiKey) throw new Error('harness_credential_required');
      return input.apiKey;
    },
    private readonly approveMcp: ToolApproval = async () => false,
    private readonly mcpCredentialProvider: McpCredentialProvider = async () => {
      throw new Error('harness_mcp_credential_required');
    },
    private readonly importImages?: ImageImportProvider,
    recoverImages?: ImageRecoveryProvider
  ) {
    if (recoverImages) {
      if (input.tools.some((tool) => tool.name === 'molly_recover_images'))
        throw new Error('harness_duplicate_tool');
      this.input = {
        ...input,
        tools: [
          ...input.tools,
          createImageRecoveryTool({
            approve: approveMcp,
            recover: recoverImages,
            current: () =>
              this.running
                ? { snapshot: this.running.snapshot, signal: this.running.controller.signal }
                : undefined,
          }),
        ],
      };
    }
    this.journal = new RunJournal(join(input.privateRoot, 'runs'));
    this.toolsetHash = input.toolsetHash;
    this.pluginSetHash = input.pluginSetHash;
  }

  get currentSessionId(): string | undefined {
    return this.owned?.manager.getSessionId();
  }

  async initialize(params?: acp.InitializeRequest): Promise<acp.InitializeResponse> {
    if (this.claimed || this.questionUI) throw new Error('harness_already_initialized');
    if (
      params?.clientCapabilities?.elicitation?.form &&
      z
        .object({ version: z.literal(1) })
        .strict()
        .safeParse(params.clientCapabilities._meta?.mollyQuestionUI).success &&
      this.peer.unstable_createElicitation &&
      this.peer.extMethod
    ) {
      const identities = new Map<string, z.infer<typeof HarnessQuestionIdentitySchema>>();
      const elicit = this.peer.unstable_createElicitation.bind(this.peer);
      const dismiss = this.peer.extMethod.bind(this.peer);
      this.questionUI = createExtensionUI({
        currentSignal: () => this.running?.controller.signal,
        open: async (question, signal) => {
          signal.throwIfAborted();
          const run = this.running;
          const sessionId = this.currentSessionId;
          if (!run || !sessionId || !question.id) throw new Error('harness_question_outside_run');
          const identity = HarnessQuestionIdentitySchema.parse({
            version: 1,
            questionId: question.id,
            runId: run.snapshot.runId,
            runtimeEpoch: run.snapshot.runtimeEpoch,
          });
          identities.set(question.id, identity);
          const response = await elicit({
            mode: 'form',
            sessionId,
            toolCallId: question.id,
            message: question.question,
            requestedSchema: {
              type: 'object',
              properties: {
                [question.id]: {
                  type: 'string',
                  title: question.header,
                  ...(question.options.length > 0
                    ? { enum: question.options.map((option) => option.label) }
                    : {}),
                },
              },
            },
            _meta: {
              lody: { elicitation: { version: 1, autoResolveAfterSeconds: null } },
              mollyQuestion: identity,
            },
          });
          if (signal.aborted || this.running !== run || response.action !== 'accept')
            return undefined;
          const answer = z.record(z.string(), z.unknown()).optional().parse(response.content)?.[
            question.id
          ];
          if (answer !== undefined && typeof answer !== 'string')
            throw new Error('harness_question_invalid_answer');
          return answer;
        },
        dismiss: async (id) => {
          const request = identities.get(id);
          if (!request) return;
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            const response = await Promise.race([
              dismiss(HARNESS_QUESTION_DISMISS_METHOD, {
                sessionId: this.currentSessionId,
                request,
              }),
              new Promise<never>((_, reject) => {
                timer = setTimeout(
                  () => reject(new Error('harness_question_dismiss_timeout')),
                  5000
                );
              }),
            ]);
            z.object({ version: z.literal(1), dismissed: z.literal(true) })
              .strict()
              .parse(response);
          } finally {
            clearTimeout(timer);
            identities.delete(id);
          }
        },
        notify: (message) => {
          const run = this.running;
          const sessionId = this.currentSessionId;
          if (!run || !sessionId) throw new Error('harness_question_outside_run');
          void this.peer
            .sessionUpdate({
              sessionId,
              update: {
                sessionUpdate: 'agent_message_chunk',
                content: { type: 'text', text: message },
              },
            })
            .catch(() => this.failQuestion(run));
        },
      });
      this.pluginSetHash = createHash('sha256')
        .update(
          JSON.stringify({
            base: this.input.pluginSetHash,
            question: QUESTION_EXTENSION_IDENTITY,
          })
        )
        .digest('hex');
    }
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentInfo: { name: 'molly', title: 'Molly', version: PI_ENGINE_VERSION },
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: { image: true, embeddedContext: false },
        mcpCapabilities: { http: true },
        _meta: { lody: { usage: { version: 1 } } },
      },
      authMethods: [],
    };
  }

  async authenticate(): Promise<void> {
    throw new Error('harness_credentials_are_host_managed');
  }

  private failQuestion(run: NonNullable<MollyAcpAdapter['running']>): void {
    if (this.running !== run) return;
    run.questionFailed = true;
    run.controller.abort();
    void this.owned?.session.abort().catch(() => undefined);
  }

  async loadSession(params: acp.LoadSessionRequest): Promise<acp.LoadSessionResponse> {
    if (params.sessionId !== this.input.nativeSessionId)
      throw new Error('harness_native_session_identity_mismatch');
    const response = await this.newSession(params);
    if (response.sessionId !== params.sessionId)
      throw new Error('harness_native_session_identity_mismatch');
    return response;
  }

  async newSession(params: acp.NewSessionRequest): Promise<acp.NewSessionResponse> {
    if (this.claimed || this.closed) throw new Error('harness_worker_already_claimed');
    this.claimed = true;
    if (params.additionalDirectories?.length) throw new Error('harness_unbound_resources');
    if ((await realpath(params.cwd)) !== (await realpath(this.input.cwd)))
      throw new Error('harness_cwd_mismatch');
    const operations = new ToolOperationJournal(join(this.input.privateRoot, 'operations'));
    if (
      params.mcpServers.length > 32 ||
      new Set(params.mcpServers.map((server) => server.name)).size !== params.mcpServers.length
    )
      throw new Error('harness_mcp_server_limit');
    this.protectedServers = params.mcpServers.filter(
      (server) => server._meta?.mollyMcpCredential !== undefined
    );
    for (const server of this.protectedServers) {
      const binding = McpCredentialBindingSchema.parse(server._meta?.mollyMcpCredential);
      const catalog = z
        .object({ id: z.string() })
        .passthrough()
        .safeParse(server._meta?.mollyConnection);
      if (
        binding.workspaceId !== this.input.workspaceId ||
        !mcpCredentialMatchesServer(binding, server) ||
        !catalog.success ||
        catalog.data.id !== binding.serverId
      )
        throw new Error('harness_mcp_binding_mismatch');
    }
    this.bridgeOptions = {
      cwd: this.input.cwd,
      approve: this.approveMcp,
      imageImportAvailable: this.importImages !== undefined,
      dispatch: async (serverName, toolCallId, toolName, args, invoke, boundImage) => {
        const run = this.running;
        if (!run || run.controller.signal.aborted) throw new Error('harness_run_retired');
        const server = params.mcpServers.find((entry) => entry.name === serverName);
        const binding = z
          .object({ id: z.string().min(1), revision: z.number().int().positive() })
          .strict()
          .safeParse(server?._meta?.mollyConnection);
        if (!binding.success) throw new Error('harness_mcp_connection_revision_required');
        const isBuiltinImage =
          binding.data.id === MOLLY_BUILTIN_MCP_CONNECTION.id &&
          ['molly_generate_image', 'molly_edit_image'].includes(toolName);
        const imageBinding = McpImageBindingSchema.safeParse(server?._meta?.mollyImageBinding);
        const isExternalImage =
          !isBuiltinImage &&
          imageBinding.success &&
          [imageBinding.data.generate?.tool, imageBinding.data.edit?.tool].includes(toolName);
        const image = run.snapshot.imageConnection;
        if (isBuiltinImage && !image) throw new Error('harness_image_connection_unavailable');
        const importImages = this.importImages;
        try {
          const result = await operations.dispatch(
            {
              snapshot: run.snapshot,
              connectionId: isBuiltinImage ? image!.id : binding.data.id,
              connectionRevision: isBuiltinImage ? image!.revision : binding.data.revision,
              toolCallId,
              toolName,
              arguments: args,
              builtinImage: isBuiltinImage,
              externalImage: isExternalImage,
              importImages:
                ((isExternalImage && boundImage) || isBuiltinImage) && importImages
                  ? async (reply) => {
                      run.controller.signal.throwIfAborted();
                      const content = await resolveMcpContent(reply, async () => {
                        throw new Error('harness_mcp_image_resource_import_unavailable');
                      });
                      const request = HarnessImageImportRequestSchema.parse({
                        version: 1,
                        runId: run.snapshot.runId,
                        runtimeEpoch: run.snapshot.runtimeEpoch,
                        productSessionId: run.snapshot.sessionId,
                        turnId: run.snapshot.turnId,
                        connectionId: isBuiltinImage ? image!.id : binding.data.id,
                        connectionRevision: isBuiltinImage
                          ? image!.revision
                          : binding.data.revision,
                        serverName,
                        toolName,
                        toolCallId,
                        requestDigest: createHash('sha256')
                          .update(JSON.stringify(args))
                          .digest('hex'),
                        images: content
                          .filter((part) => part.type === 'image')
                          .map((part) => ({ mimeType: part.mimeType, data: part.data })),
                      });
                      const imported = await importImages(request, run.controller.signal);
                      run.controller.signal.throwIfAborted();
                      return imported;
                    }
                  : undefined,
            },
            async (context) => {
              run.controller.signal.throwIfAborted();
              return invoke({
                ...context,
                ...(isBuiltinImage && importImages
                  ? { metadata: { [HARNESS_INLINE_IMAGE_RESULT_META]: 1 } }
                  : {}),
              });
            }
          );
          if (isBuiltinImage) {
            const receipt = ImageOperationResultSchema.safeParse(
              result &&
                typeof result === 'object' &&
                '_meta' in result &&
                result._meta &&
                typeof result._meta === 'object' &&
                'mollyImageOperation' in result._meta
                ? result._meta.mollyImageOperation
                : undefined
            );
            if (receipt.success && receipt.data.dispatched && receipt.data.state === 'failed')
              throw new Error('harness_paid_retry_requires_user');
          }
          if (
            isExternalImage &&
            result &&
            typeof result === 'object' &&
            'isError' in result &&
            result.isError === true
          )
            throw new Error('harness_paid_retry_requires_user');
          return result;
        } catch (error) {
          if (
            error instanceof Error &&
            ['harness_mcp_outcome_unknown', 'harness_paid_retry_requires_user'].includes(
              error.message
            )
          ) {
            run.sideEffectOutcomeUnknown = error.message === 'harness_mcp_outcome_unknown';
            run.paidOperationFailed = error.message === 'harness_paid_retry_requires_user';
            run.controller.abort();
            // abort waits for tool settlement, so awaiting here would deadlock this tool.
            void this.owned?.session.abort().catch(() => undefined);
          }
          throw error;
        }
      },
    };
    this.bridge = await connectMcpBridge(
      params.mcpServers.filter((server) => !this.protectedServers.includes(server)),
      this.bridgeOptions
    );
    const tools = [...this.input.tools, ...this.bridge.tools];
    this.toolsetHash = hashToolset(tools);
    try {
      this.sessionInput = {
        ...this.input,
        tools,
        questionUI: this.questionUI?.ui,
        onExtensionError: (owner) => {
          if (this.owned?.extensionOwner !== owner) return;
          const run = this.running;
          if (run) {
            run.extensionFailed = true;
            run.controller.abort();
          }
        },
        observeModelRequest: async (model) => {
          const run = this.running;
          if (!run || run.controller.signal.aborted) throw new Error('harness_run_retired');
          if (
            model.id !== run.snapshot.selection.modelId ||
            model.provider !== MOLLY_PROVIDER_IDS[run.snapshot.connection.providerPresetId]
          )
            throw new Error('harness_model_dispatch_mismatch');
          const id = randomUUID();
          const { runId, runtimeEpoch } = run.snapshot;
          await this.journal.modelRequest(runId, runtimeEpoch, { id, state: 'dispatched' });
          return async (message) => {
            const succeeded =
              message && !['error', 'aborted', 'pending'].includes(message.stopReason);
            await this.journal.modelRequest(runId, runtimeEpoch, {
              id,
              state: succeeded ? 'succeeded' : 'outcome_unknown',
              // Error placeholders contain zeroes, not measured free requests.
              ...(succeeded &&
              (run.snapshot.connection.providerPresetId !== 'openai-compatible' ||
                (run.snapshot.connection.customModels?.find((entry) => entry.modelId === model.id)
                  ?.usageInStreaming === true &&
                  message.usage.totalTokens > 0))
                ? {
                    usage: {
                      inputTokens: message.usage.input,
                      outputTokens: message.usage.output,
                      cacheReadInputTokens: message.usage.cacheRead,
                      cacheCreationInputTokens: message.usage.cacheWrite,
                    },
                  }
                : {}),
            });
          };
        },
      };
      this.owned = await this.createSession(this.sessionInput);
      this.toolsetHash = hashToolset(this.owned.tools);
    } catch (error) {
      await this.bridge.close();
      throw error;
    }
    if (this.closed) {
      this.owned.session.dispose();
      await this.bridge.close();
      throw new Error('harness_worker_closed');
    }
    return {
      sessionId: this.owned.manager.getSessionId(),
      _meta: {
        mollyRuntime: {
          version: 1,
          runtimeEpoch: this.input.runtimeEpoch,
          harness: this.input.harness,
          toolsetHash: this.toolsetHash,
          pluginSetHash: this.pluginSetHash,
          nativeSessionFile: await realpath(this.owned.manager.getSessionFile()!),
        },
      },
    };
  }

  private assertSession(sessionId: string): OwnedSession {
    if (this.closed || !this.owned || this.owned.manager.getSessionId() !== sessionId)
      throw new Error('harness_session_unavailable');
    return this.owned;
  }

  private async replaceTools(tools: CreateMollySessionInput['tools']): Promise<void> {
    if (!this.owned || !this.sessionInput) throw new Error('harness_session_unavailable');
    const nativeSessionId = this.owned.manager.getSessionId();
    const nativeSessionFile = this.owned.manager.getSessionFile();
    this.owned.session.dispose();
    this.owned = await this.createSession({
      ...this.sessionInput,
      tools,
      nativeSessionId,
      nativeSessionFile,
    });
    this.toolsetHash = hashToolset(this.owned.tools);
  }

  async extMethod(
    method: string,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    if (method !== MOLLY_PREPARE_MCP_METHOD) throw new Error('harness_method_unsupported');
    const request = z
      .object({ sessionId: z.string(), preparation: HarnessMcpPreparationSchema })
      .strict()
      .safeParse(params);
    if (!request.success) throw new Error('harness_mcp_preparation_invalid');
    const { preparation } = request.data;
    this.assertSession(request.data.sessionId);
    if (
      this.running ||
      this.preparing ||
      this.prepared ||
      !this.bridge ||
      !this.bridgeOptions ||
      !this.protectedServers.length
    )
      throw new Error('harness_mcp_preparation_unavailable');
    if (
      preparation.runtimeEpoch !== this.input.runtimeEpoch ||
      preparation.sessionId !== this.input.productSessionId ||
      preparation.workspaceId !== this.input.workspaceId ||
      JSON.stringify(preparation.connection) !==
        JSON.stringify(ModelConnectionSchema.parse(this.input.connection)) ||
      JSON.stringify(preparation.mcpConnections) !==
        JSON.stringify(
          this.protectedServers.map((server) =>
            McpCredentialBindingSchema.parse(server._meta?.mollyMcpCredential)
          )
        )
    )
      throw new Error('harness_mcp_preparation_mismatch');
    const controller = new AbortController();
    this.preparing = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(55_000)]);
    try {
      // Existing, corrupt or inaccessible dispatch receipts must not permit another attempt.
      let dispatched = true;
      try {
        await this.journal.read(preparation.runId);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') dispatched = false;
        else throw error;
      }
      if (dispatched) throw new Error('harness_run_replayed');
      const credentials = await this.mcpCredentialProvider(preparation, signal);
      signal.throwIfAborted();
      const parsed = z.array(StoredMcpCredentialSchema).safeParse(credentials);
      if (
        !parsed.success ||
        JSON.stringify(parsed.data.map((entry) => entry.connection)) !==
          JSON.stringify(preparation.mcpConnections)
      )
        throw new Error('harness_mcp_credential_mismatch');
      this.protectedBridge = await connectMcpBridge(this.protectedServers, {
        ...this.bridgeOptions,
        credentials: parsed.data,
        signal,
      });
      signal.throwIfAborted();
      await this.replaceTools([
        ...this.input.tools,
        ...this.bridge.tools,
        ...this.protectedBridge.tools,
      ]);
      signal.throwIfAborted();
      this.prepared = preparation;
      return {
        version: 1,
        runtimeEpoch: this.input.runtimeEpoch,
        harness: this.input.harness,
        toolsetHash: this.toolsetHash,
        pluginSetHash: this.pluginSetHash,
        nativeSessionFile: await realpath(this.owned!.manager.getSessionFile()!),
      };
    } catch {
      await this.protectedBridge?.close();
      this.protectedBridge = undefined;
      this.closed = true;
      this.owned?.session.dispose();
      throw new Error('harness_mcp_preparation_failed');
    } finally {
      this.preparing = undefined;
    }
  }

  private validateSnapshot(input: unknown): HarnessRunSnapshot {
    const snapshot = HarnessRunSnapshotSchema.parse(input);
    if (
      this.preparing ||
      (this.protectedServers.length > 0 &&
        (!this.prepared ||
          snapshot.runId !== this.prepared.runId ||
          snapshot.turnId !== this.prepared.turnId)) ||
      JSON.stringify(snapshot.mcpConnections ?? []) !==
        JSON.stringify(this.prepared?.mcpConnections ?? []) ||
      snapshot.runtimeEpoch !== this.input.runtimeEpoch ||
      JSON.stringify(snapshot.harness) !==
        JSON.stringify(HarnessIdentitySchema.parse(this.input.harness)) ||
      snapshot.sessionId !== this.input.productSessionId ||
      snapshot.toolsetHash !== this.toolsetHash ||
      snapshot.pluginSetHash !== this.pluginSetHash ||
      snapshot.permissionProfileId !== this.input.permissionProfileId ||
      JSON.stringify(snapshot.connection) !==
        JSON.stringify(ModelConnectionSchema.parse(this.input.connection)) ||
      JSON.stringify(snapshot.selection) !==
        JSON.stringify(ModelSelectionSchema.parse(this.input.selection))
    ) {
      throw new Error('harness_snapshot_mismatch');
    }
    return snapshot;
  }

  async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
    const owned = this.assertSession(params.sessionId);
    if (owned.hasExtensionFailure()) throw new Error('harness_extension_failed');
    if (this.running) throw new Error('harness_task_already_running');
    const snapshot = this.validateSnapshot(params._meta?.mollyRunSnapshot);
    const text: string[] = [];
    const images: Array<{ type: 'image'; data: string; mimeType: string }> = [];
    for (const part of params.prompt) {
      if (part.type === 'text') text.push(part.text);
      else if (part.type === 'image' && owned.session.model?.input.includes('image')) {
        images.push({ type: 'image', data: part.data, mimeType: part.mimeType });
      } else if (part.type === 'resource_link') {
        const uri = new URL(part.uri);
        if (uri.protocol !== 'file:' || uri.host || uri.search || uri.hash)
          throw new Error('harness_attachment_uri_unsupported');
        // Containment root is the shared contract value (.molly/attachments),
        // materialized by the daemon before dispatch.
        const attachmentRoot = await realpath(
          join(this.input.cwd, SESSION_ATTACHMENTS_DIR_RELATIVE)
        );
        const attachment = await realpath(fileURLToPath(uri));
        const local = relative(attachmentRoot, attachment);
        if (!local || local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local))
          throw new Error('harness_attachment_outside_scope');
        // Keep the producer's verified attachment identity. Native read remains permission-gated;
        // image bytes, when supported, arrive separately as ACP image content.
        text.push(
          `User attachment: ${JSON.stringify({ name: part.name, uri: part.uri, mimeType: part.mimeType, size: part.size })}`
        );
      } else throw new Error('harness_prompt_content_unsupported');
    }
    if (this.running || this.closed) throw new Error('harness_task_already_running');
    const prompt = text.join('\n');
    if (
      prompt.startsWith('/') &&
      owned.session.extensionRunner.getCommand(prompt.slice(1).split(' ', 1)[0] ?? '')
    )
      throw new Error('harness_extension_command_unmapped');
    const tracker = new NativeRunOutcome();
    const controller = new AbortController();
    this.running = { tracker, snapshot, controller };
    let updates: Promise<void> = Promise.resolve();
    let updateFailed = false;
    const unsubscribe = owned.session.subscribe((event) => {
      tracker.accept(event);
      if (
        this.questionUI &&
        event.type === 'tool_execution_end' &&
        event.toolName === 'ask_question' &&
        event.isError &&
        !controller.signal.aborted
      )
        this.failQuestion(this.running!);
      const update = this.toUpdate(event);
      if (update)
        updates = updates
          .then(() => this.peer.sessionUpdate({ sessionId: params.sessionId, update }))
          .catch(() => {
            updateFailed = true;
          });
    });
    try {
      await this.journal.begin(snapshot);
      // After the durable fence, even an empty/failed response must never replay this run.
      try {
        if (!tracker.isCancelled) {
          const apiKey = await this.credentialProvider(snapshot, controller.signal);
          controller.signal.throwIfAborted();
          await owned.runtime.setRuntimeApiKey(owned.providerId, apiKey, {
            signal: controller.signal,
          });
          controller.signal.throwIfAborted();
          // Commands need explicit host-state dispatch, not the SDK's implicit
          // pre-prompt command path. Skills remain approved system resources.
          await owned.session.prompt(prompt, { images, expandPromptTemplates: false });
        }
      } catch {
        /* Native evidence below is authoritative; do not expose provider errors/keys. */
      }
      await updates;
      const outcome =
        this.running.extensionFailed || owned.hasExtensionFailure()
          ? { status: 'failed' as const, errorCode: 'extension_hook_failed' }
          : this.running.questionFailed
            ? { status: 'failed' as const, errorCode: 'extension_question_failed' }
            : this.running.sideEffectOutcomeUnknown
              ? { status: 'interrupted' as const, reason: 'mcp_outcome_unknown' }
              : this.running.paidOperationFailed
                ? { status: 'interrupted' as const, reason: 'paid_retry_requires_user' }
                : updateFailed
                  ? { status: 'interrupted' as const, reason: 'acp_delivery_failed' }
                  : tracker.finish(owned.manager.getLeafId());
      await this.journal.settle(snapshot.runId, snapshot.runtimeEpoch, outcome);
      await this.publishUsage(params.sessionId);
      if (outcome.status === 'failed' || outcome.status === 'interrupted')
        throw new Error(`harness_${outcome.status}`);
      return {
        stopReason: outcome.status === 'cancelled' ? 'cancelled' : 'end_turn',
        _meta: {
          mollyNativeOutcome: outcome,
          mollyRunId: snapshot.runId,
          mollyRuntimeEpoch: snapshot.runtimeEpoch,
        },
      };
    } finally {
      unsubscribe();
      await owned.runtime.removeRuntimeApiKey(owned.providerId).catch(() => undefined);
      this.running = undefined;
      if (this.protectedBridge) {
        await this.protectedBridge.close();
        this.protectedBridge = undefined;
        this.prepared = undefined;
        if (!this.closed)
          await this.replaceTools([...this.input.tools, ...(this.bridge?.tools ?? [])]);
      }
    }
  }

  private async publishUsage(sessionId: string): Promise<void> {
    if (!this.peer.extNotification) return;
    let latest;
    for (const row of await this.journal.modelUsage(this.input.productSessionId)) {
      const update = this.usage.update(sessionId, row.id, { [row.model]: row.usage });
      if (update) latest = update;
    }
    // Publish only cumulative restored accounting, never replay old deltas after restart.
    if (latest) {
      const { delta: _delta, ...update } = latest;
      await this.peer.extNotification(
        LODY_EXTENSION_METHODS.sessionUsageUpdate,
        update as unknown as Record<string, unknown>
      );
    }
  }

  private toUpdate(event: AgentSessionEvent): acp.SessionUpdate | undefined {
    if (event.type === 'message_start' && event.message.role === 'assistant')
      this.streamedText = false;
    if (event.type === 'message_update') {
      const delta = event.assistantMessageEvent;
      if (delta.type === 'text_delta') this.streamedText = true;
      if (delta.type === 'text_delta' || delta.type === 'thinking_delta')
        return {
          sessionUpdate:
            delta.type === 'text_delta' ? 'agent_message_chunk' : 'agent_thought_chunk',
          content: { type: 'text', text: delta.delta },
        };
    }
    if (event.type === 'message_end' && event.message.role === 'assistant' && !this.streamedText) {
      const text = event.message.content
        .flatMap((content) => (content.type === 'text' ? [content.text] : []))
        .join('\n');
      if (text) return { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } };
    }
    if (event.type === 'tool_execution_start')
      return {
        sessionUpdate: 'tool_call',
        toolCallId: event.toolCallId,
        ...describeToolCall(event.toolName, event.args, this.input.cwd),
        status: 'in_progress',
      };
    if (event.type === 'tool_execution_end')
      return {
        sessionUpdate: 'tool_call_update',
        toolCallId: event.toolCallId,
        status: event.isError ? 'failed' : 'completed',
        rawOutput: event.result,
      };
    return undefined;
  }

  async cancel(params: acp.CancelNotification): Promise<void> {
    const owned = this.assertSession(params.sessionId);
    this.preparing?.abort();
    this.running?.tracker.cancel();
    this.running?.controller.abort();
    await owned.session.abort();
  }

  async dispose(): Promise<void> {
    this.closed = true;
    this.preparing?.abort();
    this.running?.tracker.cancel();
    this.running?.controller.abort();
    this.questionUI?.dispose();
    await this.owned?.session.abort();
    this.owned?.session.dispose();
    await this.bridge?.close();
    await this.protectedBridge?.close();
  }
}
