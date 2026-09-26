import { mkdir, open, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute, join, relative, sep } from 'node:path';
import {
  InMemoryCredentialStore,
  type AssistantMessage,
  type Model,
  type Api,
  type AssistantMessageEventStream,
} from '@earendil-works/pi-ai';
import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
  type Skill,
  type ExtensionUIContext,
} from '@earendil-works/pi-coding-agent';
import {
  ModelConnectionSchema,
  ModelSelectionSchema,
  MOLLY_PROVIDER_IDS,
  ModelThinkingLevelSchema,
  getModelConnectionConfigurationIssue,
  type ModelConnection,
  type ModelSelection,
} from '@molly/shared/embedded-harness';
import { MollyResourceLoader, type HostTimeSource } from './resource-loader';
import { createBoundModelFetch } from './model-transport';
import { resolveProductNativeSession, validateNativeSession } from './native-session';
import { guardedProviderStream } from './provider-stream';
import { createQuestionExtensions } from './question-extension';

export type CreateMollySessionInput = {
  cwd: string;
  productSessionId: string;
  privateRoot: string;
  connection: ModelConnection;
  selection: ModelSelection;
  /** Absent during non-inferencing ACP startup; the adapter requires a run-bound grant. */
  apiKey?: string;
  tools: ToolDefinition[];
  systemPrompt: string;
  readBeforeEditReminder?: string;
  hostTime?: HostTimeSource;
  skills?: Skill[];
  /** Host-owned dialog UI; absent until the transport can cancel and retire its requests. */
  questionUI?: ExtensionUIContext;
  /** Static failure signal only; native extension diagnostics may contain secrets. */
  onExtensionError?: (owner: symbol) => void;
  nativeSessionFile?: string;
  nativeSessionId?: string;
  /** Called immediately before each actual HTTP dispatch, including compaction. */
  observeModelRequest?: (
    model: Model<Api>
  ) => Promise<(message?: AssistantMessage) => Promise<void>>;
};

