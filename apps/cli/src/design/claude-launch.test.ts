import { expect, it } from 'vitest';
import { claudeDesignSettings } from './claude-launch';

it('keeps explicit Claude model routing when adding session hooks', () => {
  const modelOverrides = { sonnet: 'enterprise/sonnet' };
  const availableModels = ['enterprise/sonnet'];
  const settings = claudeDesignSettings(
    'native-hook',
    JSON.stringify({ modelOverrides, availableModels })
  );
  expect(settings.modelOverrides).toEqual(modelOverrides);
  expect(settings.availableModels).toEqual(availableModels);
  expect(settings.hooks.UserPromptSubmit).toEqual([
    { hooks: [{ type: 'command', command: 'native-hook', timeout: 35 }] },
  ]);
  expect(Object.keys(settings.hooks)).toEqual(['UserPromptSubmit']);
  expect(() => claudeDesignSettings('native-hook', '[]')).toThrow();
});
