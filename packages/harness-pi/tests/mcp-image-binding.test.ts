import { describe, expect, it } from 'vitest';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { McpImageBindingSchema } from '@molly/shared/embedded-harness';
import { defineMcpTools } from '../src/mcp-bridge';
import { bindMcpImageTool } from '../src/mcp-image-binding';

const binding = McpImageBindingSchema.parse({
  version: 1,
  model: 'synthetic-image',
  generate: { tool: 'draw', fields: { prompt: 'text', model: 'model_id', size: 'dimensions' } },
  edit: {
    tool: 'edit',
    fields: { prompt: 'text', model: 'model_id', images: 'refs', mask: 'mask_ref' },
  },
});
const draw: Tool = {
  name: 'draw',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', minLength: 2 },
      model_id: { type: 'string', enum: ['synthetic-image'] },
      dimensions: { type: 'string' },
    },
    required: ['text', 'model_id'],
    additionalProperties: false,
  },
};
const edit: Tool = {
  name: 'edit',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string' },
      model_id: { type: 'string' },
      refs: { type: 'array', items: { type: 'string' } },
      mask_ref: { type: 'string' },
    },
    required: ['text', 'model_id', 'refs'],
    additionalProperties: false,
  },
};
describe('MCP image field mapping', () => {
  it('pins the image model and preserves image order and mask without fetching references', () => {
    const generate = bindMcpImageTool(draw, binding);
    const editing = bindMcpImageTool(edit, binding);
    expect(generate.status).toBe('bound');
    expect(editing.status).toBe('bound');
    if (generate.status !== 'bound' || editing.status !== 'bound') throw new Error('not bound');
    expect(generate.map({ prompt: 'Synthetic', size: '1024x1024' })).toEqual({
      text: 'Synthetic',
      model_id: 'synthetic-image',
      dimensions: '1024x1024',
    });
    expect(
      editing.map({ prompt: 'Synthetic', images: ['image:b', 'image:a'], mask: 'mask:a' })
    ).toEqual({
      text: 'Synthetic',
      model_id: 'synthetic-image',
      refs: ['image:b', 'image:a'],
      mask_ref: 'mask:a',
    });
    expect(generate.parameters.properties).not.toHaveProperty('model');
  });
  it.each([
    { prompt: 'Synthetic', model: 'unapproved-model' },
    { prompt: 'x' },
    { prompt: 42 },
    { prompt: 'Synthetic', images: ['extra'] },
  ])('refuses overrides, coercion and upstream-invalid arguments %#', (args) => {
    const mapped = bindMcpImageTool(draw, binding);
    if (mapped.status !== 'bound') throw new Error('not bound');
    expect(() => mapped.map(args)).toThrow(/^harness_mcp_image_arguments_invalid$/);
  });
  it('reports unsupported binding schemas, leaving unrelated tools ordinary', () => {
    expect(bindMcpImageTool({ ...draw, name: 'ordinary' }, binding).status).toBe('ordinary');
    expect(bindMcpImageTool(draw, { ...binding, model: 'not-advertised' }).status).toBe(
      'unavailable'
    );
    expect(
      bindMcpImageTool(
        { ...draw, inputSchema: { ...draw.inputSchema, required: ['other'] } },
        binding
      ).status
    ).toBe('unavailable');
    expect(
      bindMcpImageTool({ ...draw, inputSchema: { type: 'object', properties: {} } }, binding).status
    ).toBe('unavailable');
  });
  it('shows the exact mapped arguments at approval and dispatch, with no mutation after approval', async () => {
    const events: unknown[] = [];
    const input: Parameters<typeof defineMcpTools>[0] = {
      serverName: 'images',
      imageBinding: structuredClone(binding),
      client: {
        listTools: async () => ({ tools: [draw] }),
        callTool: async (args) => {
          events.push(['call', args]);
          return { content: [{ type: 'text', text: 'Synthetic' }] };
        },
        close: async () => {},
        getServerCapabilities: () => ({}),
        readResource: async () => {
          throw new Error('not used');
        },
      },
      approve: async (request) => {
        events.push(['approve', structuredClone(request.arguments)]);
        (request.arguments as Record<string, unknown>).model_id = 'mutated';
        input.imageBinding!.model = 'also-mutated';
        return true;
      },
      isAvailable: () => true,
      dispatch: async (_server, _id, _name, args, invoke) => {
        events.push(['dispatch', structuredClone(args)]);
        return invoke();
      },
    };
    const [tool] = await defineMcpTools(input);
    const result = await tool!.execute('call', { prompt: 'Synthetic' }, undefined);
    const args = { text: 'Synthetic', model_id: 'synthetic-image' };
    expect(events).toEqual([
      ['approve', args],
      ['dispatch', args],
      ['call', { name: 'draw', arguments: args }],
    ]);
    expect(result.details.imageBinding).toBe('bound');
    expect(tool!.description).toContain('asset import is not ready');
  });
});
