import { createHash } from 'node:crypto';
import {
  createReadToolDefinition,
  createWriteToolDefinition,
  createEditToolDefinition,
  createBashToolDefinition,
  defineTool,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { createToolEnvironment } from './environment';

export type ToolApproval = (request: {
  toolCallId: string;
  name: string;
  arguments: unknown;
  signal?: AbortSignal;
}) => Promise<boolean>;

export function waitForApproval(pending: Promise<boolean>, signal?: AbortSignal): Promise<boolean> {
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
}): ToolDefinition[] {
  const definitions: ToolDefinition[] = [
    defineTool(createReadToolDefinition(input.cwd)),
    defineTool(createWriteToolDefinition(input.cwd)),
    defineTool(createEditToolDefinition(input.cwd)),
    defineTool(
      createBashToolDefinition(input.cwd, {
        shellPath: input.shellPath,
        exposeSessionEnvironment: false,
        spawnHook: (context) => ({ ...context, env: createToolEnvironment(context.env) }),
      })
    ),
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
      return tool.execute(toolCallId, args, signal, onUpdate, context);
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
