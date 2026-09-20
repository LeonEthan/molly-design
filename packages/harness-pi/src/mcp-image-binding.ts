import { Type, validateToolArguments } from '@earendil-works/pi-ai';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { McpImageBinding } from '@molly/shared/embedded-harness';
import { z } from 'zod';

/** A deliberately small adapter: top-level string fields and ordered string image references. */
export function bindMcpImageTool(tool: Tool, binding: McpImageBinding | undefined) {
  const operation =
    binding?.generate?.tool === tool.name
      ? 'generate'
      : binding?.edit?.tool === tool.name
        ? 'edit'
        : undefined;
  if (!binding || !operation) return { status: 'ordinary' as const };
  const config = operation === 'generate' ? binding.generate! : binding.edit!;
  const fields = Object.entries(config.fields).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string'
  );
  const properties = tool.inputSchema.properties ?? {};
  const supported =
    fields.every(([source, target]) => {
      const schema = properties[target];
      if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return false;
      if (source !== 'images') return 'type' in schema && schema.type === 'string';
      return (
        'type' in schema &&
        schema.type === 'array' &&
        'items' in schema &&
        schema.items !== null &&
        typeof schema.items === 'object' &&
        'type' in schema.items &&
        schema.items.type === 'string'
      );
    }) &&
    (tool.inputSchema.required ?? []).every((name) => fields.some(([, target]) => target === name));
  const unavailable = { status: 'unavailable' as const };
  if (!supported) return unavailable;
  // Reject a configured model outside an advertised enum/pattern before offering the binding.
  try {
    validateToolArguments(
      {
        name: tool.name,
        description: '',
        parameters: Type.Unsafe({
          type: 'object',
          properties: { [config.fields.model]: properties[config.fields.model] },
          required: [config.fields.model],
          additionalProperties: false,
        }),
      },
      {
        type: 'toolCall',
        id: 'image-binding-model',
        name: tool.name,
        arguments: { [config.fields.model]: binding.model },
      }
    );
  } catch {
    return unavailable;
  }

  const optional = (name: string) => fields.some(([source]) => source === name);
  const parameters = Type.Object(
    {
      prompt: Type.String({ minLength: 1, maxLength: 16_384 }),
      ...(optional('size')
        ? { size: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })) }
        : {}),
      ...(operation === 'edit'
        ? {
            images: Type.Array(Type.String({ minLength: 1, maxLength: 8192 }), {
              minItems: 1,
              maxItems: 16,
            }),
            ...(optional('mask')
              ? { mask: Type.Optional(Type.String({ minLength: 1, maxLength: 8192 })) }
              : {}),
          }
        : {}),
    },
    { additionalProperties: false }
  );
  return {
    status: 'bound' as const,
    operation,
    model: binding.model,
    parameters,
    map(raw: unknown): Record<string, unknown> {
      try {
        const args = z.record(z.string(), z.unknown()).parse(raw);
        const checked: unknown = validateToolArguments(
          { name: tool.name, description: '', parameters },
          { type: 'toolCall', id: 'image-binding-input', name: tool.name, arguments: args }
        );
        // Validation may coerce values; this boundary never silently changes caller semantics.
        if (JSON.stringify(checked) !== JSON.stringify(args)) throw new Error();
        const mapped = Object.fromEntries(
          fields.flatMap(([source, target]) =>
            source === 'model'
              ? [[target, binding.model]]
              : Object.hasOwn(args, source)
                ? [[target, args[source]]]
                : []
          )
        );
        const validated: unknown = validateToolArguments(
          { name: tool.name, description: '', parameters: Type.Unsafe(tool.inputSchema) },
          {
            type: 'toolCall',
            id: 'image-binding-native',
            name: tool.name,
            arguments: mapped,
          }
        );
        if (JSON.stringify(validated) !== JSON.stringify(mapped)) throw new Error();
        return mapped;
      } catch {
        // SDK validation errors contain raw arguments. Never expose them to native history.
        throw new Error('harness_mcp_image_arguments_invalid');
      }
    },
  };
}
