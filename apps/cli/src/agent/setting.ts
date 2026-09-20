import { homedir } from 'node:os';
import { delimiter, join, normalize } from 'node:path';

import {
  type AgentConfigCliType,
  type BuiltinRuntimeOverrides,
  type CustomAcpLaunchSpec,
} from '@molly/shared';

import {
  assertEmbeddedHarnessTarget,
  resolveEmbeddedHarnessLaunch,
} from './embedded-harness-runtime';

export type ResolveACPSettingInput = {
  cliType: AgentConfigCliType;
  agentType: string;
  /** Retained input solely for explicit legacy-override rejection. */
  customAcp?: CustomAcpLaunchSpec;
  runtimeOverrides?: BuiltinRuntimeOverrides;
  /** Caller environment; the embedded launch resolver never reads it. */
  env?: NodeJS.ProcessEnv;
};

export type ResolveACPProcessLaunchInput = ResolveACPSettingInput & {
  /**
   * Historical launch args; any nonempty value is refused.
   */
  extraArgs?: string[];
  signal?: AbortSignal;
};

export type ResolvedACPProcessLaunch = {
  command: string;
  args: string[];
  capabilitySourceVersion?: string;
  /**
   * Environment overlay required by this ACP launch. Callers that spawn a
   * process directly should merge this over their base environment.
   */
  env?: Record<string, string>;
};

export type BuiltinAuthenticationAction = 'login' | 'status';

export type ResolveBuiltinAuthenticationProcessLaunchInput = ResolveACPSettingInput & {
  action: BuiltinAuthenticationAction;
  signal?: AbortSignal;
};

const DEFAULT_ACP_PATH_RELATIVE_DIRS = ['.local/bin', 'bin', '.claude/local'] as const;
const KIMI_CODE_ACP_PATH_RELATIVE_DIR = '.kimi-code/bin';

/** External CLI login/status is retired; Molly credentials belong to main's vault. */
export async function resolveBuiltinAuthenticationProcessLaunch(
  _input: ResolveBuiltinAuthenticationProcessLaunchInput
): Promise<ResolvedACPProcessLaunch | null> {
  throw new Error('legacy_harness_authentication_disabled');
}

/** Synchronous launch cannot validate the packaged embedded runtime. */
export function resolveACPProcessLaunch(
  input: ResolveACPProcessLaunchInput
): ResolvedACPProcessLaunch {
  assertEmbeddedHarnessTarget(input);
  throw new Error('harness_async_launch_required');
}

/** The sole launch target is the verified application-bundled worker. */
export async function resolveACPProcessLaunchAsync(
  input: ResolveACPProcessLaunchInput
): Promise<ResolvedACPProcessLaunch> {
  input.signal?.throwIfAborted();
  assertEmbeddedHarnessTarget(input);
  return resolveEmbeddedHarnessLaunch();
}

export function mergeACPProcessEnv(
  launch: Pick<ResolvedACPProcessLaunch, 'env'>,
  baseEnv: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  return launch.env ? { ...baseEnv, ...launch.env } : baseEnv;
}

function getPathEnvKey(env: NodeJS.ProcessEnv): string {
  if (process.platform !== 'win32') {
    return 'PATH';
  }
  return Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'Path';
}

function normalizePathEntry(entry: string): string {
  const normalized = normalize(entry);
  return normalized.length > 1 ? normalized.replace(/[\\/]+$/, '') : normalized;
}

export function getDefaultAcpPathEntries(homeDir = homedir(), agentType?: string): string[] {
  if (!homeDir) {
    return [];
  }
  const relativeDirs =
    agentType === 'kimi' || agentType === 'kimi-code'
      ? [KIMI_CODE_ACP_PATH_RELATIVE_DIR, ...DEFAULT_ACP_PATH_RELATIVE_DIRS]
      : DEFAULT_ACP_PATH_RELATIVE_DIRS;
  return relativeDirs.map((relativeDir) => join(homeDir, relativeDir));
}

export function withDefaultAcpPathEntries(
  env: NodeJS.ProcessEnv,
  agentType?: string
): NodeJS.ProcessEnv {
  const defaultEntries = getDefaultAcpPathEntries(homedir(), agentType);
  if (defaultEntries.length === 0) {
    return env;
  }

  const pathKey = getPathEnvKey(env);
  const currentParts = (env[pathKey] ?? '').split(delimiter).filter(Boolean);
  const defaultEntrySet = new Set(defaultEntries.map(normalizePathEntry));
  const currentWithoutDefaults = currentParts.filter(
    (entry) => !defaultEntrySet.has(normalizePathEntry(entry))
  );
  const nextPath = [...defaultEntries, ...currentWithoutDefaults].join(delimiter);

  if (env[pathKey] === nextPath) {
    return env;
  }

  return {
    ...env,
    [pathKey]: nextPath,
  };
}

/**
 * Overlay a login-shell environment (see `getLoginShellEnv`) onto a base env when
 * spawning ACP agents.
 *
 * - Non-PATH vars: base wins. The base carries lody-injected values (e.g.
 *   `CODEX_HOME`, `LODY_*`) that must not be clobbered; the shell env only fills
 *   in vars the base process never had.
 * - PATH: union with the shell entries first, so user-installed agent binaries
 *   resolve from wherever the user actually put them (homebrew/cargo/volta/asdf/
 *   `~/.local/bin`/...). A GUI/daemon launch inherits a minimal PATH, so without
 *   this `opencode acp` & friends fail with ENOENT. Base-only entries (e.g.
 *   runtime-injected `node_modules/.bin`) are appended so nothing is lost.
 *
 * Hardcoding a few dirs (see `withDefaultAcpPathEntries`) was rejected: it cannot
 * cover the open-ended set of locations different users install tools into.
 */
export function mergeLoginShellEnv(
  base: NodeJS.ProcessEnv,
  shellEnv: NodeJS.ProcessEnv | null | undefined
): NodeJS.ProcessEnv {
  if (!shellEnv || Object.keys(shellEnv).length === 0) {
    return base;
  }

  const merged: NodeJS.ProcessEnv = { ...shellEnv, ...base };

  const pathKey = getPathEnvKey(base);
  const shellPathKey = getPathEnvKey(shellEnv);
  const shellParts = (shellEnv[shellPathKey] ?? '').split(delimiter).filter(Boolean);
  const baseParts = (base[pathKey] ?? '').split(delimiter).filter(Boolean);

  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const entry of [...shellParts, ...baseParts]) {
    const normalized = normalizePathEntry(entry);
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    ordered.push(entry);
  }

  if (ordered.length > 0) {
    merged[pathKey] = ordered.join(delimiter);
  }

  return merged;
}
