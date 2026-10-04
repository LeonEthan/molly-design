import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { isImageConnectionReady, type ImageHttpTransport } from '@molly/shared';
import { fetchImageHttpTransport } from '@/design/image-connection';
import {
  DASHSCOPE_EDIT_MAX_INPUTS,
  IMAGE_BACKGROUNDS,
  IMAGE_EDIT_MAX_INPUTS,
  IMAGE_OUTPUT_FORMATS,
  describeImageFailure,
  editImageAsset,
  generateImageAsset,
} from '@/mcp/image-generation';
import { EMPTY_DESIGN_GATE, resolveDesignGate, type McpDesignGate } from '@/mcp/design-tools';
import { getMcpSessionContext } from '@/mcp/molly-mcp-server';
import { MOLLY_IMAGE_MCP_SERVER_NAME } from '@/mcp/molly-mcp-http-protocol';

/**
 * The `molly_image` MCP server: generate and edit raster assets with the user's image connection.
 * Billing and protocol mechanics live in the server instructions, which Pi serves through
 * `describeNamespace()`; scene knowledge stays in the `imagegen` skill.
 */
export const GENERATE_IMAGE_TOOL_NAME = 'generate';
export const EDIT_IMAGE_TOOL_NAME = 'edit';
const DESIGN_IMAGE_PROMPT_MAX_CHARS = 8_000;
const DESIGN_IMAGE_SIZE_SPEC_MAX_CHARS = 32;

const GenerateImageToolInputSchema = z
  .object({
    prompt: z
      .string()
      .trim()
      .min(1)
      .max(DESIGN_IMAGE_PROMPT_MAX_CHARS)
      .describe(
        'The generation prompt. Describe the asset you need (subject, style, composition, lighting, and any constraints or text to render).'
      ),
    size: z
      .string()
      .trim()
      .min(1)
      .max(DESIGN_IMAGE_SIZE_SPEC_MAX_CHARS)
      .optional()
      .describe(
        'Optional output size as WIDTHxHEIGHT pixels, for example "1024x1024". Omit to use the provider default.'
      ),
    background: z
      .enum(IMAGE_BACKGROUNDS)
      .optional()
      .describe(
        'Optional background. "transparent" gives a standalone layer with real alpha and needs PNG output. The server instructions list whether the current connection accepts it.'
      ),
    output_format: z
      .enum(IMAGE_OUTPUT_FORMATS)
      .optional()
      .describe(
        'Optional output format: "png" (supports transparency) or "jpeg". The server instructions list whether the current connection accepts it.'
      ),
  })
  .strict();
type GenerateImageToolInput = z.infer<typeof GenerateImageToolInputSchema>;

const EditImageToolInputSchema = GenerateImageToolInputSchema.extend({
  images: z
    .array(z.string().trim().min(1).max(4096))
    .min(1)
    .max(IMAGE_EDIT_MAX_INPUTS)
    .describe(
      'Source/reference image paths in prompt order. Relative paths resolve from the design authoring directory; use absolute paths for attachments elsewhere in the Session workspace.'
    ),
  mask: z
    .string()
    .trim()
    .min(1)
    .max(4096)
    .optional()
    .describe(
      'Optional PNG mask for the first image; transparent areas mark the edit. It must match the first image dimensions.'
    ),
}).strict();
type EditImageToolInput = z.infer<typeof EditImageToolInputSchema>;

const ImageAssetResultSchema = z.object({
  path: z
    .string()
    .describe('Artwork-relative asset path under media/; reference it from design.yaml.'),
  absolutePath: z.string(),
  sha256: z.string(),
  mimeType: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  bytes: z.number().int(),
});

const PAID_CALL_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;

function imageInstructions(gate: McpDesignGate): string {
  if (!gate.imageAvailable && !isImageConnectionReady(gate.imageConnection))
    return 'Image generation is unavailable in this session: it is not a design session, or the image connection is not configured, enabled and complete in Molly settings. Tell the user to enable it there; do not retry, and never ask for an API key in chat. Other ways to read or render images are unaffected.';
  const options =
    gate.imageProtocol === 'dashscope'
      ? `This connection uses DashScope: it accepts prompt, size and up to ${DASHSCOPE_EDIT_MAX_INPUTS} edit images, returns PNG, and refuses background, output_format and mask before sending any request (describe the region to edit in the prompt instead).`
      : `This connection uses OpenAI Images: it accepts prompt, size, background, output_format, up to ${IMAGE_EDIT_MAX_INPUTS} edit images and a PNG mask; a transparent background needs output_format png.`;
  return [
    'Generate or edit one raster asset per call with the image connection and model the user configured in Molly settings. There is no fallback model, provider or generation mode.',
    options,
    "Each call is a paid request on the user's own account and is never retried automatically. A timeout or cancellation after dispatch may still have been billed: tell the user before calling again.",
    'Results are new files under media/ in the design authoring directory, returned as structured { path, absolutePath, sha256, mimeType, width, height, bytes }. Reference `path` from design.yaml; they never replace or commit the current artwork. Judge outputs with an image-reading tool.',
  ].join('\n\n');
}

