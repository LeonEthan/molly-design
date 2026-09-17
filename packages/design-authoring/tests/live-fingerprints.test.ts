/**
 * Live authoring surface must not present PPTD, Kimi, Folio, or ALD-adapted
 * PPTD catalogues as the current format. Frozen vendor tables may still
 * contain PPTD-E* / common.kimiRuntime.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { intakeAuthoring } from '../src/intake.ts';
import { validateSnapshot } from '../src/validate.ts';

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const helperDir = path.join(packageRoot, 'skills', 'graphic-design', 'scripts');
const enc = new TextEncoder();

const VALID_PAGE = `background:
  type: solid
  color: "#FFFFFF"
elements:
  - id: photo
    kind: image
    bounds: [10, 10, 64, 64]
    src: media/missing.png
    fit: cover
`;

describe('live PPTD/Kimi fingerprints', () => {
  it('ships molly-authoring.mjs and does not keep a pre-rename helper', () => {
    expect(existsSync(path.join(helperDir, 'lib', 'geon-pptd.mjs'))).toBe(false);
    expect(existsSync(path.join(helperDir, 'lib', 'geon-authoring.mjs'))).toBe(false);
    expect(existsSync(path.join(helperDir, 'lib', 'molly-authoring.mjs'))).toBe(true);
    const finalize = readFileSync(path.join(helperDir, 'finalize.mjs'), 'utf8');
    const preview = readFileSync(path.join(helperDir, 'render-preview.mjs'), 'utf8');
    expect(finalize).toContain('./lib/molly-authoring.mjs');
    expect(preview).toContain('./lib/molly-authoring.mjs');
    expect(finalize).not.toMatch(/geon-pptd|geon-authoring/);
    expect(preview).not.toMatch(/geon-pptd|geon-authoring/);
  });

  it('emits MOLLY-E* diagnostics rather than PPTD-E*', () => {
    const result = intakeAuthoring(
      'design.yaml',
      new Map([
        [
          'design.yaml',
          enc.encode('format: molly-canvas/1\ntitle: Test\nsize: [320, 200]\n' + VALID_PAGE),
        ],
      ])
    );
    expect(result.status).toBe('invalid');
    if (result.status !== 'invalid') return;
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics.every((diagnostic) => diagnostic.code.startsWith('MOLLY-E'))).toBe(
      true
    );
    expect(result.diagnostics.some((diagnostic) => diagnostic.code.startsWith('PPTD-'))).toBe(
      false
    );
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'MOLLY-E005')).toBe(true);
  });

  it('presents the excluded remote renderer without PPTD or Kimi names', () => {
    const probe = {
      probeVersion: 1,
      capabilityId: 'common.remoteRenderer',
      inputKind: 'renderer-runtime-request',
      payload: { renderer: 'remote', runtime: 'remote', operation: 'render' },
    };
    const result = validateSnapshot(
      'probe.json',
      new Map([['probe.json', enc.encode(JSON.stringify(probe))]])
    );
    expect(result.ok).toBe(false);
    const diagnostic = result.diagnostics[0];
    expect(diagnostic?.code).toBe('MOLLY-E011');
    expect(diagnostic?.message).toMatch(/remote renderer/i);
    expect(diagnostic?.message).not.toMatch(/kimi|pptd/i);
  });

  it('does not pin rewritten skills or a PPTD catalogue as live ALD upstream', () => {
    const manifest = JSON.parse(
      readFileSync(path.join(packageRoot, 'source-manifest.json'), 'utf8')
    ) as {
      files: Record<string, { derivation: string; sha256?: string; upstreamSha256?: string }>;
      derivations: Record<string, string>;
    };
    const serialized = JSON.stringify(manifest);
    expect(serialized).not.toMatch(/Folio/);
    const blocked = [
      'skills/graphic-design/SKILL.md',
      'skills/graphic-design/scripts/finalize.mjs',
      'skills/graphic-design/scripts/render-preview.mjs',
      'skills/graphic-design/references/pptd-authoring.md',
      'skills/graphic-design/examples/minimal/poster.pptd',
      'skills/graphic-design/examples/minimal/pages/poster.page',
      'skills/imagegen/SKILL.md',
    ];
    for (const rel of blocked) {
      const entry = manifest.files[rel];
      expect(entry, rel).toBeUndefined();
    }
    for (const [rel, entry] of Object.entries(manifest.files)) {
      expect(entry.derivation, rel).not.toBe('rewritten');
      if (rel.toLowerCase().includes('pptd')) {
        expect(['verbatim', 'adapted']).not.toContain(entry.derivation);
      }
    }
    expect(manifest.files['src/validate.ts']?.derivation).toBe('adapted');
    expect(manifest.files['skills/imagegen/LICENSE.txt']?.derivation).toBe('verbatim');
  });

  it('keeps git history of the old PPTD/Folio lineage', () => {
    const log = spawnSync('git', ['log', '--format=%s', '-30'], {
      cwd: packageRoot,
      encoding: 'utf8',
    });
    expect(log.status).toBe(0);
    expect(log.stdout).toMatch(/PPTD|Folio/);
  });
});
