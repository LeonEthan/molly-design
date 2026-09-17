import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import {
  makeLocalControlClientAuto,
  getLocalControlSocketPath,
} from '@molly/shared/node/local-ipc';
import {
  DesignToolHookResultSchema,
  DesignResubmitInputSchema,
} from '@molly/shared/local-machine-rpc';
import { DESIGN_READ_BEFORE_EDIT_REMINDER } from './read-before-edit-reminder';
import type { DesignToolEvent } from './sync-service';

interface PiEvent {
  systemPrompt?: string;
  message?: { role?: string; stopReason?: string };
}
interface PiExtensionApi {
  on(event: string, handler: (event: PiEvent) => Promise<unknown>): void;
  registerTool(tool: {
    name: string;
    label: string;
    description: string;
    parameters: unknown;
    execute(callId: string, params: unknown): Promise<unknown>;
  }): void;
}
export default function mollyDesignExtension(pi: PiExtensionApi): void {
  let runId: string | undefined;
  let terminal: 'end_turn' | 'failed' | 'cancelled' | undefined;
  const request = async (event: DesignToolEvent) => {
    const response = await Effect.runPromise(
      makeLocalControlClientAuto({
        socketPath:
          process.env.MOLLY_DESIGN_CONTROL_SOCKET ??
          process.env.LODY_DESIGN_CONTROL_SOCKET ??
          getLocalControlSocketPath(),
      }).machineRpc(
        {
          method: 'design/tool-hook',
          machineId:
            process.env.MOLLY_DESIGN_MACHINE_ID ?? process.env.LODY_DESIGN_MACHINE_ID ?? '',
          workspaceId:
            process.env.MOLLY_DESIGN_WORKSPACE_ID ?? process.env.LODY_DESIGN_WORKSPACE_ID ?? '',
          ownerSessionId: process.env.MOLLY_SESSION_ID ?? process.env.LODY_SESSION_ID,
          params: {
            version: 2,
            launchId: process.env.MOLLY_DESIGN_LAUNCH_ID ?? process.env.LODY_DESIGN_LAUNCH_ID,
            event,
          },
        },
        { timeoutMs: 30_000 }
      )
    );
    if (!response.ok) throw Error(response.error);
    const answer = DesignToolHookResultSchema.parse(response.result);
    if (!answer.ok || !answer.supported)
      throw Error(answer.error ?? 'Design execution context unavailable');
  };
  pi.on('before_agent_start', async (event) => {
    // Only native settlement interpretation is pinned; no tool/read interception.
    if ((process.env.MOLLY_DESIGN_PI_VERSION ?? process.env.LODY_DESIGN_PI_VERSION) !== '0.85.1')
      throw Error('Native Pi completion verification requires Pi 0.85.1');
    runId = randomUUID();
    terminal = undefined;
    await request({ phase: 'start', runId });
    return { systemPrompt: `${event.systemPrompt ?? ''}\n\n${DESIGN_READ_BEFORE_EDIT_REMINDER}` };
  });
  pi.on('message_end', async (event) => {
    if (event.message?.role === 'assistant')
      terminal =
        event.message.stopReason === 'error'
          ? 'failed'
          : event.message.stopReason === 'aborted'
            ? 'cancelled'
            : event.message.stopReason === 'stop'
              ? 'end_turn'
              : undefined;
  });
  // ACP 0.0.33 loses native provider errors. Await actual settled status, not a
  // guessed success, and bind it to this native execution rather than a model batch.
  pi.on('agent_settled', async () => {
    if (runId && terminal) await request({ phase: 'terminal', runId, status: terminal });
  });
  pi.registerTool({
    name: 'molly_resubmit_draft',
    label: 'Resubmit preserved design draft',
    description:
      'Explicitly retain the exact existing draft against the expected current-canvas revision. Supply the artifact digest and revision from the saved files/turn facts after inspecting and comparing them. This neither commits nor ends the turn; natural completion independently validates the unchanged submitted bytes and versions.',
    parameters: {
      type: 'object',
      properties: {
        expectedRevisionId: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        artifactDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      },
      required: ['expectedRevisionId', 'artifactDigest'],
      additionalProperties: false,
    },
    async execute(_callId, params) {
      await request({ phase: 'resubmit', ...DesignResubmitInputSchema.parse(params) });
      return {
        content: [
          {
            type: 'text',
            text: 'Exact draft submission recorded against the expected canvas version. Nothing committed; finish naturally when ready. Changed bytes require another explicit submission or a new turn.',
          },
        ],
        details: {},
      };
    },
  });
}
