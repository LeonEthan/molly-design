import {
  createExtensionRuntime,
  type LoadExtensionsResult,
  type ResourceLoader,
  type Skill,
  type Extension,
} from '@earendil-works/pi-coding-agent';
import { z } from 'zod';

// Reserve the pinned SDK's native names even when a turn does not expose them.
const nativeToolNames = ['read', 'write', 'edit', 'bash', 'powershell', 'grep', 'find', 'ls'];

function validateTools(extensions: Extension[], hostToolNames: readonly string[]) {
  if (new Set(hostToolNames).size !== hostToolNames.length) {
    throw new Error('harness_duplicate_host_tool');
  }
  const names = new Set([...nativeToolNames, ...hostToolNames]);
  for (const extension of extensions) {
    // Native commands may start inference or mutate session configuration outside
    // prompt execution. None has an approved host-state mapping yet.
    if (extension.commands.size > 0) throw new Error('harness_extension_command_unmapped');
    for (const [name, tool] of extension.tools) {
      if (name !== tool.definition.name) throw new Error('harness_extension_tool_identity');
      if (names.has(name) || name.startsWith('mcp_') || name.startsWith('molly_')) {
        throw new Error('harness_extension_tool_collision');
      }
      names.add(name);
    }
  }
}

/** No default loader is constructed: even discovery can execute package code. */
export class MollyResourceLoader implements ResourceLoader {
  private readonly extensions: LoadExtensionsResult;

  constructor(
    private readonly input: {
      systemPrompt?: string;
      skills?: Skill[];
      contextFiles?: Array<{ path: string; content: string }>;
      extensions?: LoadExtensionsResult;
      hostToolNames?: readonly string[];
      readBeforeEditReminder?: string;
    }
  ) {
    this.extensions = input.extensions ?? {
      extensions: [],
      errors: [],
      runtime: createExtensionRuntime(),
    };
    if (this.extensions.errors.length > 0) throw new Error('harness_extension_load_failed');
    validateTools(this.extensions.extensions, input.hostToolNames ?? []);
    // Preserve the host-approved hook order; the reminder is appended below.
    this.extensions = { ...this.extensions, extensions: [...this.extensions.extensions] };
    if (input.readBeforeEditReminder) {
      const path = '<molly-read-before-edit-v1>';
      const reminder: Extension = {
        path,
        resolvedPath: path,
        sourceInfo: { path, source: 'molly-bundled', scope: 'temporary', origin: 'package' },
        handlers: new Map([
          [
            'before_agent_start',
            [
              async (event: unknown) => ({
                systemPrompt: `${z.object({ systemPrompt: z.string() }).parse(event).systemPrompt}\n\n${input.readBeforeEditReminder}`,
              }),
            ],
          ],
        ]),
        tools: new Map(),
        commands: new Map(),
        flags: new Map(),
        shortcuts: new Map(),
        messageRenderers: new Map(),
      };
      this.extensions = {
        ...this.extensions,
        extensions: [...this.extensions.extensions, reminder],
      };
    }
  }

  getExtensions() {
    return this.extensions;
  }
  getSkills() {
    return { skills: this.input.skills ?? [], diagnostics: [] };
  }
  getPrompts() {
    return { prompts: [], diagnostics: [] };
  }
  getThemes() {
    return { themes: [], diagnostics: [] };
  }
  getAgentsFiles() {
    return { agentsFiles: this.input.contextFiles ?? [] };
  }
  getSystemPrompt() {
    return this.input.systemPrompt;
  }
  getSystemPromptSource() {
    return undefined;
  }
  getAppendSystemPrompt() {
    return [];
  }
  getAppendSystemPromptSources() {
    return [];
  }
  extendResources(): void {
    throw new Error('harness_resource_set_is_frozen');
  }
  async reload(): Promise<void> {
    /* Resource changes require a new owned worker. */
  }
}
