import { describe, expect, it } from 'vitest';
import {
  createExtensionRuntime,
  SettingsManager,
  createReadToolDefinition,
  defineTool,
  type Extension,
  type LoadExtensionsResult,
} from '@earendil-works/pi-coding-agent';
import { MollyResourceLoader } from '../src/resource-loader';

function extension(path: string, toolNames: string[] = []): Extension {
  const sourceInfo = { path, source: 'synthetic', scope: 'temporary', origin: 'package' } as const;
  return {
    path: `<inline:${path}>`,
    resolvedPath: `<inline:${path}>`,
    sourceInfo,
    handlers: new Map(),
    commands: new Map(),
    flags: new Map(),
    shortcuts: new Map(),
    messageRenderers: new Map(),
    tools: new Map(
      toolNames.map((name) => [
        name,
        {
          definition: defineTool({ ...createReadToolDefinition('/synthetic'), name }),
          sourceInfo,
        },
      ])
    ),
  };
}

function resources(extensions: Extension[]): LoadExtensionsResult {
  return { extensions, errors: [], runtime: createExtensionRuntime() };
}

const defaults = {
  cwd: '/synthetic',
  privateRoot: '/synthetic/private',
  systemPrompt: 'Approved context',
  settings: SettingsManager.inMemory({ packages: [] }),
};

describe('closed extension registrations', () => {
  it('loads extension commands without executing them', async () => {
    const candidate = extension('candidate');
    const effects: string[] = [];
    candidate.commands.set('synthetic-command', {
      name: 'synthetic-command',
      sourceInfo: candidate.sourceInfo,
      handler: async () => {
        effects.push('executed');
      },
    });
    const loader = new MollyResourceLoader({ ...defaults, extensions: resources([candidate]) });
    await loader.reload();
    expect(loader.getExtensions().extensions[0]?.commands.has('synthetic-command')).toBe(true);
    expect(effects).toEqual([]);
  });
  it.each(['read', 'write', 'edit', 'bash', 'powershell', 'grep', 'find', 'ls'])(
    'reserves %s even when absent from the current host toolset',
    (name) => {
      expect(
        () =>
          new MollyResourceLoader({
            ...defaults,
            extensions: resources([extension('candidate', [name])]),
          })
      ).toThrow('harness_extension_tool_collision');
    }
  );

  it('rejects a collision with a host-defined tool outside reserved namespaces', () => {
    expect(
      () =>
        new MollyResourceLoader({
          ...defaults,
          hostToolNames: ['host_capability'],
          extensions: resources([extension('candidate', ['host_capability'])]),
        })
    ).toThrow('harness_extension_tool_collision');
  });

  it('rejects duplicate tools across approved extensions instead of choosing a winner', () => {
    expect(
      () =>
        new MollyResourceLoader({
          ...defaults,
          extensions: resources([
            extension('first', ['question']),
            extension('second', ['question']),
          ]),
        })
    ).toThrow('harness_extension_tool_collision');
  });

  it('rejects different registration and execution names', () => {
    const candidate = extension('candidate', ['question']);
    candidate.tools.get('question')!.definition.name = 'read';
    expect(
      () => new MollyResourceLoader({ ...defaults, extensions: resources([candidate]) })
    ).toThrow('harness_extension_tool_identity');
  });

  it('rejects duplicate host definitions but permits one guarded native replacement', () => {
    expect(() => new MollyResourceLoader({ ...defaults, hostToolNames: ['read', 'read'] })).toThrow(
      'harness_duplicate_host_tool'
    );
    expect(
      new MollyResourceLoader({ ...defaults, hostToolNames: ['read'] }).getExtensions().errors
    ).toEqual([]);
  });

  it('preserves manifest hook order and appends the public reminder without changing the input', async () => {
    const first = extension('first', ['question']);
    const second = extension('second', ['lookup']);
    const approved = resources([first, second]);
    const loader = new MollyResourceLoader({
      ...defaults,
      extensions: approved,
      readBeforeEditReminder: 'Read first.',
      hostTime: {
        now: () => new Date('2026-09-26T06:46:00.000Z'),
        resolveTimeZone: () => 'America/Los_Angeles',
      },
    });
    await loader.reload();
    approved.extensions.reverse();
    const loaded = loader.getExtensions().extensions;
    expect(loaded.slice(0, 2).map((item) => item.path)).toEqual([
      '<inline:first>',
      '<inline:second>',
    ]);
    expect(loaded.flatMap((item) => [...item.tools.keys()])).toEqual(['question', 'lookup']);
    expect(approved.extensions.map((item) => item.path)).toEqual([
      '<inline:second>',
      '<inline:first>',
    ]);
    const hook = loaded[loaded.length - 1]!.handlers.get('before_agent_start')![0]!;
    const event = { systemPrompt: 'Approved context' };
    const result = await hook(event);
    expect(result).toEqual({
      systemPrompt: expect.stringMatching(/^Approved context\n\nHost time at prompt start/),
    });
    expect(result).toEqual({
      systemPrompt: expect.stringContaining('UTC time: 2026-09-26T06:46:00.000Z'),
    });
    expect(result).toEqual({ systemPrompt: expect.stringMatching(/\n\nRead first\.$/) });
    expect(event).toEqual({ systemPrompt: 'Approved context' });
  });

  it('refuses a partially loaded extension set', () => {
    const approved = resources([extension('valid')]);
    approved.errors.push({ path: 'failed', error: 'synthetic failure' });
    expect(() => new MollyResourceLoader({ ...defaults, extensions: approved })).toThrow(
      'harness_extension_load_failed'
    );
  });
});
