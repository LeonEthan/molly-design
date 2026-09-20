import { describe, expect, it } from 'vitest';
import { McpImageBindingSchema } from '../src/mcp-image-binding';
import { isWorkspaceMcpServerMeta } from '../src/workspace-mcp';

const binding = {
  version: 1,
  model: 'synthetic-image-model',
  generate: { tool: 'draw', fields: { prompt: 'text', model: 'model_id' } },
};
describe('public MCP image binding', () => {
  it('accepts explicit generate/edit mappings without a separate catalog', () => {
    expect(McpImageBindingSchema.parse(binding)).toEqual(binding);
    expect(
      isWorkspaceMcpServerMeta({
        id: 'server',
        name: 'Synthetic',
        transport: 'stdio',
        createdAt: 1,
        updatedAt: 1,
        imageBinding: binding,
      })
    ).toBe(true);
    expect(
      McpImageBindingSchema.safeParse({
        ...binding,
        edit: {
          tool: 'edit',
          fields: { prompt: 'text', model: 'model_id', images: 'refs', mask: 'mask' },
        },
      }).success
    ).toBe(true);
  });
  it.each([
    { ...binding, model: '' },
    { ...binding, model: ' model ' },
    { ...binding, version: 2 },
    { version: 1, model: 'model' },
    { ...binding, apiKey: 'SYNTHETIC' },
    { ...binding, generate: { tool: 'draw', fields: { prompt: 'same', model: 'same' } } },
    { ...binding, generate: { tool: 'draw', fields: { prompt: '__proto__', model: 'model' } } },
    { ...binding, generate: { tool: 'draw', fields: { prompt: 'nested.prompt', model: 'model' } } },
    { ...binding, edit: { tool: 'draw', fields: { prompt: 'p', model: 'm', images: 'i' } } },
    { ...binding, edit: { tool: 'edit', fields: { prompt: 'p', model: 'm' } } },
  ])('rejects malformed, ambiguous or secret-bearing configuration %#', (invalid) => {
    expect(McpImageBindingSchema.safeParse(invalid).success).toBe(false);
    expect(
      isWorkspaceMcpServerMeta({
        id: 'server',
        name: 'Synthetic',
        transport: 'stdio',
        createdAt: 1,
        updatedAt: 1,
        imageBinding: invalid,
      })
    ).toBe(false);
  });
});
