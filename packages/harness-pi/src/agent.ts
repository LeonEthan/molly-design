import type * as acp from '@agentclientprotocol/sdk';
import { PROTOCOL_VERSION, RequestError } from '@agentclientprotocol/sdk';
import {
  createAgentSession,
  DefaultResourceLoader,
  initTheme,
  ModelRuntime,
  ProjectTrustStore,
  hasTrustRequiringProjectResources,
  SessionManager,
  SettingsManager,
  VERSION,
  type InlineExtension,
} from '@earendil-works/pi-coding-agent';
import { realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import {
  openNativeSession,
  openProductSession,
  persistNativeHeader,
  prepareProfile,
  sessionDirectory,
  acquireSessionWriter,
} from './profile';
import { PiAcpSession, type AdapterPeer } from './session';
import { describeToolCall } from './tool-presentation';
import { replayNestedToolCalls, toolCallMeta } from './tool-history';
import { formatToolContent } from './translate/tool-content';
import { acpMcpConfig, createAcpMcpExtensions, rejectAmbientMcp } from './mcp';
import type { PiAcpHost } from './host';

export type PiAcpOptions = {
  agentDir: string;
  model?: { provider: string; id: string };
  extensions?: InlineExtension[];
  createModelRuntime?: (agentDir: string) => Promise<ModelRuntime>;
  host?: PiAcpHost;
};

export class PiAcpAgent implements acp.Agent {
  private readonly sessions = new Map<string, PiAcpSession>();
  private initialized = false;
  private closed = false;
  private constructing?: Promise<acp.NewSessionResponse>;
  private preparing?: PiAcpSession;
  private supportsForms = false;
  private readonly mutations = new Map<string, Promise<acp.SetSessionConfigOptionResponse>>();

  constructor(
    private readonly conn: AdapterPeer,
    private readonly options: PiAcpOptions
  ) {}

  async initialize(params: acp.InitializeRequest): Promise<acp.InitializeResponse> {
    if (this.initialized || this.closed) throw RequestError.invalidRequest('Already initialized.');
    if (params.protocolVersion !== PROTOCOL_VERSION)
      throw RequestError.invalidParams('Unsupported ACP protocol version.');
    this.initialized = true;
    this.supportsForms =
      params.clientCapabilities?.elicitation?.form !== undefined &&
      params.clientCapabilities?.elicitation?.form !== null &&
      this.conn.request !== undefined;
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentInfo: { name: 'molly-pi-acp', title: 'Pi', version: VERSION },
      agentCapabilities: {
        loadSession: true,
        sessionCapabilities: { list: {} },
        promptCapabilities: { image: true, embeddedContext: true },
        mcpCapabilities: { http: true },
      },
      authMethods: [],
      _meta: { lody: { usage: { version: 1 } } },
    };
  }

  async authenticate(): Promise<void> {
    throw RequestError.invalidRequest('Configure authentication in the application Pi profile.');
  }

  private get(sessionId: string): PiAcpSession {
    if (this.closed) throw RequestError.invalidRequest('Connection is closed.');
    const session = this.sessions.get(sessionId);
    if (!session) throw RequestError.invalidParams('Unknown session ID.');
    return session;
  }

  newSession(params: acp.NewSessionRequest): Promise<acp.NewSessionResponse> {
    return this.establish(params);
  }

  async loadSession(params: acp.LoadSessionRequest): Promise<acp.LoadSessionResponse> {
    return this.establish(params, params.sessionId);
  }

  private async replay(wrapper: PiAcpSession): Promise<void> {
    const sessionId = wrapper.sessionId;
    const seen = new Set(
      wrapper.piSession.messages.flatMap((message) =>
        message.role === 'assistant'
          ? message.content.flatMap((block) => (block.type === 'toolCall' ? [block.id] : []))
          : []
      )
    );
    for (const message of wrapper.piSession.messages) {
      if (message.role === 'user') {
        const blocks =
          typeof message.content === 'string'
            ? [{ type: 'text' as const, text: message.content }]
            : message.content;
        for (const block of blocks)
          await this.conn.sessionUpdate({
            sessionId,
            update: { sessionUpdate: 'user_message_chunk', content: block },
          });
      } else if (message.role === 'assistant') {
        for (const block of message.content) {
          if (block.type === 'text' || block.type === 'thinking')
            await this.conn.sessionUpdate({
              sessionId,
              update: {
                sessionUpdate:
                  block.type === 'text' ? 'agent_message_chunk' : 'agent_thought_chunk',
                content: {
                  type: 'text',
                  text: block.type === 'text' ? block.text : block.thinking,
                },
              },
            });
          if (block.type === 'toolCall')
            await this.conn.sessionUpdate({
              sessionId,
              update: {
                sessionUpdate: 'tool_call',
                toolCallId: block.id,
                ...describeToolCall(
                  block.name,
                  block.arguments,
                  wrapper.piSession.sessionManager.getCwd()
                ),
                status: 'pending',
                _meta: toolCallMeta(block.name),
              },
            });
        }
      } else if (message.role === 'toolResult') {
        const nested = replayNestedToolCalls(
          message,
          wrapper.piSession.sessionManager.getCwd(),
          seen
        );
        for (const update of nested.updates) await this.conn.sessionUpdate({ sessionId, update });
        await this.conn.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId: message.toolCallId,
            status: message.isError ? 'failed' : 'completed',
            content: [
              ...formatToolContent(message.toolName, message, message.isError),
              ...nested.notices,
            ],
            rawOutput: message,
            _meta: toolCallMeta(message.toolName),
          },
        });
      }
    }
  }

  private async establish(
    params: acp.NewSessionRequest,
    nativeId?: string
  ): Promise<acp.NewSessionResponse> {
    if (!this.initialized || this.closed) throw RequestError.invalidRequest('Initialize first.');
    if (
      this.constructing ||
      this.mutations.size ||
      this.options.host?.busy ||
      [...this.sessions.values()].some((session) => session.busy)
    )
      throw RequestError.invalidRequest('Session construction or execution is in progress.');
    if (params.additionalDirectories?.length)
      throw RequestError.invalidParams('Additional directories are not supported.');
    if (!isAbsolute(params.cwd))
      throw RequestError.invalidParams('Working directory must be absolute.');
    if (nativeId && this.sessions.has(nativeId))
      throw RequestError.invalidRequest('Session is already open.');
    if (!this.options.host) {
      try {
        acpMcpConfig(params.mcpServers, params.cwd);
      } catch {
        throw RequestError.invalidParams('Unsupported or invalid MCP configuration.');
      }
    }
    const operation = this.createSession(params.cwd, params.mcpServers, nativeId);
    this.constructing = operation;
    try {
      return await operation;
    } catch {
      this.options.host?.retire();
      throw new Error('pi_acp_session_setup_failed');
    } finally {
      this.constructing = undefined;
    }
  }

  private async createSession(
    requestedCwd: string,
    servers: readonly acp.McpServer[],
    nativeId?: string
  ): Promise<acp.NewSessionResponse> {
    initTheme('dark', false);
    const agentDir = await prepareProfile(this.options.agentDir);
    if (
      !process.env.PI_CODING_AGENT_DIR ||
      (await realpath(process.env.PI_CODING_AGENT_DIR)) !== agentDir
    )
      throw new Error('pi_acp_process_profile_mismatch');
    const cwd = await realpath(requestedCwd);
    const mcpConfig = this.options.host
      ? await this.options.host.sessionConfig(servers, cwd)
      : acpMcpConfig(servers, cwd);
    if (this.options.host && nativeId !== this.options.host.config.nativeSessionId)
      throw new Error('pi_acp_host_native_identity_mismatch');
    let target;
    if (this.options.host)
      target = await openProductSession(this.options.host.config, cwd, nativeId);
    else if (nativeId)
      target = await openNativeSession(nativeId, cwd, await sessionDirectory(agentDir));
    else {
      const manager = await persistNativeHeader(
        SessionManager.create(cwd, await sessionDirectory(agentDir))
      );
      target = { manager, releaseWriter: await acquireSessionWriter(manager.getSessionFile()!) };
    }
    const { manager, releaseWriter } = target;
    let wrapper: PiAcpSession | undefined;
    try {
      const settings = SettingsManager.create(cwd, agentDir, { projectTrusted: false });
      settings.applyOverrides({
        enableAnalytics: false,
        enableInstallTelemetry: false,
        ...(this.options.host ? { shellPath: this.options.host.config.shellPath } : {}),
      });
      await rejectAmbientMcp(cwd, agentDir, settings);
      const runtime = this.options.host
        ? await this.options.host.createRuntime(agentDir)
        : this.options.createModelRuntime
          ? await this.options.createModelRuntime(agentDir)
          : await ModelRuntime.create({
              authPath: join(agentDir, 'auth.json'),
              modelsPath: join(agentDir, 'models.json'),
              modelsStorePath: join(agentDir, 'models-cache.json'),
              allowModelNetwork: false,
            });
      const selected = this.options.host?.model ?? this.options.model;
      const provider = selected?.provider ?? settings.getDefaultProvider();
      const id = selected?.id ?? settings.getDefaultModel();
      if (!provider || !id) throw new Error('pi_acp_explicit_model_required');
      const model = runtime.getModel(provider, id);
      if (!model) throw new Error('pi_acp_selected_model_unavailable');
      const loader = new DefaultResourceLoader({
        cwd,
        agentDir,
        settingsManager: settings,
        additionalSkillPaths: existsSync(join(cwd, '.agents', 'skills'))
          ? [join(cwd, '.agents', 'skills')]
          : [],
        extensionFactories: [
          ...(this.options.extensions ?? []),
          ...createAcpMcpExtensions(mcpConfig),
          ...(this.options.host ? [this.options.host.extension] : []),
        ],
      });
      await loader.reload({
        resolveProjectTrust: async ({ extensionsResult }) => {
          if (extensionsResult.errors.length) throw new Error('pi_acp_extension_load_failed');
          const requiresTrust = hasTrustRequiringProjectResources(cwd);
          if (
            requiresTrust &&
            extensionsResult.extensions.some((extension) => extension.handlers.has('project_trust'))
          )
            throw new Error('pi_acp_project_trust_hook_unsupported');
          const trusted =
            !requiresTrust ||
            (new ProjectTrustStore(agentDir).get(cwd) ??
              settings.getDefaultProjectTrust() === 'always');
          settings.setProjectTrusted(trusted);
          await settings.reload();
          if (this.options.host)
            settings.applyOverrides({ shellPath: this.options.host.config.shellPath });
          await rejectAmbientMcp(cwd, agentDir, settings);
          return trusted;
        },
      });
      if (loader.getExtensions().errors.length) throw new Error('pi_acp_extension_load_failed');
      if (this.closed) throw new Error('pi_acp_connection_closed');
      const result = await createAgentSession({
        cwd,
        agentDir,
        sessionManager: manager,
        settingsManager: settings,
        resourceLoader: loader,
        modelRuntime: runtime,
        model,
        ...(this.options.host
          ? { thinkingLevel: this.options.host.config.selection.thinking }
          : {}),
      });
      wrapper = new PiAcpSession(
        result.session,
        this.conn,
        this.supportsForms,
        releaseWriter,
        this.options.host
      );
      this.preparing = wrapper;
      if (this.closed) throw new Error('pi_acp_connection_closed');
      const current = wrapper;
      if (
        result.modelFallbackMessage ||
        result.session.model?.provider !== provider ||
        result.session.model.id !== id
      )
        throw new Error('pi_acp_model_fallback_refused');
      await result.session.bindExtensions({
        uiContext: this.supportsForms ? wrapper.uiContext : undefined,
        mode: 'rpc',
        onError: (error) => {
          if (error.event === 'session_shutdown') {
            current.failShutdown();
            return;
          }
          current.failExtension();
          throw new Error('pi_acp_extension_failed');
        },
      });
      await wrapper.flush();
      if (this.closed) throw new Error('pi_acp_connection_closed');
      this.sessions.set(wrapper.sessionId, wrapper);
      const commands = [
        ...result.session.extensionRunner.getRegisteredCommands().map((command) => ({
          name: command.invocationName,
          description: command.description ?? 'Extension command',
        })),
        ...result.session.promptTemplates.map((template) => ({
          name: template.name,
          description: template.description,
        })),
        ...(settings.getEnableSkillCommands()
          ? loader.getSkills().skills.map((skill) => ({
              name: `skill:${skill.name}`,
              description: skill.description,
            }))
          : []),
      ];
      await this.conn.sessionUpdate({
        sessionId: wrapper.sessionId,
        update: { sessionUpdate: 'available_commands_update', availableCommands: commands },
      });
      if (nativeId) await this.replay(wrapper);
      return {
        sessionId: wrapper.sessionId,
        configOptions: this.configOptions(wrapper),
        ...(this.options.host
          ? {
              _meta: {
                mollyRuntime: await this.options.host.bind(
                  wrapper,
                  loader.getExtensions().extensions.map((extension) => extension.path)
                ),
              },
            }
          : {}),
      };
    } catch {
      if (wrapper) {
        this.sessions.delete(wrapper.sessionId);
        await wrapper.dispose();
      } else await releaseWriter();
      throw new Error('pi_acp_session_setup_failed');
    } finally {
      if (this.preparing === wrapper) this.preparing = undefined;
    }
  }

  private configOptions(wrapper: PiAcpSession): acp.SessionConfigOption[] {
    if (this.options.host) return this.options.host.configOptions();
    const session = wrapper.piSession;
    const current = session.model!;
    return [
      {
        id: 'model',
        name: 'Model',
        type: 'select',
        category: 'model',
        currentValue: `${current.provider}/${current.id}`,
        options: session.modelRuntime.getModels().map((model) => ({
          value: `${model.provider}/${model.id}`,
          name: `${model.provider}/${model.name}`,
        })),
      },
      {
        id: 'thought_level',
        name: 'Thinking Level',
        type: 'select',
        category: 'thought_level',
        currentValue: session.thinkingLevel,
        options: session
          .getAvailableThinkingLevels()
          .map((level) => ({ value: level, name: level })),
      },
    ];
  }

  async setSessionConfigOption(
    params: acp.SetSessionConfigOptionRequest
  ): Promise<acp.SetSessionConfigOptionResponse> {
    const wrapper = this.get(params.sessionId);
    if (
      this.constructing ||
      this.options.host?.busy ||
      wrapper.busy ||
      this.mutations.has(params.sessionId)
    )
      throw RequestError.invalidRequest('Session is busy.');
    const operation = this.applyConfigOption(wrapper, params);
    this.mutations.set(params.sessionId, operation);
    try {
      return await operation;
    } finally {
      this.mutations.delete(params.sessionId);
    }
  }

  private async applyConfigOption(
    wrapper: PiAcpSession,
    params: acp.SetSessionConfigOptionRequest
  ): Promise<acp.SetSessionConfigOptionResponse> {
    const session = wrapper.piSession;
    if (this.options.host) {
      const option = this.options.host
        .configOptions()
        .find((entry) => entry.id === params.configId);
      if (!option || option.currentValue !== params.value)
        throw RequestError.invalidParams('A new managed worker is required for this selection.');
      return { configOptions: this.configOptions(wrapper) };
    }
    if (params.configId === 'model') {
      const model = session.modelRuntime
        .getModels()
        .find((entry) => `${entry.provider}/${entry.id}` === params.value);
      if (!model) throw RequestError.invalidParams('Unknown model.');
      await session.setModel(model);
    } else if (params.configId === 'thought_level') {
      const level = session.getAvailableThinkingLevels().find((entry) => entry === params.value);
      if (!level) throw RequestError.invalidParams('Unsupported thinking level.');
      session.setThinkingLevel(level);
    } else throw RequestError.invalidParams('Unknown configuration option.');
    return { configOptions: this.configOptions(wrapper) };
  }

  async listSessions(params: acp.ListSessionsRequest): Promise<acp.ListSessionsResponse> {
    if (this.closed || !this.initialized) throw RequestError.invalidRequest('Initialize first.');
    if (params.cursor) throw RequestError.invalidParams('Pagination is not supported.');
    const agentDir = await prepareProfile(this.options.agentDir);
    const rows = params.cwd
      ? await SessionManager.list(await realpath(params.cwd), await sessionDirectory(agentDir))
      : await SessionManager.listAll(join(agentDir, 'sessions'));
    return {
      sessions: rows.map((row) => ({
        sessionId: row.id,
        cwd: row.cwd,
        title: row.name ?? row.firstMessage,
        updatedAt: row.modified.toISOString(),
      })),
    };
  }

  async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
    if (this.constructing || this.mutations.has(params.sessionId))
      throw RequestError.invalidRequest('Session state is changing.');
    const wrapper = this.get(params.sessionId);
    return this.options.host
      ? this.options.host.prompt(wrapper, params)
      : wrapper.prompt(params.prompt);
  }

  async cancel(params: acp.CancelNotification): Promise<void> {
    const wrapper = this.get(params.sessionId);
    this.options.host?.cancelPreparation();
    const settled = await Promise.allSettled([wrapper.cancel(), this.options.host?.waitForRun()]);
    if (settled.some((result) => result.status === 'rejected'))
      throw new Error('pi_acp_cancellation_failed');
  }

  async extMethod(
    method: string,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    if (method !== '_pi/steer' && method !== '_pi/follow_up')
      throw RequestError.methodNotFound(method);
    if (typeof params.sessionId !== 'string' || !Array.isArray(params.prompt))
      throw RequestError.invalidParams('Session ID and prompt are required.');
    const blocks = acpSchemaPrompt(params.prompt);
    const disposition = await this.get(params.sessionId).steer(
      blocks,
      method === '_pi/steer' ? 'steer' : 'followUp'
    );
    return { disposition };
  }

  async dispose(): Promise<void> {
    this.closed = true;
    this.options.host?.retire();
    this.preparing?.retire();
    await this.constructing?.catch(() => undefined);
    await Promise.allSettled([...this.mutations.values()]);
    const results = await Promise.allSettled(
      [...this.sessions.values()].map((session) => session.dispose())
    );
    this.sessions.clear();
    if (results.some((result) => result.status === 'rejected'))
      throw new Error('pi_acp_cleanup_failed');
  }
}

function acpSchemaPrompt(input: unknown[]): acp.ContentBlock[] {
  return input.map((value) => {
    if (!value || typeof value !== 'object') throw RequestError.invalidParams('Invalid prompt.');
    if (
      'type' in value &&
      value.type === 'text' &&
      'text' in value &&
      typeof value.text === 'string'
    )
      return { type: 'text', text: value.text };
    if (
      'type' in value &&
      value.type === 'image' &&
      'data' in value &&
      typeof value.data === 'string' &&
      'mimeType' in value &&
      typeof value.mimeType === 'string'
    )
      return { type: 'image', data: value.data, mimeType: value.mimeType };
    throw RequestError.invalidParams('Unsupported queued content.');
  });
}
