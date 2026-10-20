import { describe, expect, it, vi } from 'vitest';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { managed } from './fixtures/managed';
import { deferred } from './fixtures/adapter';
import { TITLE_TIMEOUT_MS } from '../src/session-title';

const brief = 'Design a poster for a jazz night. Use warm colours.';
const scaffolding = 'Canvas size: 800 × 600 px. Design at exactly this width and height.';

describe('embedded first-turn title wiring', () => {
  it('uses the selected runtime without blocking design inference and records title usage', async () => {
    const mainOutput = deferred<void>();
    const title = deferred<ReturnType<typeof fauxAssistantMessage>>();
    const f = await managed({
      peer: {
        sessionUpdate: async ({ update }) => {
          if (update.sessionUpdate === 'agent_message_chunk') mainOutput.resolve();
        },
      },
    });
    const session = await f.open();
    const models: unknown[] = [];
    vi.spyOn(f.runtime(), 'completeSimple').mockImplementation(async (model, context) => {
      models.push({ id: model.id, provider: model.provider });
      expect(context.messages[0]?.content).toBe(brief);
      expect(JSON.stringify(context)).not.toContain(scaffolding);
      return title.promise;
    });
    f.grant(session.snapshot);
    const pending = session.prompt(`${brief}\n${scaffolding}`, session.snapshot, brief);
    await mainOutput.promise;
    expect(
      f.updates.filter(({ update }) => update.sessionUpdate === 'session_info_update')
    ).toEqual([]);
    title.resolve(fauxAssistantMessage('Warm Jazz Night'));
    expect((await pending).stopReason).toBe('end_turn');
    expect(models).toEqual([f.host.model]);
    expect(
      f.updates
        .filter(({ update }) => update.sessionUpdate === 'session_info_update')
        .map(({ update }) => update)
    ).toEqual([
      {
        sessionUpdate: 'session_info_update',
        title: 'Warm Jazz Night',
        _meta: { lody: { titleSource: 'explicit' } },
      },
    ]);
    const history = await import('node:fs/promises').then(({ readFile }) =>
      readFile(session.binding.nativeSessionFile, 'utf8')
    );
    expect(history).toContain('session_title');
    expect(history).not.toContain('Generate a short artwork title');
  });

  it.each(['empty', 'failure'] as const)(
    'keeps the title absent on %s and completes the design turn',
    async (kind) => {
      const f = await managed();
      const session = await f.open();
      vi.spyOn(f.runtime(), 'completeSimple').mockImplementation(async () => {
        if (kind === 'failure') throw new Error('synthetic title failure');
        return fauxAssistantMessage('');
      });
      f.grant(session.snapshot);
      expect((await session.prompt(brief, session.snapshot, brief)).stopReason).toBe('end_turn');
      expect(
        f.updates.filter(({ update }) => update.sessionUpdate === 'session_info_update')
      ).toEqual([]);
    }
  );

  it('does not repeat title generation on later turns', async () => {
    const f = await managed();
    const session = await f.open();
    const titleInputs: string[] = [];
    vi.spyOn(f.runtime(), 'completeSimple').mockImplementation(async (_model, context) => {
      titleInputs.push(JSON.stringify(context.messages));
      return fauxAssistantMessage('Warm Jazz Night');
    });
    f.grant(session.snapshot);
    await session.prompt(brief, session.snapshot, brief);
    expect(titleInputs).toHaveLength(1);
    for (const turn of ['second', 'third']) {
      const snapshot = { ...session.snapshot, runId: turn, turnId: turn };
      f.grant(snapshot);
      await session.prompt(brief, snapshot, brief);
    }
    expect(titleInputs).toHaveLength(1);
  });
  it('completes the design with no title when naming times out', async () => {
    const mainOutput = deferred<void>();
    const f = await managed({
      peer: {
        sessionUpdate: async ({ update }) => {
          if (update.sessionUpdate === 'agent_message_chunk') mainOutput.resolve();
        },
      },
    });
    const session = await f.open();
    vi.spyOn(f.runtime(), 'completeSimple').mockImplementation((_model, _context, options) => {
      return new Promise((_resolve, reject) => {
        const abort = () => reject(new Error('aborted'));
        if (options?.signal?.aborted) abort();
        else options?.signal?.addEventListener('abort', abort, { once: true });
      });
    });
    vi.useFakeTimers();
    try {
      f.grant(session.snapshot);
      const pending = session.prompt(brief, session.snapshot, brief);
      await mainOutput.promise;
      await vi.advanceTimersByTimeAsync(TITLE_TIMEOUT_MS);
      expect((await pending).stopReason).toBe('end_turn');
      expect(
        f.updates.filter(({ update }) => update.sessionUpdate === 'session_info_update')
      ).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('holds the run until a title call that ignores abort settles', async () => {
    const mainOutput = deferred<void>();
    const title = deferred<ReturnType<typeof fauxAssistantMessage>>();
    const f = await managed({
      peer: {
        sessionUpdate: async ({ update }) => {
          if (update.sessionUpdate === 'agent_message_chunk') mainOutput.resolve();
        },
      },
    });
    const session = await f.open();
    vi.spyOn(f.runtime(), 'completeSimple').mockImplementation(async () => title.promise);
    vi.useFakeTimers();
    try {
      f.grant(session.snapshot);
      const pending = session.prompt(brief, session.snapshot, brief);
      await mainOutput.promise;
      await vi.advanceTimersByTimeAsync(TITLE_TIMEOUT_MS);
      expect(f.host.busy).toBe(true);
      title.resolve(fauxAssistantMessage('Late title'));
      expect((await pending).stopReason).toBe('end_turn');
      expect(f.host.busy).toBe(false);
      expect(
        f.updates.filter(({ update }) => update.sessionUpdate === 'session_info_update')
      ).toEqual([]);
      const history = await import('node:fs/promises').then(({ readFile }) =>
        readFile(session.binding.nativeSessionFile, 'utf8')
      );
      expect(history).toContain('session_title');
    } finally {
      vi.useRealTimers();
    }
  });

  it('releases a title call that ignores abort when the worker is retired', async () => {
    const mainOutput = deferred<void>();
    const f = await managed({
      peer: {
        sessionUpdate: async ({ update }) => {
          if (update.sessionUpdate === 'agent_message_chunk') mainOutput.resolve();
        },
      },
    });
    const session = await f.open();
    vi.spyOn(f.runtime(), 'completeSimple').mockImplementation(async () => new Promise(() => {}));
    vi.useFakeTimers();
    try {
      f.grant(session.snapshot);
      const pending = session.prompt(brief, session.snapshot, brief);
      await mainOutput.promise;
      await vi.advanceTimersByTimeAsync(TITLE_TIMEOUT_MS);
      expect(f.host.busy).toBe(true);
      f.host.retire();
      await expect(pending).resolves.toMatchObject({ stopReason: 'end_turn' });
      expect(f.host.busy).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never names a later turn if the first turn had no naming provenance', async () => {
    const f = await managed();
    const session = await f.open();
    const titleInputs: unknown[] = [];
    vi.spyOn(f.runtime(), 'completeSimple').mockImplementation(async (_model, context) => {
      titleInputs.push(context);
      return fauxAssistantMessage('Warm Jazz Night');
    });
    f.grant(session.snapshot);
    await session.prompt(brief);
    const later = { ...session.snapshot, runId: 'later', turnId: 'later' };
    f.grant(later);
    await session.prompt(brief, later, brief);
    expect(titleInputs).toEqual([]);
  });
});
