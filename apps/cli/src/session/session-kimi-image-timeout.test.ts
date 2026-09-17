import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Session } from './session';
import { createNoopSessionSandbox } from './session-sandbox';
import type { SessionConfig } from './types';
import type { CreateAgentConfig } from './session-manager';
import type { Logger } from '../utils/logger';
vi.mock('@/agent/login-shell-env', () => ({
  getLoginShellEnv: async () => ({}),
  getCachedLoginShellEnvSync: () => ({}),
}));
const logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  success() {},
  setLevel() {},
  setDebug() {},
  child() {
    return this;
  },
  async close() {},
} satisfies Logger;
describe('Kimi actual Session launch environment', () => {
  it.each([
    { design: true, agent: 'kimi', text: '', explicit: undefined, expected: '210000' },
    {
      design: true,
      agent: 'kimi',
      text: '[mcp]\ntool_timeout_ms=45000',
      explicit: undefined,
      expected: undefined,
    },
    { design: true, agent: 'kimi', text: '', explicit: '70000', expected: '70000' },
    { design: false, agent: 'kimi', text: '', explicit: undefined, expected: undefined },
    { design: false, agent: 'codex', text: '', explicit: undefined, expected: undefined },
  ])(
    'constructs only the eligible default: $agent / $design / $expected',
    async ({ design, agent, text, explicit, expected }) => {
      const root = await mkdtemp(path.join(tmpdir(), 'kimi-session-'));
      vi.stubEnv('KIMI_MCP_TOOL_TIMEOUT_MS', undefined);
      try {
        const home = path.join(root, 'profile');
        await mkdir(home);
        await writeFile(path.join(home, 'config.toml'), text);
        const sandbox = createNoopSessionSandbox();
        let received: NodeJS.ProcessEnv | undefined;
        vi.spyOn(sandbox, 'spawn').mockImplementation(async (_command, _args, options) => {
          received = options.env;
          throw Error('synthetic spawn boundary');
        });
        const config = {
          sessionId: 'synthetic-session',
          agentCliType: 'builtin',
          agentType: agent,
          env: {
            KIMI_CODE_HOME: home,
            ...(explicit ? { KIMI_MCP_TOOL_TIMEOUT_MS: explicit } : {}),
          },
        } as SessionConfig;
        const session = new Session(config, logger, root, sandbox);
        await expect(
          session.createAgent({
            cliType: 'builtin',
            agentType: agent,
            designHooks: design,
            command: 'synthetic',
            args: [],
          } as CreateAgentConfig)
        ).rejects.toThrow('synthetic spawn boundary');
        expect(received?.KIMI_MCP_TOOL_TIMEOUT_MS).toBe(expected);
      } finally {
        vi.unstubAllEnvs();
        await rm(root, { recursive: true, force: true });
      }
    }
  );
});
