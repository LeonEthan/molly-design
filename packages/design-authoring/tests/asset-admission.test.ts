import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { digestAuthoring, intakeAuthoring, validate } from '../src/index.ts';

const png = readFileSync(
  new URL('../skills/graphic-design/examples/minimal/media/swatch.png', import.meta.url)
);
const sample = JSON.parse(
  readFileSync(new URL('../../design-bento/sample.json', import.meta.url), 'utf8')
) as { assets: Record<string, string> };
const fontUri = Object.values(sample.assets).find((uri) => uri.startsWith('data:font/'));
if (!fontUri) throw Error('Synthetic font fixture is missing');
const font = Buffer.from(fontUri.slice(fontUri.indexOf(',') + 1), 'base64');
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function artwork(kind: 'image' | 'font', bytes: Uint8Array) {
  const source = `format: molly-canvas/1
size: [320, 200]
${kind === 'font' ? 'customFonts:\n  - family: Fixture\n    src: media/asset\nelements: []' : 'elements:\n  - id: picture\n    kind: image\n    bounds: [0, 0, 10, 10]\n    src: media/asset'}
`;
  return new Map([
    ['design.yaml', new TextEncoder().encode(source)],
    ['media/asset', bytes],
  ]);
}

it.each(['image', 'font'] as const)(
  'filesystem validation and frozen intake reject the same oversized %s with its authored path',
  (kind) => {
    const bytes = Buffer.alloc(16_777_217);
    (kind === 'font' ? font : png).copy(bytes);
    const snapshot = artwork(kind, bytes);
    const root = mkdtempSync(path.join(tmpdir(), 'molly-admission-'));
    roots.push(root);
    mkdirSync(path.join(root, 'media'));
    for (const [name, content] of snapshot) writeFileSync(path.join(root, name), content);
    const fileResult = validate(path.join(root, 'design.yaml'), { projectRoot: root });
    const frozenResult = intakeAuthoring('design.yaml', snapshot);
    expect(fileResult.ok).toBe(false);
    expect(frozenResult.status).toBe('invalid');
    if (frozenResult.status !== 'invalid') return;
    expect(fileResult.diagnostics).toEqual(frozenResult.diagnostics);
    expect(frozenResult.diagnostics).toEqual([
      expect.objectContaining({
        code: 'MOLLY-E005',
        assetFailure: {
          code: 'asset_too_large',
          path: 'media/asset',
          actualBytes: 16_777_217,
          limitBytes: 16_777_216,
        },
      }),
    ]);
  }
);

it('admits an exact-limit asset and ignores unreferenced oversized media', () => {
  const bytes = Buffer.alloc(16_777_216);
  png.copy(bytes);
  const snapshot = artwork('image', bytes);
  snapshot.set('media/unused', new Uint8Array(16_777_217));
  const result = intakeAuthoring('design.yaml', snapshot);
  expect(result.status).toBe('ok');
  if (result.status !== 'ok') return;
  expect(result.assets.size).toBe(1);
  const admitted = [...result.assets.values()][0];
  expect(admitted && Buffer.from(admitted).equals(bytes)).toBe(true);
});

it.each(['image', 'font'] as const)(
  'reports the expected %s asset kind for unsupported bytes',
  (kind) => {
    const result = intakeAuthoring('design.yaml', artwork(kind, new Uint8Array([1, 2, 3])));
    expect(result.status).toBe('invalid');
    if (result.status !== 'invalid') return;
    expect(result.diagnostics[0]).toMatchObject({
      code: 'MOLLY-E005',
      assetFailure: { code: 'asset_format_unsupported', path: 'media/asset', kind },
    });
  }
);

it('keeps full-tree digest bytes unchanged above observation limits', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'molly-digest-admission-'));
  roots.push(root);
  mkdirSync(path.join(root, 'media'));
  writeFileSync(
    path.join(root, 'design.yaml'),
    'format: molly-canvas/1\nsize: [1, 1]\nelements: []'
  );
  writeFileSync(path.join(root, 'media/unused'), Buffer.alloc(50 * 1024 * 1024));
  expect(digestAuthoring(root)).toBe(
    'a13ef7ccfe7abf5c72893aa8ae93278b97282d0e5f53e220ce662d725f2f2578'
  );
});
