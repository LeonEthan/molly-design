import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  existsSync,
  writeFileSync,
  symlinkSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { migrateTwoFileArtwork } from '../src/migrate-two-file.ts';
import { collectAuthoring, digestAuthoring, intakeAuthoring } from '../src/index.ts';
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })));
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'molly-migrate-'));
  roots.push(root);
  const source = join(root, 'source'),
    target = join(root, 'new');
  mkdirSync(join(source, 'pages'), { recursive: true });
  writeFileSync(
    join(source, 'design.yaml'),
    'title: "Synthetic draft"\nsize: [320, 200]\npages: [pages/canvas.yaml]\n'
  );
  writeFileSync(
    join(source, 'pages/canvas.yaml'),
    'elements:\n  - id: text\n    kind: text\n    bounds: [0, 0, 100, 30]\n    text: {paragraphs: [{runs: [{text: "a"}, {text: "b"}]}]}\n'
  );
  return { source, target };
}
it('explicitly migrates to a fresh directory and preserves original bytes and draft fingerprint', () => {
  const { source, target } = fixture();
  const before = digestAuthoring(source);
  expect(() => collectAuthoring(source)).toThrow();
  migrateTwoFileArtwork(source, target);
  expect(digestAuthoring(source)).toBe(before);
  const result = intakeAuthoring('design.yaml', collectAuthoring(target));
  expect(result.status).toBe('ok');
  if (result.status !== 'ok') return;
  expect(result.document.elements[0]).toMatchObject({
    id: 'text',
    zIndex: 0,
    text: { paragraphs: [{ runs: [{ text: 'a' }, { text: 'b' }] }] },
  });
  expect(readFileSync(join(target, 'design.yaml'), 'utf8')).toContain('Synthetic draft');
  expect(existsSync(join(target, 'pages'))).toBe(false);
  expect(() => migrateTwoFileArtwork(source, target)).toThrow();
});
it.each(['theme: {}\n', 'version: v2\n', 'unexpected: true\n'])(
  'rejects old or unknown semantics without creating an output: %s',
  (extra) => {
    const { source, target } = fixture();
    writeFileSync(
      join(source, 'design.yaml'),
      readFileSync(join(source, 'design.yaml'), 'utf8') + extra
    );
    expect(() => migrateTwoFileArtwork(source, target)).toThrow();
    expect(existsSync(target)).toBe(false);
  }
);
it('rejects redirected source pages without writing output', () => {
  const { source, target } = fixture();
  symlinkSync('canvas.yaml', join(source, 'pages/evil.yaml'));
  expect(() => migrateTwoFileArtwork(source, target)).toThrow();
  expect(existsSync(target)).toBe(false);
});

it('rejects a destination redirected inside the source directory', () => {
  const { source, target } = fixture();
  symlinkSync(source, target, 'dir');
  expect(() => migrateTwoFileArtwork(source, join(target, 'converted'))).toThrow(
    /outside the source/
  );
  expect(existsSync(join(source, 'converted'))).toBe(false);
});
