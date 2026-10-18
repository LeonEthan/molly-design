import { describe, expect, it } from 'vitest';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import {
  HOST_SYSTEM_PROMPT_ENTRY,
  hostSystemPromptEntry,
  savedHostSystemPrompt,
} from '../src/host-system-prompt';

const current = { toolsetHash: 'a'.repeat(64), pluginSetHash: 'b'.repeat(64) };
const other = { toolsetHash: 'c'.repeat(64), pluginSetHash: 'b'.repeat(64) };
let sequence = 0;
const custom = (data: unknown, customType = HOST_SYSTEM_PROMPT_ENTRY): SessionEntry => ({
  type: 'custom',
  customType,
  data,
  id: `entry-${++sequence}`,
  parentId: null,
  timestamp: '2026-10-17T12:00:00.000Z',
});

describe('saved host system prompt selection', () => {
  it('reuses a v2 entry built with the current toolset and plugin set', () => {
    expect(savedHostSystemPrompt([custom(hostSystemPromptEntry('Saved', current))], current)).toBe(
      'Saved'
    );
  });

  it('requests a rebuild when no entry exists, the toolset differs or the plugin set differs', () => {
    expect(savedHostSystemPrompt([], current)).toBeUndefined();
    expect(
      savedHostSystemPrompt([custom(hostSystemPromptEntry('Saved', other))], current)
    ).toBeUndefined();
    expect(
      savedHostSystemPrompt(
        [custom(hostSystemPromptEntry('Saved', { ...current, pluginSetHash: 'd'.repeat(64) }))],
        current
      )
    ).toBeUndefined();
  });

  it('treats a legacy v1 entry as an unknown fingerprint and requests one rebuild', () => {
    const legacy = custom({ version: 1, systemPrompt: 'Legacy' });
    expect(savedHostSystemPrompt([legacy], current)).toBeUndefined();
    expect(
      savedHostSystemPrompt([legacy, custom(hostSystemPromptEntry('Rebuilt', current))], current)
    ).toBe('Rebuilt');
  });

  it('lets the latest entry win over earlier duplicates in either direction', () => {
    expect(
      savedHostSystemPrompt(
        [
          custom(hostSystemPromptEntry('First', current)),
          custom(hostSystemPromptEntry('Second', current)),
        ],
        current
      )
    ).toBe('Second');
    expect(
      savedHostSystemPrompt(
        [
          custom(hostSystemPromptEntry('Matching but older', current)),
          custom(hostSystemPromptEntry('Different toolset', other)),
        ],
        current
      )
    ).toBeUndefined();
  });

  it.each([
    ['missing data', undefined],
    ['unknown version', { version: 3, systemPrompt: 'Future' }],
    ['v2 without fingerprint', { version: 2, systemPrompt: 'Saved' }],
    ['non-hex fingerprint', { ...hostSystemPromptEntry('Saved', current), toolsetHash: 'x' }],
    ['non-string prompt', { version: 1, systemPrompt: 42 }],
  ])(
    'rejects a malformed entry (%s) with a named code, even before a later valid one',
    (_, data) => {
      for (const entries of [
        [custom(data)],
        [custom(data), custom(hostSystemPromptEntry('Later', current))],
        [custom(hostSystemPromptEntry('Earlier', current)), custom(data)],
      ])
        expect(() => savedHostSystemPrompt(entries, current)).toThrow(
          new Error('pi_acp_host_invalid_system_prompt_snapshot')
        );
    }
  );

  it('ignores unrelated custom entries', () => {
    expect(
      savedHostSystemPrompt(
        [custom(hostSystemPromptEntry('Saved', current)), custom({ note: 'x' }, 'synthetic')],
        current
      )
    ).toBe('Saved');
  });
});
