import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import { z } from 'zod';

export const HOST_SYSTEM_PROMPT_ENTRY = 'molly_host_system_prompt';

export type ToolsetFingerprint = { toolsetHash: string; pluginSetHash: string };

const HostSystemPromptSchema = z.union([
  z.object({ version: z.literal(1), systemPrompt: z.string() }),
  z.object({
    version: z.literal(2),
    systemPrompt: z.string(),
    toolsetHash: z.string().regex(/^[a-f0-9]{64}$/),
    pluginSetHash: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  z.object({ version: z.number().int().gt(2), systemPrompt: z.string() }),
]);

export function hostSystemPromptEntry(
  systemPrompt: string,
  { toolsetHash, pluginSetHash }: ToolsetFingerprint
) {
  return { version: 2 as const, systemPrompt, toolsetHash, pluginSetHash };
}

/**
 * Every saved entry must validate; the latest one decides. A v1 entry or a different
 * toolset returns undefined so the caller rebuilds and appends a fresh entry (#157).
 */
export function savedHostSystemPrompt(
  entries: readonly SessionEntry[],
  current: ToolsetFingerprint
): string | undefined {
  let latest: z.infer<typeof HostSystemPromptSchema> | undefined;
  for (const entry of entries) {
    if (entry.type !== 'custom' || entry.customType !== HOST_SYSTEM_PROMPT_ENTRY) continue;
    const parsed = HostSystemPromptSchema.safeParse(entry.data);
    if (!parsed.success) throw new Error('pi_acp_host_invalid_system_prompt_snapshot');
    latest = parsed.data;
  }
  if (
    latest?.version === 2 &&
    'toolsetHash' in latest &&
    'pluginSetHash' in latest &&
    latest.toolsetHash === current.toolsetHash &&
    latest.pluginSetHash === current.pluginSetHash
  )
    return latest.systemPrompt;
  return undefined;
}
