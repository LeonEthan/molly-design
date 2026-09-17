import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { withKimiImageToolTimeout } from './kimi-image-timeout';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(text?: string) {
  const root = await mkdtemp(path.join(tmpdir(), 'kimi-timeout-'));
  roots.push(root);
  const home = path.join(root, '.kimi-code');
  await mkdir(home);
  if (text !== undefined) await writeFile(path.join(home, 'config.toml'), text);
  return { root, home, env: { HOME: root, USERPROFILE: root } };
}
describe('Kimi public image timeout default', () => {
  it.each([undefined, 'default_model="synthetic"\n[mcp]\nstartup_timeout_ms=30000'])(
    'defaults only absent timeout (%s)',
    async (text) => {
      const f = await fixture(text);
      expect(await withKimiImageToolTimeout(f.env, f.root)).toMatchObject({
        KIMI_MCP_TOOL_TIMEOUT_MS: '210000',
      });
    }
  );
  it.each([
    '[mcp]\ntool_timeout_ms=45000',
    'mcp.tool_timeout_ms=240000',
    '["mcp"]\n"tool_timeout_ms"=90000',
    '[mcp]\ntool_timeout_ms="invalid"',
    'api_key="synthetic\n',
  ])('preserves explicit or malformed native config', async (text) => {
    const f = await fixture(text);
    expect(await withKimiImageToolTimeout(f.env, f.root)).toBe(f.env);
  });
  it('respects explicit environment and relative relocated profile', async () => {
    const f = await fixture('[mcp]\ntool_timeout_ms=45000');
    const explicit = { ...f.env, KIMI_MCP_TOOL_TIMEOUT_MS: '70000' };
    expect(await withKimiImageToolTimeout(explicit, f.root)).toBe(explicit);
    const relocated = { ...f.env, KIMI_CODE_HOME: '.kimi-code' };
    expect(await withKimiImageToolTimeout(relocated, f.root)).toBe(relocated);
  });
  it('does not override unreadable config', async () => {
    const f = await fixture();
    await mkdir(path.join(f.home, 'config.toml'));
    expect(await withKimiImageToolTimeout(f.env, f.root)).toBe(f.env);
  });
});
