import { z } from 'zod';
import type { SessionNotification } from '@agentclientprotocol/sdk';
import { deferred } from './adapter';

export function retrySignals() {
  const scheduled = [deferred<void>(), deferred<void>(), deferred<void>()];
  const pending = [...scheduled];
  return {
    scheduled,
    sessionUpdate: async ({ update }: SessionNotification) => {
      if (
        (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') &&
        update.status === 'in_progress' &&
        z
          .object({ lody: z.object({ activity: z.object({ kind: z.literal('retry') }) }) })
          .safeParse(update._meta).success
      )
        pending.shift()?.resolve();
    },
  };
}
