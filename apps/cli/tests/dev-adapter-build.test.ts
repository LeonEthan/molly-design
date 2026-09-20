import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Core protocol contracts resolve to
 * generated workspace exports. Prepare those contracts without building retired
 * executable adapters; the embedded harness has its own sealed build.
 *
 * The invariant is the ORDER, not the exact command line: preparation has to happen
 * before anything that bundles or launches the CLI.
 */
const readCliScripts = (): Record<string, string> => {
  const packageJson = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8')
  ) as { scripts?: Record<string, string> };
  return packageJson.scripts ?? {};
};

const PREPARE_STEP = 'pnpm run prepare:acp-adapters';

/** Every script that bundles or launches the development CLI. */
const DEV_ENTRY_SCRIPTS = ['dev'];

/** Anything that reads adapter `dist/`, either by bundling it or by running the CLI. */
const CLI_LAUNCH_PATTERN = /\bnode\b[^&]*\b(dev-build\.mjs|dist-dev\/index\.js)/;

describe('CLI development contract preparation', () => {
  it('exposes the dev entry points this repo documents', () => {
    const scripts = readCliScripts();
    for (const name of DEV_ENTRY_SCRIPTS) {
      expect(scripts[name], `missing "${name}" script`).toBeTypeOf('string');
    }
    expect(scripts).not.toHaveProperty('dev:jiti');
  });

  it('prepares retained contracts before bundling or starting the development CLI', () => {
    const scripts = readCliScripts();
    for (const name of DEV_ENTRY_SCRIPTS) {
      const script = scripts[name] ?? '';
      const prepareIndex = script.indexOf(PREPARE_STEP);
      expect(prepareIndex, `"${name}" must run ${PREPARE_STEP}`).toBeGreaterThanOrEqual(0);

      const launchMatch = CLI_LAUNCH_PATTERN.exec(script);
      expect(launchMatch, `"${name}" must bundle or launch the CLI`).not.toBeNull();
      expect(
        launchMatch?.index ?? -1,
        `"${name}" must prepare adapters before launching the CLI`
      ).toBeGreaterThan(prepareIndex);
    }
  });

  it('does not build retired adapter executables or copy presets', () => {
    const scripts = readCliScripts();
    const prepare = scripts['prepare:acp-adapters'];
    expect(prepare).toContain('--filter acp-extension-core build');
    for (const name of ['claude', 'codex', 'grok', 'dsh'])
      expect(prepare).not.toContain(`--filter acp-extension-${name} build`);
    expect(scripts).not.toHaveProperty('copy:dsh-presets');
    expect(scripts.build).not.toContain('copy:dsh-presets');
    expect(scripts.dev).toContain('dev-build.mjs --clean');
  });
});
