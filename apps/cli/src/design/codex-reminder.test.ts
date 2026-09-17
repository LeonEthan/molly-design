import { describe, expect, it } from 'vitest';
import { codexDesignReminderConfig } from './codex-reminder';

describe('Codex design reminder config', () => {
  it('preserves provider settings, user hooks and trust without trusting unknown commands', () => {
    const existing = {
      model_provider: 'custom',
      features: { hooks: false },
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'user-command' }] }],
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'user-guard' }] }],
        state: { 'user-hook': { enabled: false, trusted_hash: 'user-owned' } },
      },
    };
    const saved = JSON.stringify(existing);
    const result = codexDesignReminderConfig('molly-fixed-command', saved);
    expect(result.model_provider).toBe('custom');
    expect(result.features).toEqual({ hooks: false });
    expect(result.hooks.PreToolUse).toEqual(existing.hooks.PreToolUse);
    expect(result.hooks.UserPromptSubmit[0]).toEqual(existing.hooks.UserPromptSubmit[0]);
    expect(result.hooks.state['user-hook']).toEqual(existing.hooks.state['user-hook']);
    expect(result.hooks.UserPromptSubmit[1]).toEqual({
      hooks: [{ async: false, command: 'molly-fixed-command', timeout: 5, type: 'command' }],
    });
    expect(Object.entries(result.hooks.state).filter(([key]) => key !== 'user-hook')).toEqual([
      [
        expect.stringMatching(/:user_prompt_submit:1:0$/),
        { enabled: true, trusted_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/) },
      ],
    ]);
    expect(JSON.stringify(existing)).toBe(saved);
  });

  it.each([
    '{',
    '{"hooks":false}',
    '{"hooks.UserPromptSubmit":[]}',
    '{"hooks":{"UserPromptSubmit":{}}}',
    '{"hooks":{"state":[]}}',
  ])('rejects malformed existing config rather than discarding it: %s', (raw) => {
    expect(() => codexDesignReminderConfig('molly-fixed-command', raw)).toThrow();
  });

  it('binds native trust to the exact supplied application command', () => {
    const a = codexDesignReminderConfig('node first');
    const b = codexDesignReminderConfig('node second');
    expect(a.hooks.state).not.toEqual(b.hooks.state);
  });
});
