import { z } from 'zod';
import { HARNESS_IMAGE_MAX_ENCODED_BYTES } from '@molly/shared/embedded-harness';

// A 16 MiB encoded file needs slightly over 21 MiB when carried as base64.
const MAX_BYTES = HARNESS_IMAGE_MAX_ENCODED_BYTES + 64 * 1024;
const TextSchema = z.object({ type: z.literal('text'), text: z.string().max(4 * 1024 * 1024) });
const ImageSchema = z.object({
  type: z.literal('image'),
  data: z
    .string()
    .max(MAX_BYTES)
    .regex(/^[A-Za-z0-9+/]*={0,2}$/),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']),
});
const UriSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((uri) => {
    try {
      const parsed = new URL(uri);
      return (
        !/\s/.test(uri) &&
        !parsed.username &&
        !parsed.password &&
        !['file:', 'data:', 'javascript:', 'blob:'].includes(parsed.protocol)
      );
    } catch {
      return false;
    }
  });
const ResourceSchema = z.union([
  z.object({
    uri: UriSchema,
    text: z.string().max(4 * 1024 * 1024),
    mimeType: z.string().max(128).optional(),
  }),
  z.object({ uri: UriSchema, blob: ImageSchema.shape.data, mimeType: ImageSchema.shape.mimeType }),
]);
const ContentSchema = z
  .array(
    z.discriminatedUnion('type', [
      TextSchema,
      ImageSchema,
      z.object({ type: z.literal('resource'), resource: ResourceSchema }),
      z.object({ type: z.literal('resource_link'), uri: UriSchema, name: z.string().max(1024) }),
    ])
  )
  .max(64);
type ModelContent = z.infer<typeof TextSchema> | z.infer<typeof ImageSchema>;

/** Resource URIs are opaque MCP identities, never host filesystem or fetch targets. */
export async function resolveMcpContent(
  result: unknown,
  read: (uri: string, index: number) => Promise<unknown>
): Promise<ModelContent[]> {
  const parsed = z
    .object({ content: ContentSchema, isError: z.boolean().optional() })
    .safeParse(result);
  if (!parsed.success) throw new Error('harness_mcp_result_unsupported');
  if (parsed.data.isError) throw new Error('harness_mcp_tool_failed');
  const output: ModelContent[] = [];
  let totalBytes = 0;
  const append = (part: ModelContent) => {
    if (
      part.type === 'image' &&
      (!part.data || Buffer.from(part.data, 'base64').toString('base64') !== part.data)
    )
      throw new Error('harness_mcp_result_unsupported');
    totalBytes += Buffer.byteLength(part.type === 'text' ? part.text : part.data, 'utf8');
    if (output.length >= 64 || totalBytes > MAX_BYTES) throw new Error('harness_mcp_result_limit');
    output.push(part);
  };
  const appendResource = (resource: z.infer<typeof ResourceSchema>) => {
    append({
      type: 'text',
      text: `MCP resource: ${JSON.stringify({ uri: resource.uri, mimeType: resource.mimeType })}`,
    });
    append(
      'text' in resource
        ? { type: 'text', text: resource.text }
        : { type: 'image', data: resource.blob, mimeType: resource.mimeType }
    );
  };
  // Check the complete inline payload before authorizing any additional server reads.
  for (const part of parsed.data.content) {
    if (part.type === 'text' || part.type === 'image') append(part);
    else if (part.type === 'resource') appendResource(part.resource);
  }
  output.length = 0;
  totalBytes = 0;
  const resolved = new Map<string, z.infer<typeof ResourceSchema>[]>();
  for (const [index, part] of parsed.data.content.entries()) {
    if (part.type === 'text' || part.type === 'image') append(part);
    else if (part.type === 'resource') appendResource(part.resource);
    else {
      let contents = resolved.get(part.uri);
      if (!contents) {
        const resourceResult = z
          .object({ contents: z.array(ResourceSchema).min(1).max(16) })
          .safeParse(await read(part.uri, index));
        if (
          !resourceResult.success ||
          resourceResult.data.contents.some((resource) => resource.uri !== part.uri)
        )
          throw new Error('harness_mcp_resource_mismatch');
        contents = resourceResult.data.contents;
        resolved.set(part.uri, contents);
      }
      for (const resource of contents) appendResource(resource);
    }
  }
  return output;
}
