import { z } from 'zod';

export function systemPromptText(context: {
  messages: readonly unknown[];
  systemPrompt?: string;
}): string {
  const system = z.object({
    role: z.literal('system'),
    content: z.union([
      z.string(),
      z.array(z.object({ type: z.literal('text'), text: z.string() })),
    ]),
  });
  const prompts = context.messages.flatMap((message) => {
    const parsed = system.safeParse(message);
    return parsed.success
      ? [
          typeof parsed.data.content === 'string'
            ? parsed.data.content
            : parsed.data.content.map((part) => part.text).join(''),
        ]
      : [];
  });
  return prompts.length ? prompts.join('\n') : (context.systemPrompt ?? '');
}
