import { createHash } from 'node:crypto';
import {
  createReadToolDefinition,
  createWriteToolDefinition,
  createEditToolDefinition,
  createBashToolDefinition,
  defineTool,
  type BashOperations,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { OUTSIDE_SANDBOX_ARGUMENT } from './auto-review-policy';
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
    defineTool(createReadToolDefinition(input.cwd)),
    defineTool(createWriteToolDefinition(input.cwd)),
    defineTool(createEditToolDefinition(input.cwd)),
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
      const allowed = await waitForApproval(
        input.approve({ toolCallId, name: tool.name, arguments: args, signal }),
        signal
      );
      signal?.throwIfAborted();
      if (!allowed) throw new Error('harness_permission_denied');
      if (tool.name !== 'bash') return tool.execute(toolCallId, args, signal, onUpdate, context);
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
