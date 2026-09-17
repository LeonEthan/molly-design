import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { reloadGrokDesignReminder } from './grok-reminder';

describe('Grok reminder native reload', () => {
  it('accepts only the enabled hook from the exact application plugin directory', async () => {
    const methods: string[] = [];
    await reloadGrokDesignReminder(
      async (method) => {
        methods.push(method);
        return {
          result: {
            hooks: [
              { sourceDir: '/user/plugin/hooks', event: 'pre_tool_use', disabled: false },
              {
                sourceDir: path.join('/molly/plugin', 'hooks'),
                event: 'pre_tool_use',
                disabled: false,
              },
            ],
          },
        };
      },
      'session',
      '/molly/plugin'
    );
    expect(methods).toEqual(['x.ai/hooks/action', 'x.ai/hooks/list']);
  });

  it.each(
    [
      [],
      [{ sourceDir: '/user/plugin/hooks', event: 'pre_tool_use', disabled: false }],
      [{ sourceDir: path.join('/molly/plugin', 'hooks'), event: 'pre_tool_use', disabled: true }],
    ].map((hooks) => ({ hooks }))
  )(
    'does not mistake absent, unrelated or disabled hooks for a loaded reminder',
    async ({ hooks }) => {
      await expect(
        reloadGrokDesignReminder(async () => ({ result: { hooks } }), 'session', '/molly/plugin')
      ).rejects.toThrow('was not loaded');
    }
  );
});
