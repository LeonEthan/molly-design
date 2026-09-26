import type spawn from 'cross-spawn';
import { type ChildProcess } from 'child_process';
import {
  type Stream,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
} from '@agentclientprotocol/sdk';
import { v4 as uuidV4 } from 'uuid';

import type { Logger } from '@/utils/logger';
import type { TerminalManager } from '@/session/terminal-manager';
import {
  AgentClient,
  type AgentClientOptions,
  type AcpWriteTextFileEvidence,
  type AgentSessionWarning,
  type ImageGenerationBeginEvent,
  type ImageGenerationEndEvent,
  type AcpStartupStageEvent,
  type AcpStartupTimeoutOptions,
  type AcpSessionStartTarget,
} from './agent-client';
import type {
  ACPSessionId,
  AcpSessionNotification,
  AgentConfigCliType,
  BuiltinRuntimeOverrides,
  CustomAcpLaunchSpec,
  MachineId,
  MessageContent,
  SessionContextWindowUsage,
  SessionId,
  WorkspaceId,
} from '@molly/shared';

import type { RateLimit, SessionUsageUpdate } from 'acp-extension-core';
import type { AcpLauncher } from './acp-analytics';
import { assertEmbeddedHarnessTarget } from './embedded-harness-runtime';

export type CreateAcpClientOptions = {
  designHookLaunchId?: string;
  stream: Stream;
  workdir: string;
  logger: Logger;
  terminalManager: TerminalManager;
  agentConfig?: {
    cliType: AgentConfigCliType;
    agentType: string;
  };
  configOptionValues?: AgentClientOptions['configOptionValues'];
  taskToolsEnabled?: boolean;
  /** Launcher family (npx/uvx/local) for ACP startup analytics; non-PII. */
  launcher?: AcpLauncher;
  resumeSessionId?: ACPSessionId;
  forkSessionId?: ACPSessionId;
  /** Provider-native turn id selected as the source boundary for a turn-addressed fork. */
  forkSessionTurnId?: string;
  /**
   * Overrides terminal capability advertisement. Builtin Grok defaults to false so its
   * adapter uses the native local runner; other agents default to true.
   */
  terminalEnabled?: boolean;
  workspaceId?: WorkspaceId;
  machineId?: MachineId;
  onStartupStage?: (event: AcpStartupStageEvent) => void;
  onUpdateMessage(message: AcpSessionNotification): void;
  onRequestPermission(
    requestId: string,
    request: RequestPermissionRequest
  ): Promise<RequestPermissionResponse>;
  onUsageUpdate?(usage: SessionUsageUpdate): void;
  onContextWindowUsageUpdate?(usage: SessionContextWindowUsage): void;
  onRateLimitUpdate?(limits: RateLimit): void;
  onThreadGoalUpdated?(goal: Extract<MessageContent, { type: 'goal' }>): void;
  onThreadGoalCleared?(threadId: string): void;
  onSessionTitleUpdate?(title: string): void;
  onAgentWarning?(warning: AgentSessionWarning): void;
  loadExternalMcpServers?: AgentClientOptions['loadExternalMcpServers'];
  onMcpCatalogInvalidated?: AgentClientOptions['onMcpCatalogInvalidated'];
  onMcpServersResolved?: AgentClientOptions['onMcpServersResolved'];
  onHarnessImageImport?: AgentClientOptions['onHarnessImageImport'];
  onHarnessImageRecovery?: AgentClientOptions['onHarnessImageRecovery'];
  isAutoReviewRun?: AgentClientOptions['isAutoReviewRun'];
  onImageGenerationBegin?(event: ImageGenerationBeginEvent): void;
  onImageGenerationEnd?(event: ImageGenerationEndEvent): void;
  onWriteTextFile?(event: AcpWriteTextFileEvidence): void | Promise<void>;
  sessionId?: SessionId;
  startupTimeouts?: AcpStartupTimeoutOptions;
  startupAbort?: Promise<never>;
  resolveSessionStart?: () => Promise<AcpSessionStartTarget>;
};

export const createAcpClient = async (options: CreateAcpClientOptions) => {
  const sessionId = options.sessionId ?? (uuidV4() as SessionId);
  options.logger.debug(`[${sessionId}] createAcpClient: creating AgentClient`);
  const client = new AgentClient({
    designHookLaunchId: options.designHookLaunchId,
    logger: options.logger,
    sessionId,
    workspaceId: options.workspaceId,
    machineId: options.machineId,
    terminalManager: options.terminalManager,
    agentConfig: options.agentConfig,
    configOptionValues: options.configOptionValues,
    taskToolsEnabled: options.taskToolsEnabled,
    launcher: options.launcher,
    terminalEnabled: options.terminalEnabled,
    onStartupStage: options.onStartupStage,
    onUpdateMessage: options.onUpdateMessage,
    onRequestPermission: options.onRequestPermission,
    onUsageUpdate: options.onUsageUpdate,
    onContextWindowUsageUpdate: options.onContextWindowUsageUpdate,
    onRateLimitUpdate: options.onRateLimitUpdate,
    onThreadGoalUpdated: options.onThreadGoalUpdated,
    onThreadGoalCleared: options.onThreadGoalCleared,
    onSessionTitleUpdate: options.onSessionTitleUpdate,
    onAgentWarning: options.onAgentWarning,
    loadExternalMcpServers: options.loadExternalMcpServers,
    onMcpCatalogInvalidated: options.onMcpCatalogInvalidated,
    onMcpServersResolved: options.onMcpServersResolved,
    onHarnessImageImport: options.onHarnessImageImport,
    onHarnessImageRecovery: options.onHarnessImageRecovery,
    isAutoReviewRun: options.isAutoReviewRun,
    onImageGenerationBegin: options.onImageGenerationBegin,
    onImageGenerationEnd: options.onImageGenerationEnd,
    onWriteTextFile: options.onWriteTextFile,
  });
  options.logger.debug(`[${sessionId}] createAcpClient: AgentClient created, calling startSession`);
  const sessionResponse = await client.startSession(
    options.stream,
    options.workdir,
    options.resumeSessionId,
    options.startupTimeouts,
    options.startupAbort,
    options.resolveSessionStart,
    options.forkSessionId,
    options.forkSessionTurnId
  );
  options.logger.debug(
    `[${sessionId}] createAcpClient: startSession returned (acpSessionId=${sessionResponse.sessionId})`
  );
  return { client, acpSessionId: sessionResponse.sessionId as ACPSessionId, sessionResponse };
};

function waitForChildProcessExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null) {
    return Promise.resolve(true);
  }

  return new Promise<boolean>((resolve) => {
    const onExit = () => {
      cleanup();
      resolve(true);
    };
    const onTimeout = () => {
      cleanup();
      resolve(child.exitCode !== null);
    };
    const cleanup = () => {
      clearTimeout(timeoutHandle);
      child.off('exit', onExit);
    };

    const timeoutHandle = setTimeout(onTimeout, timeoutMs);
    child.once('exit', onExit);
  });
}

function signalChildProcess(child: ChildProcess, signal: NodeJS.Signals): void {
  if (process.platform !== 'win32' && typeof child.pid === 'number' && child.pid > 0) {
    process.kill(-child.pid, signal);
    return;
  }

  child.kill(signal);
}

async function terminateChildProcess(
  child: ChildProcess,
  logger: Logger,
  sessionLabel: string,
  exitTimeoutMs: number
): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }

  try {
    signalChildProcess(child, 'SIGTERM');
  } catch {
    return;
  }

  if (await waitForChildProcessExit(child, exitTimeoutMs)) {
    return;
  }

  logger.debug(
    `[${sessionLabel}] ACP agent process did not exit within ${exitTimeoutMs}ms of SIGTERM; escalating to SIGKILL`
  );
  try {
    signalChildProcess(child, 'SIGKILL');
  } catch {
    return;
  }
  await waitForChildProcessExit(child, exitTimeoutMs);
}

export type SpawnAcpProcessOptions = {
  cliType: AgentConfigCliType;
  agentType: string;
  customAcp?: CustomAcpLaunchSpec;
  runtimeOverrides?: BuiltinRuntimeOverrides;
  workdir: string;
  env: NodeJS.ProcessEnv;
  args?: string[];
  command?: string;
  spawnImpl?: typeof spawn;
};

export const spawnAcpProcess = (options: SpawnAcpProcessOptions): ChildProcess => {
  assertEmbeddedHarnessTarget(options);
  // Molly requires the Session-owned fd-3/run lease, not a generic command spawn.
  throw new Error('harness_session_launch_required');
};

export type StartLocalAcpAgentOptions = {
  cliType: AgentConfigCliType;
  agentType: string;
  customAcp?: CustomAcpLaunchSpec;
  runtimeOverrides?: BuiltinRuntimeOverrides;
  workdir: string;
  env?: NodeJS.ProcessEnv;
  logger: Logger;
  terminalManager: TerminalManager;
  /** Set to false to disable terminal capability advertisement. Defaults to true. */
  terminalEnabled?: boolean;
  onUpdateMessage(message: AcpSessionNotification): void;
  onRequestPermission(
    requestId: string,
    request: RequestPermissionRequest
  ): Promise<RequestPermissionResponse>;
  signal?: AbortSignal;
  extraArgs?: string[];
  spawnImpl?: typeof spawn;
};

/** Historical callers retain their result shape, but cannot create an unowned worker. */
export const startLocalAcpAgent = async (
  options: StartLocalAcpAgentOptions
): Promise<
  Awaited<ReturnType<typeof createAcpClient>> & {
    agentProcess: ChildProcess;
    capabilitySourceVersion: string;
  }
> => {
  options.signal?.throwIfAborted();
  assertEmbeddedHarnessTarget(options);
  throw new Error('harness_session_launch_required');
};

export type ShutdownLocalAcpAgentOptions = {
  agentProcess: ChildProcess;
  client?: AgentClient | null;
  acpSessionId?: ACPSessionId | null;
  logger: Logger;
  sessionLabel: string;
  closeSessionTimeoutMs?: number;
  exitTimeoutMs?: number;
};

export async function shutdownLocalAcpAgent(options: ShutdownLocalAcpAgentOptions): Promise<void> {
  const closeSessionTimeoutMs = Math.max(0, options.closeSessionTimeoutMs ?? 5000);
  const exitTimeoutMs = Math.max(1, options.exitTimeoutMs ?? 3000);

  if (options.client && options.acpSessionId) {
    try {
      await options.client.closeSession(options.acpSessionId, closeSessionTimeoutMs);
    } catch (error) {
      options.logger.debug(
        `[${options.sessionLabel}] ACP session close failed during local agent shutdown: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  await terminateChildProcess(
    options.agentProcess,
    options.logger,
    options.sessionLabel,
    exitTimeoutMs
  );
}
