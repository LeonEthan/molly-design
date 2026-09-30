import { AsyncLocalStorage } from 'node:async_hooks';
import { constants } from 'node:fs';
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  createReadToolDefinition,
  detectSupportedImageMimeTypeFromFile,
  createWriteToolDefinition,
  createEditToolDefinition,
  createBashToolDefinition,
  defineTool,
  type BashOperations,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { OUTSIDE_SANDBOX_ARGUMENT, resolveThroughExistingAncestor } from './auto-review-policy';
import { createToolEnvironment } from './environment';

export type BrowserTaskApproval = { kind: 'browse_task'; sites: string[] };
/** Approved to run only inside the OS sandbox. */
export type SandboxedApproval = { kind: 'sandboxed' };
export type ToolApprovalResult = boolean | BrowserTaskApproval | SandboxedApproval;

export type ToolApproval = (request: {
  toolCallId: string;
  name: string;
  arguments: unknown;
  signal?: AbortSignal;
}) => Promise<ToolApprovalResult>;

export function waitForApproval(
  pending: Promise<ToolApprovalResult>,
  signal?: AbortSignal
): Promise<ToolApprovalResult> {
  if (!signal) return pending;
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve, reject) => {
    const cancelled = () => resolve(false);
    signal.addEventListener('abort', cancelled, { once: true });
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancelled));
  });
}

/** Native definitions, with the public execution hook owned by host authorization. */
export function createApprovedTools(input: {
  cwd: string;
  shellPath: string;
  approve: ToolApproval;
  /** OS-sandboxed shell execution, used only when an approval says `sandboxed`. */
  sandboxOperations?: BashOperations;
}): ToolDefinition[] {
  const execution = new AsyncLocalStorage<{
    toolCallId: string;
    name: string;
    arguments: unknown;
    approvedPaths: Set<string>;
    signal?: AbortSignal;
  }>();
  async function authorizePath(path: string) {
    const request = execution.getStore();
    if (!request) throw new Error('harness_file_execution_required');
    request.signal?.throwIfAborted();
    const canonical = resolveThroughExistingAncestor(path);
    if (request.approvedPaths.has(canonical)) return;
    const allowed = await waitForApproval(
      input.approve({
        ...request,
        arguments: { ...(request.arguments as Record<string, unknown>), path },
      }),
      request.signal
    );
    request.signal?.throwIfAborted();
    if (allowed !== true) throw new Error('harness_permission_denied');
    request.approvedPaths.add(canonical);
  }
  const fileRead = async (path: string) => {
    await authorizePath(path);
    return readFile(path);
  };
  const fileWrite = async (path: string, content: string) => {
    await authorizePath(path);
    await writeFile(path, content, 'utf8');
  };
  const bash = (operations?: BashOperations) =>
    defineTool(
      createBashToolDefinition(input.cwd, {
        shellPath: input.shellPath,
        exposeSessionEnvironment: false,
        spawnHook: (context) => ({ ...context, env: createToolEnvironment(context.env) }),
        ...(operations ? { operations } : {}),
      })
    );
  const localBash = bash();
  const sandboxedBash = input.sandboxOperations ? bash(input.sandboxOperations) : undefined;
  const definitions: ToolDefinition[] = [
    defineTool(
      createReadToolDefinition(input.cwd, {
        operations: {
          readFile: fileRead,
          access: async (path) => {
            await authorizePath(path);
            await access(path, constants.R_OK);
          },
          detectImageMimeType: async (path) => {
            await authorizePath(path);
            return detectSupportedImageMimeTypeFromFile(path);
          },
        },
      })
    ),
    defineTool(
      createWriteToolDefinition(input.cwd, {
        operations: {
          writeFile: fileWrite,
          mkdir: async (path) => {
            if ((await stat(path).catch(() => undefined))?.isDirectory()) return;
            await authorizePath(path);
            await mkdir(path, { recursive: true });
          },
        },
      })
    ),
    defineTool(
      createEditToolDefinition(input.cwd, {
        operations: {
          readFile: fileRead,
          writeFile: fileWrite,
          access: async (path) => {
            await authorizePath(path);
            await access(path, constants.R_OK | constants.W_OK);
          },
        },
      })
    ),
    {
      ...localBash,
      parameters: Type.Object(
        {
          ...localBash.parameters.properties,
          [OUTSIDE_SANDBOX_ARGUMENT]: Type.Optional(
            Type.Boolean({
              description:
                'Auto-review mode only: request running this command outside the OS sandbox after the sandbox blocked something the task needs. A reviewer checks the request against the user task; other modes ask for every command.',
            })
          ),
        },
        { additionalProperties: false }
      ),
    },
  ];
  return definitions.map((tool) => ({
    ...tool,
    async execute(toolCallId, args, signal, onUpdate, context) {
      signal?.throwIfAborted();
      if (tool.name !== 'bash') {
        return execution.run(
          { toolCallId, name: tool.name, arguments: args, signal, approvedPaths: new Set() },
          () => tool.execute(toolCallId, args, signal, onUpdate, context)
        );
      }
      const allowed = await waitForApproval(
        input.approve({ toolCallId, name: tool.name, arguments: args, signal }),
        signal
      );
      signal?.throwIfAborted();
      if (!allowed) throw new Error('harness_permission_denied');
      const native: Record<string, unknown> = { ...(args as Record<string, unknown>) };
      delete native[OUTSIDE_SANDBOX_ARGUMENT];
      if (typeof allowed === 'object' && allowed.kind === 'sandboxed') {
        if (!sandboxedBash) throw new Error('harness_sandbox_unavailable');
        return sandboxedBash.execute(toolCallId, native as never, signal, onUpdate, context);
      }
      return localBash.execute(toolCallId, native as never, signal, onUpdate, context);
    },
  }));
}

export function hashToolset(tools: ToolDefinition[]): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        tools
          .map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          }))
          .sort((a, b) => a.name.localeCompare(b.name))
      )
    )
    .digest('hex');
}
