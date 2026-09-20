import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { describeToolCall } from '../src/tool-presentation';

describe('native tool ACP presentation', () => {
  it('shows the exact bash command in the permission title without rewriting arguments', () => {
    const args = { command: 'printf "synthetic\\n"\nls .scratch', timeout: 5 };
    expect(describeToolCall('bash', args, '/synthetic/work')).toEqual({
      title: `bash: ${args.command}`,
      kind: 'execute',
      rawInput: args,
    });
  });
  it.each(['read', 'write', 'edit'])(
    'identifies %s target without rewriting execution arguments',
    (name) => {
      const args = { path: 'draft/design.yaml', content: 'synthetic' };
      expect(describeToolCall(name, args, '/synthetic/work')).toEqual({
        title: `${name} draft/design.yaml`,
        kind: name === 'read' ? 'read' : 'edit',
        locations: [{ path: resolve('/synthetic/work', 'draft/design.yaml') }],
        rawInput: args,
      });
    }
  );
  it('keeps external and tilde paths visible without inventing SDK home resolution', () => {
    expect(
      describeToolCall('read', { path: '/synthetic/outside/file' }, '/synthetic/work')
    ).toMatchObject({
      title: 'read /synthetic/outside/file',
      locations: [{ path: '/synthetic/outside/file' }],
    });
    expect(describeToolCall('read', { path: '~/file' }, '/synthetic/work')).toMatchObject({
      title: 'read ~/file',
      locations: undefined,
    });
  });
  it('does not interpret MCP tool path arguments as local file capabilities', () => {
    const args = { path: '/synthetic/remote' };
    expect(describeToolCall('mcp_server_read', args, '/synthetic/work')).toEqual({
      title: 'mcp_server_read',
      kind: 'other',
      rawInput: args,
    });
    expect(describeToolCall('bash', { command: 'synthetic' }, '/synthetic/work').kind).toBe(
      'execute'
    );
  });
});
