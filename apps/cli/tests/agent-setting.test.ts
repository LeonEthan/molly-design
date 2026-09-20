import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { mergeLoginShellEnv, withDefaultAcpPathEntries } from '../src/agent/setting';

describe('withDefaultAcpPathEntries', () => {
  it('prepends user-local bin directories to PATH', () => {
    const result = withDefaultAcpPathEntries({ PATH: '/usr/bin' });

    expect(result.PATH?.split(delimiter)).toEqual([
      join(homedir(), '.local/bin'),
      join(homedir(), 'bin'),
      join(homedir(), '.claude/local'),
      '/usr/bin',
    ]);
  });

  it.each(['kimi', 'kimi-code'])('prepends the Kimi Code bin directory for %s', (agentType) => {
    const result = withDefaultAcpPathEntries({ PATH: '/usr/bin' }, agentType);

    expect(result.PATH?.split(delimiter)).toEqual([
      join(homedir(), '.kimi-code/bin'),
      join(homedir(), '.local/bin'),
      join(homedir(), 'bin'),
      join(homedir(), '.claude/local'),
      '/usr/bin',
    ]);
  });

  it('moves existing default entries to the front without duplicating them', () => {
    const localBin = join(homedir(), '.local/bin');
    const homeBin = join(homedir(), 'bin');
    const claudeLocal = join(homedir(), '.claude/local');
    const result = withDefaultAcpPathEntries({
      PATH: ['/usr/bin', `${localBin}/`, '/bin', homeBin, claudeLocal].join(delimiter),
    });

    expect(result.PATH?.split(delimiter)).toEqual([
      localBin,
      homeBin,
      claudeLocal,
      '/usr/bin',
      '/bin',
    ]);
  });
});

describe('mergeLoginShellEnv', () => {
  const splitPath = (value: string | undefined): string[] =>
    (value ?? '').split(delimiter).filter(Boolean);

  it('returns the base unchanged when the shell env is empty or missing', () => {
    const base = { PATH: '/usr/bin', HOME: '/home/u' };
    expect(mergeLoginShellEnv(base, null)).toBe(base);
    expect(mergeLoginShellEnv(base, undefined)).toBe(base);
    expect(mergeLoginShellEnv(base, {})).toBe(base);
  });

  it('prepends login-shell PATH entries so user-installed tools resolve first', () => {
    // A GUI-launched daemon inherits a minimal PATH; the login shell knows where
    // tools like opencode actually live (homebrew, cargo, ~/.local/bin, ...).
    const base = { PATH: '/usr/bin:/bin' };
    const shell = { PATH: '/opt/homebrew/bin:/home/u/.local/bin:/usr/bin' };

    expect(splitPath(mergeLoginShellEnv(base, shell).PATH)).toEqual([
      '/opt/homebrew/bin',
      '/home/u/.local/bin',
      '/usr/bin',
      '/bin',
    ]);
  });

  it('keeps base-only PATH entries (e.g. runtime-injected node_modules/.bin)', () => {
    const base = { PATH: '/proj/node_modules/.bin:/usr/bin' };
    const shell = { PATH: '/home/u/.local/bin:/usr/bin' };

    expect(splitPath(mergeLoginShellEnv(base, shell).PATH)).toEqual([
      '/home/u/.local/bin',
      '/usr/bin',
      '/proj/node_modules/.bin',
    ]);
  });

  it('dedupes PATH entries that differ only by trailing slash', () => {
    const base = { PATH: '/usr/bin/' };
    const shell = { PATH: '/usr/bin' };

    expect(splitPath(mergeLoginShellEnv(base, shell).PATH)).toEqual(['/usr/bin']);
  });

  it('lets base win for non-PATH vars but fills in vars only the shell has', () => {
    const base = { PATH: '/usr/bin', CODEX_HOME: '/work/.codex', MOLLY_E2E: '1' };
    const shell = { PATH: '/usr/bin', CODEX_HOME: '/home/u/.codex', LANG: 'en_US.UTF-8' };

    const merged = mergeLoginShellEnv(base, shell);

    // base-injected values are preserved...
    expect(merged.CODEX_HOME).toBe('/work/.codex');
    expect(merged.MOLLY_E2E).toBe('1');
    // ...while vars only the login shell defines are added.
    expect(merged.LANG).toBe('en_US.UTF-8');
  });
});
