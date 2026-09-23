import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import {
  AgentBrowserRpcResultSchema,
  type AgentBrowserCommand,
  type AgentBrowserReply,
} from '@molly/shared/browser-agent-rpc';
import { makeLocalControlClientAuto } from '@molly/shared/node/local-ipc';
import type { McpSessionContext } from './molly-mcp-server';

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export async function resolveBrowserHost(ctx: McpSessionContext): Promise<boolean> {
  if (!ctx.localControlSocketPath || !ctx.designHookLaunchId) return false;
  try {
    const answer = await Effect.runPromise(
      makeLocalControlClientAuto({ socketPath: ctx.localControlSocketPath }).machineRpc(
        {
          machineId: ctx.machineId,
          workspaceId: ctx.workspaceId,
          method: 'browser/host-status',
          params: {},
        },
        { timeoutMs: 5_000 }
      )
    );
    if (!answer.ok) return false;
    const parsed = AgentBrowserRpcResultSchema.safeParse(answer.result);
    return parsed.success && parsed.data.type === 'browser/host-status' && parsed.data.connected;
  } catch {
    return false;
  }
}

export async function requestBrowserOperation(
  ctx: McpSessionContext,
  command: AgentBrowserCommand,
  signal: AbortSignal
): Promise<{ ok: true; reply: AgentBrowserReply } | { ok: false; error: string }> {
  const socketPath = ctx.localControlSocketPath;
  const launchId = ctx.designHookLaunchId;
  if (!socketPath || !launchId)
    return { ok: false, error: 'Browser is unavailable in this session.' };
  signal.throwIfAborted();
  const client = makeLocalControlClientAuto({ socketPath });
  const requestId = randomUUID();
  let aborted = false;
  let onAbort: (() => void) | undefined;
  const abort = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      aborted = true;
      reject(
        new Error('Browser operation was cancelled; a dispatched action may already have happened.')
      );
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    const answer = await Promise.race([
      Effect.runPromise(
        client.machineRpc(
          {
            machineId: ctx.machineId,
            workspaceId: ctx.workspaceId,
            ownerSessionId: ctx.sessionId,
            method: 'browser/execute',
            params: { requestId, launchId, command },
          },
          { timeoutMs: 50_000 }
        )
      ),
      abort,
    ]);
    signal.throwIfAborted();
    if (!answer.ok) return { ok: false, error: answer.error };
    const parsed = AgentBrowserRpcResultSchema.safeParse(answer.result);
    if (!parsed.success || parsed.data.type !== 'browser/execute') {
      return { ok: false, error: 'Browser host returned an unexpected answer.' };
    }
    return parsed.data.ok
      ? { ok: true, reply: parsed.data.reply }
      : { ok: false, error: parsed.data.error };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
    if (aborted) {
      // This is a separate socket call so the daemon can revoke a dispatched
      // page even while the original RPC is still waiting for its host report.
      await Effect.runPromise(
        client.machineRpc(
          {
            machineId: ctx.machineId,
            workspaceId: ctx.workspaceId,
            ownerSessionId: ctx.sessionId,
            method: 'browser/cancel',
            params: { requestId, launchId },
          },
          { timeoutMs: 5_000 }
        )
      ).catch(() => undefined);
    }
  }
}
