import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { parse } from 'smol-toml';

/** Default only the public native setting; explicit or unreadable user config wins. */
export async function withKimiImageToolTimeout(
  env: NodeJS.ProcessEnv,
  workdir: string
): Promise<NodeJS.ProcessEnv> {
  if (env.KIMI_MCP_TOOL_TIMEOUT_MS !== undefined) return env;
  const userHome = (process.platform === 'win32' ? env.USERPROFILE : env.HOME) ?? homedir();
  const kimiHome = env.KIMI_CODE_HOME ?? path.join(userHome, '.kimi-code');
  let text: string;
  try {
    text = await readFile(path.resolve(workdir, kimiHome, 'config.toml'), 'utf8');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) return env;
    return { ...env, KIMI_MCP_TOOL_TIMEOUT_MS: '210000' };
  }
  try {
    const config = parse(text);
    const mcp = config.mcp;
    if (mcp !== undefined) {
      if (typeof mcp !== 'object' || mcp === null || Array.isArray(mcp)) return env;
      if ('tool_timeout_ms' in mcp) return env;
    }
  } catch {
    // TOML errors can include credential-bearing source lines. Never log or wrap them.
    return env;
  }
  return { ...env, KIMI_MCP_TOOL_TIMEOUT_MS: '210000' };
}
