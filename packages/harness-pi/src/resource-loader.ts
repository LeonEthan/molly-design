import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  DefaultResourceLoader,
  SettingsManager,
  type LoadExtensionsResult,
  type Skill,
  type Extension,
  type ExtensionFactory,
} from '@earendil-works/pi-coding-agent';

export type HostTimeSource = {
  now: () => Date;
  resolveTimeZone: () => string;
};

function hostTimeContext(source?: HostTimeSource): string {
  const instant = source?.now() ?? new Date();
  const timeZone = source?.resolveTimeZone() ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      calendar: 'gregory',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(instant)
      .map(({ type, value }) => [type, value])
  );
  return [
    'Host time at prompt start (from the host clock):',
    `UTC time: ${instant.toISOString()}`,
    `Local date and time: ${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`,
    `IANA time zone: ${timeZone}`,
    'Use this clock to interpret relative time. A task or event may specify a different date.',
    'Geographic location: not provided by the host; use location explicitly supplied by the user. Do not infer location from the host time zone.',
  ].join('\n');
}

const nativeToolNames = ['read', 'write', 'edit', 'bash', 'powershell', 'grep', 'find', 'ls'];

export function validateTools(extensions: Extension[], hostToolNames: readonly string[]) {
  if (new Set(hostToolNames).size !== hostToolNames.length) {
    throw new Error('harness_duplicate_host_tool');
  }
  const names = new Set([...nativeToolNames, ...hostToolNames]);
  for (const extension of extensions) {
    for (const [name, tool] of extension.tools) {
      if (name !== tool.definition.name) throw new Error('harness_extension_tool_identity');
      if (names.has(name)) {
        throw new Error('harness_extension_tool_collision');
      }
      names.add(name);
    }
  }
}

export class MollyResourceLoader extends DefaultResourceLoader {
  constructor(input: {
    cwd: string;
    privateRoot: string;
    systemPrompt: string;
    skills?: Skill[];
    extensions?: LoadExtensionsResult;
    extensionFactories?: ExtensionFactory[];
    hostToolNames?: readonly string[];
    readBeforeEditReminder?: string;
    hostTime?: HostTimeSource;
    personalMemoryContext?: () => string;
    settings: SettingsManager;
  }) {
    if (input.extensions?.errors.length) throw new Error('harness_extension_load_failed');
    validateTools(input.extensions?.extensions ?? [], input.hostToolNames ?? []);
    const promptContext: ExtensionFactory = (pi) => {
      pi.on('before_agent_start', async (event) => ({
        systemPrompt: [
          event.systemPrompt,
          hostTimeContext(input.hostTime),
          input.readBeforeEditReminder,
          input.personalMemoryContext?.(),
        ]
          .filter(Boolean)
          .join('\n\n'),
      }));
    };
    super({
      cwd: input.cwd,
      agentDir: join(input.privateRoot, 'config'),
      settingsManager: input.settings,
      noExtensions: true,
      additionalExtensionPaths: [
        fileURLToPath(new URL('../extensions/mcp-loader.ts', import.meta.url)),
      ],
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt: input.systemPrompt,
      appendSystemPrompt: [],
      systemPromptOverride: () => input.systemPrompt,
      skillsOverride: () => ({ skills: input.skills ?? [], diagnostics: [] }),
      extensionFactories: [...(input.extensionFactories ?? []), promptContext],
      extensionsOverride: (loaded) => {
        const result = input.extensions
          ? { ...loaded, extensions: [...input.extensions.extensions, ...loaded.extensions] }
          : loaded;
        if (result.errors.length) throw new Error('harness_extension_load_failed');
        validateTools(result.extensions, input.hostToolNames ?? []);
        return result;
      },
    });
  }
}
