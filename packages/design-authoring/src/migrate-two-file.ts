/** Explicit, one-time conversion of Molly's former two-file YAML projection.
 * No PPTD importer, canonical save, history write or turn authorization lives here.
 */
import { mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { resolve, join, sep, dirname, basename } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parse, stringify } from 'yaml';
import { collectAuthoring, collectTwoFileArtwork } from './collect-authoring.ts';
import { ARTWORK_ENTRY, ARTWORK_FORMAT } from './canvas-format.ts';
import { intakeAuthoring } from './intake.ts';

const PAGE = 'pages/canvas.yaml';
const enc = new TextEncoder();
function mapping(value: unknown, fields: string[], at: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error(`${at}: expected mapping`);
  for (const key of Object.keys(value))
    if (!fields.includes(key)) throw Error(`${at}: unsupported field ${key}`);
  return value as Record<string, unknown>;
}
/** Pure conversion over guarded, immutable bytes; assets and title keep their values. */
export function convertTwoFileSnapshot(
  snapshot: ReadonlyMap<string, Uint8Array>
): Map<string, Uint8Array> {
  const read = (rel: string) => {
    const bytes = snapshot.get(rel);
    if (!bytes) throw Error(`Missing old YAML file: ${rel}`);
    return parse(new TextDecoder().decode(bytes), { maxAliasCount: 100 });
  };
  const manifest = mapping(
    read(ARTWORK_ENTRY),
    ['title', 'size', 'pages', 'customFonts'],
    ARTWORK_ENTRY
  );
  if (!Array.isArray(manifest.pages) || manifest.pages.length !== 1 || manifest.pages[0] !== PAGE)
    throw Error('Migration requires exactly pages: [pages/canvas.yaml]');
  const canvas = mapping(read(PAGE), ['background', 'elements', 'diagnostics'], PAGE);
  const { pages: _pages, ...metadata } = manifest;
  const output = new Map<string, Uint8Array>();
  for (const [rel, bytes] of snapshot) {
    if (rel === ARTWORK_ENTRY || rel === PAGE) continue;
    if (!/^media\/[^/\\]+$/.test(rel) || rel === 'media/.' || rel === 'media/..')
      throw Error(`Unexpected old file: ${rel}`);
    output.set(rel, new Uint8Array(bytes));
  }
  output.set(
    ARTWORK_ENTRY,
    enc.encode(
      stringify(
        { format: ARTWORK_FORMAT, ...metadata, ...canvas },
        { aliasDuplicateObjects: false }
      )
    )
  );
  const result = intakeAuthoring(ARTWORK_ENTRY, output);
  if (result.status !== 'ok') throw Error(`Migration rejected: ${JSON.stringify(result)}`);
  return output;
}

/** The output must be fresh and outside the source; an existing directory is never overwritten. */
export function migrateTwoFileArtwork(
  sourceDir: string,
  outputDir: string
): { entry: string; assets: number; elements: number } {
  const source = resolve(sourceDir);
  const sourceReal = realpathSync(source);
  const output = join(realpathSync(dirname(resolve(outputDir))), basename(resolve(outputDir)));
  if (output === sourceReal || output.startsWith(sourceReal + sep))
    throw Error('Migration output must be outside the source');
  const snapshot = convertTwoFileSnapshot(collectTwoFileArtwork(source));
  const expected = intakeAuthoring(ARTWORK_ENTRY, snapshot);
  if (expected.status !== 'ok') throw Error('Migration validation failed');
  // Exclusive creation after validation. On I/O failure retain the incomplete output
  // for inspection, without touching either source or an existing destination.
  mkdirSync(output);
  if ([...snapshot.keys()].some((rel) => rel.startsWith('media/')))
    mkdirSync(join(output, 'media'));
  for (const [rel, bytes] of snapshot) writeFileSync(join(output, rel), bytes, { flag: 'wx' });
  const written = collectAuthoring(output);
  if (!isDeepStrictEqual(written, snapshot))
    throw Error('Migrated file bytes differ; source preserved');
  const actual = intakeAuthoring(ARTWORK_ENTRY, written);
  if (
    actual.status !== 'ok' ||
    !isDeepStrictEqual(actual.document, expected.document) ||
    !isDeepStrictEqual(actual.assets, expected.assets)
  )
    throw Error('Migrated document/asset verification failed; source preserved');
  return {
    entry: join(output, ARTWORK_ENTRY),
    assets: actual.assets.size,
    elements: actual.document.elements.length,
  };
}
