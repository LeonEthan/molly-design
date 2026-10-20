import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { z } from 'zod';
import { managed } from './fixtures/managed';
import { syntheticConnection, syntheticReply } from './fixtures/compatible';

it.each(['openai-responses', 'google-generative-ai'] as const)(
  '%s managed extraction and manual compaction cannot forward prompts on redirects',
  async (api) => {
    const previousDispatcher = getGlobalDispatcher();
    const transport = new MockAgent();
    transport.disableNetConnect();
    setGlobalDispatcher(transport);
    try {
      const targetRequests: string[] = [];
      transport
        .get('https://unselected.invalid')
        .intercept({ path: '/collect', method: 'POST' })
        .reply((request) => {
          targetRequests.push(String(request.body));
          return { statusCode: 401, data: '{}' };
        })
        .persist();
      const path =
        api === 'google-generative-ai'
          ? '/v1beta/models/model:streamGenerateContent?alt=sse'
          : '/v1/responses';
      let compacting = false;
      const recoveryRequests: string[] = [];
      transport
        .get('https://selected.invalid')
        .intercept({ path, method: 'POST' })
        .reply((request) => {
          const body = String(request.body);
          if (body.includes('Extract only explicitly stated') || compacting) {
            recoveryRequests.push(body);
            return {
              statusCode: 308,
              data: '',
              responseOptions: { headers: { location: 'https://unselected.invalid/collect' } },
            };
          }
          return {
            statusCode: 200,
            data: syntheticReply(api, 'Synthetic answer.'),
            responseOptions: { headers: { 'content-type': 'text/event-stream' } },
          };
        })
        .persist();
      const f = await managed({
        nativeTransport: true,
        config: { connection: syntheticConnection(api), personalMemory: true },
        peer: {
          extMethod: async (_method, params) => {
            const request = z
              .object({ request: z.object({ operation: z.object({ action: z.string() }) }) })
              .parse(params);
            expect(request.request.operation.action).toBe('read');
            return { revision: 'r1', enabled: true, entries: [] };
          },
        },
      });
      await writeFile(
        join(f.agentDir, 'settings.json'),
        JSON.stringify({
          retry: { enabled: false },
          compaction: { enabled: false, reserveTokens: 1024, keepRecentTokens: 1 },
        })
      );
      const bind = vi.spyOn(f.host, 'bind');
      const session = await f.open();
      const wrapper = bind.mock.calls[0]![0];
      f.grant(session.snapshot);
      const result = await session.prompt(
        'I prefer serif type. ' + 'Synthetic history. '.repeat(200)
      );
      expect(result.stopReason).toBe('end_turn');
      expect(result._meta?.mollyNativeOutcome).toMatchObject({ status: 'completed' });
      expect(result._meta?.mollyPersonalMemory).toBe('unchanged');
      expect(recoveryRequests.some((body) => body.includes('Extract only explicitly stated'))).toBe(
        true
      );
      const nextSnapshot = { ...session.snapshot, runId: 'second-run', turnId: 'second-turn' };
      f.grant(nextSnapshot);
      expect((await session.prompt('Second synthetic turn.', nextSnapshot)).stopReason).toBe(
        'end_turn'
      );
      compacting = true;
      await expect(
        wrapper.piSession.compact('Synthetic compaction instructions.')
      ).rejects.toThrow();
      expect(
        recoveryRequests.some((body) => body.includes('Synthetic compaction instructions.'))
      ).toBe(true);
      expect(targetRequests).toEqual([]);
    } finally {
      setGlobalDispatcher(previousDispatcher);
      await transport.close();
    }
  }
);
