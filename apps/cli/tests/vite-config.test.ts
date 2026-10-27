import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import viteConfig from '../vite.config';

describe('CLI vite config', () => {
  it('bundles runtime dependencies needed by the Electron CLI copy', () => {
    expect(viteConfig.ssr?.external).toEqual(
      expect.arrayContaining(['bufferutil', 'utf-8-validate', 'typescript'])
    );

    const external = viteConfig.build?.rollupOptions?.external;
    expect(typeof external).toBe('function');

    if (typeof external !== 'function') {
      throw new Error('rollup external config should be a function');
    }

    expect(external('ws', undefined, false)).toBe(false);
    expect(external('ws/lib/sender', undefined, false)).toBe(false);
    expect(external('convex/browser', undefined, false)).toBe(false);
    expect(external('convex/server', undefined, false)).toBe(false);
    expect(external('better-sqlite3', undefined, false)).toBe(true);
    expect(external('typescript', undefined, false)).toBe(true);
  });

  it('preserves the previous native overlay before Vite empties the output', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    );
    expect(packageJson.scripts['build:bundle']).toBe(
      'node scripts/build-embedded-harness.mjs --with-vite'
    );
    const source = readFileSync(
      new URL('../scripts/build-embedded-harness.mjs', import.meta.url),
      'utf8'
    );
    const orchestration = source.slice(source.indexOf('export async function buildCliBundle'));
    const preserve = orchestration.indexOf('previousOverlayResource');
    const vite = orchestration.indexOf('await viteBuild');
    const seal = orchestration.indexOf('await buildEmbeddedHarness');
    expect(preserve).toBeGreaterThanOrEqual(0);
    expect(vite).toBeGreaterThan(preserve);
    expect(seal).toBeGreaterThan(vite);
    expect(viteConfig.build?.emptyOutDir).toBe(true);
  });

  it('disables ws optional native dependencies in bundled output', () => {
    expect(viteConfig.define).toMatchObject({
      'process.env.WS_NO_BUFFER_UTIL': JSON.stringify('true'),
      'process.env.WS_NO_UTF_8_VALIDATE': JSON.stringify('true'),
    });
  });
});
