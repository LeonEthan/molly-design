import { describe, expect, it, vi } from 'vitest';
import type { Api, AssistantMessage, Model } from '@earendil-works/pi-ai';
import { RequestError } from '@agentclientprotocol/sdk';
import { z } from 'zod';
import { extractPersonalPreferences, parsePersonalPreferenceChanges } from '../src/personal-memory';
import { personalMemoryErrorCode } from '../src/host';

const snapshot = {
  revision: 'r1',
  enabled: true,
  entries: [{ id: 'p1', text: 'Likes muted color' }],
};

describe('parsePersonalPreferenceChanges', () => {
  it('accepts strict JSON', () => {
    expect(
      parsePersonalPreferenceChanges('{"changes":[{"text":"Prefers serif type"}]}', snapshot)
    ).toEqual({ changes: [{ text: 'Prefers serif type' }] });
  });

  it('strips a JSON code fence', () => {
    const text = '```json\n{"changes":[{"text":"Prefers serif type"}]}\n```';
    expect(parsePersonalPreferenceChanges(text, snapshot)).toEqual({
      changes: [{ text: 'Prefers serif type' }],
    });
  });

  it('tolerates surrounding prose, trailing commas, a bare array and extra keys', () => {
    expect(
      parsePersonalPreferenceChanges(
        'Here is the result:\n{"changes":[{"text":" Prefers serif type ","why":"stated"},],}\nDone.',
        snapshot
      )
    ).toEqual({ changes: [{ text: 'Prefers serif type' }] });
    expect(
      parsePersonalPreferenceChanges('[{"id":"p1","text":"Likes warm color"}]', snapshot)
    ).toEqual({ changes: [{ id: 'p1', text: 'Likes warm color' }] });
    expect(parsePersonalPreferenceChanges('{}', snapshot)).toEqual({ changes: [] });
  });

  it('fails soft on prose and wrong shapes without throwing', () => {
    expect(
      parsePersonalPreferenceChanges('No durable personal preferences were stated.', snapshot)
    ).toEqual({ changes: [], diagnostic: 'memory_extraction_not_json' });
    expect(parsePersonalPreferenceChanges('{"preferences":["serif"]}', snapshot)).toEqual({
      changes: [],
      diagnostic: 'memory_extraction_invalid_shape',
    });
  });

  it('drops invalid, unknown-id and duplicate changes instead of failing capture', () => {
    const result = parsePersonalPreferenceChanges(
      JSON.stringify({
        changes: [
          { text: 'Prefers serif type' },
          { text: 'prefers  serif type' },
          { text: 'likes muted color' },
          { id: 'missing', text: 'Hallucinated update' },
          { text: 'x'.repeat(301) },
          { text: '' },
          'loose string',
          { id: 'p1', text: 'Likes muted color' },
        ],
      }),
      snapshot
    );
    expect(result).toEqual({
      changes: [{ text: 'Prefers serif type' }],
      diagnostic: 'memory_extraction_dropped_changes',
    });
  });

  it('keeps new preferences within the remaining store capacity', () => {
    const full = {
      entries: Array.from({ length: 31 }, (_, i) => ({ id: `p${i}`, text: `Pref ${i}` })),
    };
    expect(parsePersonalPreferenceChanges('{"changes":[{"text":"A"},{"text":"B"}]}', full)).toEqual(
      { changes: [{ text: 'A' }], diagnostic: 'memory_extraction_dropped_changes' }
    );
  });
});

describe('extractPersonalPreferences', () => {
  const model = { id: 'model', provider: 'p', api: 'openai-completions' } as unknown as Model<Api>;
  function reply(text: string, stopReason: AssistantMessage['stopReason'] = 'stop') {
    return {
      role: 'assistant',
      content: [{ type: 'text', text }],
      provider: 'p',
      model: 'model',
      api: 'openai-completions',
      usage: {},
      stopReason,
      timestamp: 0,
    } as unknown as AssistantMessage;
  }
  function run(
    completeSimple: () => Promise<AssistantMessage>,
    signal = new AbortController().signal
  ) {
    const recordUsage = vi.fn(async () => {});
    return {
      recordUsage,
      result: extractPersonalPreferences({
        runtime: { completeSimple: vi.fn(completeSimple) } as never,
        model,
        snapshot,
        userText: 'I prefer serif type.',
        signal,
        recordUsage,
      }),
    };
  }

  it('returns fenced changes and records usage', async () => {
    const { result, recordUsage } = run(async () =>
      reply('```json\n{"changes":[{"text":"Prefers serif type"}]}\n```')
    );
    await expect(result).resolves.toEqual({ changes: [{ text: 'Prefers serif type' }] });
    expect(recordUsage).toHaveBeenCalledOnce();
  });

  it('fails soft on an unfinished or failed extraction reply', async () => {
    await expect(run(async () => reply('{"changes":[', 'length')).result).resolves.toEqual({
      changes: [],
      diagnostic: 'memory_extraction_incomplete',
    });
    await expect(run(async () => reply('', 'error')).result).resolves.toEqual({
      changes: [],
      diagnostic: 'memory_extraction_request_failed',
    });
    await expect(
      run(async () => {
        throw new Error('provider said sk-secret');
      }).result
    ).resolves.toEqual({ changes: [], diagnostic: 'memory_extraction_request_failed' });
  });

  it('still throws on caller cancellation', async () => {
    const controller = new AbortController();
    const { result } = run(async () => {
      controller.abort();
      throw new Error('aborted');
    }, controller.signal);
    await expect(result).rejects.toThrow();
  });
});

describe('personalMemoryErrorCode', () => {
  it('reports only static codes', () => {
    expect(personalMemoryErrorCode(new Error('memory_stale'))).toBe('memory_stale');
    expect(personalMemoryErrorCode(RequestError.internalError({ details: 'memory_full' }))).toBe(
      'memory_full'
    );
    expect(
      personalMemoryErrorCode(RequestError.internalError({ details: 'Bearer sk-secret leaked' }))
    ).toBe('memory_peer_error_32603');
    expect(personalMemoryErrorCode(new Error('Unexpected token N in JSON'))).toBe(
      'memory_unexpected_error'
    );
    expect(personalMemoryErrorCode(z.string().safeParse(1).error)).toBe('memory_schema_invalid');
  });
});