export async function createMollySession(input: CreateMollySessionInput) {
  let extensionFailed = false;
  const extensionOwner = Symbol('molly-extension-context');
  const resourceLoader = new MollyResourceLoader({
    systemPrompt: input.systemPrompt,
    skills: input.skills,
    readBeforeEditReminder: input.readBeforeEditReminder,
    hostTime: input.hostTime,
    hostToolNames: input.tools.map((tool) => tool.name),
    extensions: input.questionUI ? createQuestionExtensions() : undefined,
  });
  const connection = ModelConnectionSchema.parse(input.connection);
  const issue = getModelConnectionConfigurationIssue(connection);
  if (issue) throw new Error(`harness_${issue}`);
  const selection = ModelSelectionSchema.parse(input.selection);
  if (!connection.enabled || connection.id !== selection.connectionId) {
    throw new Error('harness_connection_unavailable');
  }
  const compatibleModel =
    connection.providerPresetId === 'openai-compatible'
      ? connection.customModels?.find((model) => model.modelId === selection.modelId)
      : undefined;
  if (connection.providerPresetId === 'openai-compatible') {
    if (!compatibleModel) throw new Error('harness_model_not_in_catalog');
    if (!compatibleModel.thinking.includes(selection.thinking))
      throw new Error('harness_thinking_level_unsupported');
    if (
      !compatibleModel.toolCalls &&
      (input.tools.length > 0 ||
        resourceLoader.getExtensions().extensions.some((ext) => ext.tools.size > 0))
    )
      throw new Error('harness_model_tools_unsupported');
  }
  if (input.apiKey !== undefined && !input.apiKey.trim())
    throw new Error('harness_credential_required');
  if (!isAbsolute(input.privateRoot) || !isAbsolute(input.cwd))
    throw new Error('harness_absolute_paths_required');
  const connectionDirectory = createHash('sha256').update(connection.id).digest('hex');
  if (!input.productSessionId.trim()) throw new Error('harness_product_session_required');
  const sessionDir = join(
    input.privateRoot,
    'sessions',
    connectionDirectory,
    createHash('sha256').update(input.productSessionId).digest('hex')
  );
  await Promise.all(
    [sessionDir, join(input.privateRoot, 'cache'), join(input.privateRoot, 'tmp')].map(
      (directory) => mkdir(directory, { recursive: true, mode: 0o700 })
    )
  );
  const credentials = new InMemoryCredentialStore();
  const runtime = await ModelRuntime.create({
    credentials,
    modelsPath: null,
    modelsStorePath: join(input.privateRoot, 'cache', `${connectionDirectory}.json`),
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  const providerId = MOLLY_PROVIDER_IDS[connection.providerPresetId];
  // Native presets retain their SDK metadata. Advanced connections register only
  // explicitly declared models; no models.json, network discovery or endpoint guessing.
  runtime.registerProvider(
    providerId,
    compatibleModel
      ? {
          baseUrl: connection.baseUrl,
          api: 'openai-completions',
          authHeader: true,
          models: (connection.customModels ?? []).map((declared) => ({
            id: declared.modelId,
            name: declared.name,
            input: declared.input,
            contextWindow: declared.contextWindow,
            maxTokens: declared.maxTokens,
            reasoning: declared.thinking.some((level) => level !== 'off'),
            thinkingLevelMap: Object.fromEntries(
              ModelThinkingLevelSchema.options.map((level) => [
                level,
                declared.thinking.includes(level) ? (level === 'off' ? 'none' : level) : null,
              ])
            ),
            // Required SDK arithmetic placeholders, not known prices. Host accounting
            // reports token usage only and must not publish these as free invoices.
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            compat: {
              thinkingFormat: 'openai',
              supportsReasoningEffort: declared.thinking.some((level) => level !== 'off'),
              supportsStore: false,
              supportsDeveloperRole: false,
              supportsUsageInStreaming: declared.usageInStreaming,
              supportsFinishReason: true,
              maxTokensField: declared.maxTokensField,
            },
          })),
        }
      : { baseUrl: connection.baseUrl }
  );
  const provider = runtime.getProvider(providerId);
  if (!provider) throw new Error('harness_provider_unavailable');
  const stream = (
    model: Model<Api>,
    start: (fetch: typeof globalThis.fetch) => AssistantMessageEventStream
  ) => {
    if (extensionFailed) throw new Error('harness_extension_failed');
    const pending: Array<(message?: AssistantMessage) => Promise<void>> = [];
    const transport = globalThis.fetch;
    const fetch = createBoundModelFetch(connection.baseUrl, async (request, options) => {
      if (extensionFailed) throw new Error('harness_extension_failed');
      options?.signal?.throwIfAborted();
      const finish = await input.observeModelRequest?.(model);
      if (finish) pending.push(finish);
      if (extensionFailed) throw new Error('harness_extension_failed');
      options?.signal?.throwIfAborted();
      return transport(request, options);
    });
    return guardedProviderStream(
      model,
      () => start(fetch),
      async (message) => {
        // Retries are disabled. If a provider nevertheless performs multiple HTTP
        // requests, record every dispatch but attribute its aggregate usage only once.
        for (const [index, finish] of pending.entries())
          await finish(index === pending.length - 1 ? message : undefined);
      }
    );
  };
  // Public provider composition, not a patch of the native model loop. All
  // prompts and compaction use this same credential/destination boundary.
  runtime.registerNativeProvider({
    ...provider,
    getModels: () => provider.getModels(),
    stream: (model, context, options) =>
      stream(model, (fetch) =>
        provider.stream(
          model,
          context,
          Object.assign({}, options, { fetch, transport: 'sse' as const, maxRetries: 0 })
        )
      ),
    streamSimple: (model, context, options) =>
      stream(model, (fetch) =>
        provider.streamSimple(model, context, {
          ...options,
          fetch,
          transport: 'sse',
          maxRetries: 0,
        })
      ),
  });
  if (input.apiKey)
    await runtime.setRuntimeApiKey(providerId, input.apiKey, {
      signal: AbortSignal.timeout(15_000),
    });
  const model = runtime.getModel(providerId, selection.modelId);
  if (!model) throw new Error('harness_model_not_in_catalog');
  let manager: SessionManager;
  if (input.nativeSessionFile || input.nativeSessionId) {
    const restored = input.nativeSessionId
      ? await resolveProductNativeSession(
          input.privateRoot,
          input.productSessionId,
          input.nativeSessionId,
          input.cwd
        )
      : {
          file: await validateNativeSession(input.nativeSessionFile!, sessionDir, input.cwd),
          directory: sessionDir,
        };
    const root = await realpath(restored.directory);
    const file = restored.file;
    const path = relative(root, file);
    if (!path || path.startsWith(`..${sep}`) || path === '..' || isAbsolute(path)) {
      throw new Error('harness_native_session_outside_private_root');
    }
    manager = SessionManager.open(file, restored.directory, input.cwd);
  } else {
    manager = SessionManager.create(input.cwd, sessionDir);
    // Pi lazily creates its file after the first assistant message. ACP exposes
    // this ID earlier, so persist the SDK's own empty header before acknowledging
    // it. Reopen through the public API so subsequent native appends own the file;
    // never manufacture messages, patch SDK internals, or repair missing history.
    const file = manager.getSessionFile();
    const header = manager.getHeader();
    if (!file || !header) throw new Error('harness_native_session_unavailable');
    const handle = await open(file, 'wx', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(header)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (process.platform !== 'win32') {
      const directory = await open(sessionDir, 'r');
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
    manager = SessionManager.open(file, sessionDir, input.cwd);
  }
  const settings = SettingsManager.inMemory({
    retry: { enabled: false, provider: { maxRetries: 0, timeoutMs: 120_000 } },
    compaction: { enabled: true },
    enableAnalytics: false,
    enableInstallTelemetry: false,
    packages: [],
    extensions: [],
    skills: [],
    prompts: [],
    themes: [],
    enableSkillCommands: false,
  });
  const result = await createAgentSession({
    cwd: input.cwd,
    agentDir: join(input.privateRoot, 'config'),
    modelRuntime: runtime,
    model,
    thinkingLevel: selection.thinking,
    sessionManager: manager,
    settingsManager: settings,
    resourceLoader,
    tools: [
      ...input.tools.map((tool) => tool.name),
      ...resourceLoader
        .getExtensions()
        .extensions.flatMap((extension) => [...extension.tools.keys()]),
    ],
    customTools: input.tools,
  });
  if (result.modelFallbackMessage) {
    result.session.dispose();
    throw new Error('harness_model_restore_incompatible');
  }
  if (result.session.thinkingLevel !== selection.thinking) {
    result.session.dispose();
    throw new Error('harness_thinking_level_unsupported');
  }
  try {
    await result.session.bindExtensions({
      uiContext: input.questionUI,
      mode: 'rpc',
      onError: () => {
        extensionFailed = true;
        // Hook callbacks run inside native execution; awaiting abort would deadlock.
        void result.session.abort().catch(() => undefined);
        input.onExtensionError?.(extensionOwner);
      },
    });
    if (extensionFailed) throw new Error('harness_extension_failed');
  } catch {
    result.session.dispose();
    throw new Error('harness_extension_bind_failed');
  }
  const tools = [
    ...input.tools,
    ...resourceLoader
      .getExtensions()
      .extensions.flatMap((extension) =>
        [...extension.tools.values()].map((tool) => tool.definition)
      ),
  ];
  return {
    ...result,
    manager,
    runtime,
    providerId,
    tools,
    extensionOwner,
    hasExtensionFailure: () => extensionFailed,
  };
}
