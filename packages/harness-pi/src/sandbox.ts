import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  SandboxManager,
  type NetworkHostPattern,
  type SandboxRuntimeConfig,
} from '@anthropic-ai/sandbox-runtime';
import { createLocalBashOperations, type BashOperations } from '@earendil-works/pi-coding-agent';

/**
 * Development and design destinations reachable without review: package registries,
 * GitHub, font and icon services and common CDNs. Anything else is an escalation.
 */
export const PRE_ALLOWED_DOMAINS: readonly string[] = [
  'registry.npmjs.org',
  'registry.yarnpkg.com',
  'pypi.org',
  'files.pythonhosted.org',
  'github.com',
  '*.github.com',
  '*.githubusercontent.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'cdnjs.cloudflare.com',
  'esm.sh',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'use.typekit.net',
  'api.iconify.design',
  'code.iconify.design',
];

/** Credential stores under the user's home directory that sandboxed commands never read. */
const CREDENTIAL_PATHS: readonly string[] = [
  '.ssh',
  '.gnupg',
  '.aws',
  '.azure',
  '.config/gcloud',
  '.config/gh',
  '.docker',
  '.kube',
  '.netrc',
  '.npmrc',
  '.pypirc',
  '.git-credentials',
  '.password-store',
  'Library/Keychains',
];

export function deniedReadRoots(privateDataRoots: readonly string[], home = homedir()): string[] {
  return [...CREDENTIAL_PATHS.map((path) => join(home, path)), ...privateDataRoots];
}

export async function resolveNativeTemporaryDirectory(
  platform: NodeJS.Platform,
  resolveDirectory = async (): Promise<string> => {
    const { stdout } = await promisify(execFile)('/usr/bin/getconf', ['DARWIN_USER_TEMP_DIR'], {
      timeout: 5_000,
      maxBuffer: 4096,
      encoding: 'utf8',
    });
    return realpath(stdout.trim());
  }
): Promise<string | undefined> {
  if (platform !== 'darwin') return undefined;
  const directory = await resolveDirectory().catch(() => undefined);
  return directory && /^\/private\/var\/folders\/[^/]+\/[^/]+\/T$/.test(directory)
    ? directory
    : undefined;
}

export function createSandboxConfig(input: {
  cwd: string;
  temporaryDirectory: string;
  nativeTemporaryDirectory?: string;
  deniedReadRoots: readonly string[];
}): SandboxRuntimeConfig {
  return {
    network: { allowedDomains: [...PRE_ALLOWED_DOMAINS], deniedDomains: [] },
    filesystem: {
      denyRead: [...input.deniedReadRoots],
      allowRead: [input.cwd, input.temporaryDirectory],
      allowWrite: [
        input.cwd,
        input.temporaryDirectory,
        ...(input.nativeTemporaryDirectory ? [input.nativeTemporaryDirectory] : []),
      ],
      denyWrite: [],
    },
  };
}

export type SandboxNetworkReview = (target: NetworkHostPattern) => Promise<boolean>;

export function sandboxFailureContext(blocked: string): string {
  return blocked.trim()
    ? `\n${blocked.trim()}\nSandbox denials were observed during this command. They may be incidental; use the command's original error to diagnose the failure. Correct argument or dependency errors inside the workspace first. Request outside-sandbox execution only when a necessary access is confirmed blocked.\n`
    : '';
}

/**
 * One OS sandbox per worker, started on first use. Unsupported platforms or missing
 * dependencies leave it unavailable; shell then keeps its ordinary prompt.
 */
export class WorkerSandbox {
  private ready?: Promise<{ temporaryDirectory: string }>;
  constructor(
    private readonly input: {
      cwd: string;
      shellPath: string;
      deniedReadRoots: readonly string[];
      reviewNetwork: SandboxNetworkReview;
    }
  ) {}

  get available(): boolean {
    return (
      ['darwin', 'linux'].includes(process.platform) &&
      SandboxManager.isSupportedPlatform() &&
      SandboxManager.checkDependencies().errors.length === 0
    );
  }

  private start(): Promise<{ temporaryDirectory: string }> {
    this.ready ??= (async () => {
      // The worker's TMPDIR lies inside Molly private data, which the sandbox denies.
      const temporaryDirectory = await mkdtemp(join(await realpath('/tmp'), 'molly-sandbox-'));
      // sandbox-runtime 0.0.77 sets the wrapped command's TMPDIR from this host variable.
      process.env.CLAUDE_CODE_TMPDIR = temporaryDirectory;
      await SandboxManager.initialize(
        createSandboxConfig({
          cwd: this.input.cwd,
          temporaryDirectory,
          nativeTemporaryDirectory: await resolveNativeTemporaryDirectory(process.platform),
          deniedReadRoots: this.input.deniedReadRoots,
        }),
        (target) => this.input.reviewNetwork(target),
        process.platform === 'darwin'
      );
      return { temporaryDirectory };
    })();
    return this.ready;
  }

  operations(): BashOperations {
    const local = createLocalBashOperations({ shellPath: this.input.shellPath });
    return {
      exec: async (command, cwd, options) => {
        const { temporaryDirectory } = await this.start();
        options.signal?.throwIfAborted();
        const commandId = randomUUID();
        const wrapped = await SandboxManager.wrapWithSandbox(
          command,
          this.input.shellPath,
          undefined,
          options.signal,
          { commandId, commandText: command }
        );
        const result = await local.exec(wrapped, cwd, {
          ...options,
          env: { ...options.env, TMP: temporaryDirectory, TEMP: temporaryDirectory },
        });
        if (result.exitCode !== 0) {
          const blocked = SandboxManager.annotateStderrWithSandboxFailures(commandId, '');
          const context = sandboxFailureContext(blocked);
          if (context) options.onData(Buffer.from(context));
        }
        SandboxManager.cleanupAfterCommand();
        return result;
      },
    };
  }

  async dispose(): Promise<void> {
    if (!this.ready) return;
    const started = await this.ready.catch(() => undefined);
    await SandboxManager.reset().catch(() => undefined);
    if (started)
      await rm(started.temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}