export type MollyImageMcpServerConfig = {
  /** Snapshot of the daemon's design gate; absent means no image capability. */
  designGate?: McpDesignGate;
  /** Live re-check immediately before each paid call, so revoked consent is never spent. */
  resolveGate?: () => Promise<McpDesignGate>;
  /** Test seam: image transport. Production uses the shared fetch transport. */
  imageTransport?: ImageHttpTransport;
};

export function buildMollyImageMcpServer(config: MollyImageMcpServerConfig = {}): McpServer {
  const snapshot = config.designGate ?? EMPTY_DESIGN_GATE;
  const server = new McpServer(
    { name: MOLLY_IMAGE_MCP_SERVER_NAME, version: '0.1.0' },
    { instructions: imageInstructions(snapshot) }
  );

  const run = async (
    args: GenerateImageToolInput | EditImageToolInput,
    { signal }: { signal: AbortSignal }
  ) => {
    let dispatched = false;
    let rejected = false;
    try {
      signal.throwIfAborted();
      const gate = config.resolveGate ? await config.resolveGate() : snapshot;
      const connection = gate.imageConnection;
      signal.throwIfAborted();
      if (connection === null)
        return failure(
          'Image generation is unavailable: this is not a design session, or the image connection is not configured, is disabled, or is missing its URL, API key or explicit model. Tell the user to enable it in Molly settings; do not retry.'
        );
      if (!gate.artworkWorkdir || !gate.workspaceRoot)
        return failure('Design workspace is unavailable; no image request was sent.');
      const common = {
        settings: connection,
        prompt: args.prompt,
        ...(args.size === undefined ? {} : { size: args.size }),
        ...(args.background === undefined ? {} : { background: args.background }),
        ...(args.output_format === undefined ? {} : { outputFormat: args.output_format }),
        workdir: gate.artworkWorkdir,
        transport: (async (request) => {
          if (request.method === 'POST') dispatched = true;
          const response = await (config.imageTransport ?? fetchImageHttpTransport)(request);
          if (request.method === 'POST' && (response.status < 200 || response.status >= 300))
            rejected = true;
          return response;
        }) satisfies ImageHttpTransport,
        signal,
      };
      const asset = await ('images' in args
        ? editImageAsset({
            ...common,
            sourceWorkdir: gate.workspaceRoot,
            images: args.images,
            ...(args.mask === undefined ? {} : { mask: args.mask }),
          })
        : generateImageAsset(common));
      const structuredContent = {
        path: asset.path,
        absolutePath: asset.absolutePath,
        sha256: asset.sha256,
        mimeType: asset.mimeType,
        width: asset.width,
        height: asset.height,
        bytes: asset.bytes,
      };
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(structuredContent, null, 2) }],
        structuredContent,
      };
    } catch (error) {
      return failure(
        describeImageFailure(
          error instanceof Error ? error.message : `Image generation failed: ${String(error)}`,
          { dispatched, rejected }
        )
      );
    }
  };

  const generate = server.registerTool(
    GENERATE_IMAGE_TOOL_NAME,
    {
      title: 'Generate an image',
      description:
        'Generate one raster asset (product shot, concept art, cover, illustration) into the design media/ directory. Paid; see the server instructions.',
      inputSchema: GenerateImageToolInputSchema,
      outputSchema: ImageAssetResultSchema,
      annotations: PAID_CALL_ANNOTATIONS,
    },
    run
  );
  const edit = server.registerTool(
    EDIT_IMAGE_TOOL_NAME,
    {
      title: 'Edit images',
      description:
        "Edit or combine source/reference images with a prompt (and optional mask for the first image) into a new media/ asset. Sends the actual files to the user's image service. Paid; see the server instructions.",
      inputSchema: EditImageToolInputSchema,
      outputSchema: ImageAssetResultSchema,
      annotations: PAID_CALL_ANNOTATIONS,
    },
    run
  );
  if (!snapshot.imageAvailable && !isImageConnectionReady(snapshot.imageConnection)) {
    generate.disable();
    edit.disable();
  }
  return server;
}

const failure = (text: string) => ({
  content: [{ type: 'text' as const, text }],
  isError: true,
});

export async function runMollyImageMcpServer(): Promise<void> {
  const context = getMcpSessionContext();
  await buildMollyImageMcpServer({
    designGate: await resolveDesignGate(context),
    resolveGate: async () => await resolveDesignGate(context, undefined, true),
  }).connect(new StdioServerTransport());
}
