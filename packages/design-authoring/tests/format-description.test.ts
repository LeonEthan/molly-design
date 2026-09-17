/**
 * Format description tests: describeAuthoringFormat must mirror the validator's
 * admission grammar, and every published exclusion must be a rejection the
 * validator actually enforces (injected-fixture drift guard, synthetic only).
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import {
  ARTWORK_EXCLUSIONS,
  ARTWORK_FORMAT,
  ARTWORK_ROOT_FIELDS,
  describeAuthoringFormat,
} from '../src/canvas-format.ts';
import { validate } from '../src/validate.ts';
import { BENTO_DOC_V4_FIELDS, BENTO_ELEMENT_KINDS_V4 } from '../src/contracts.ts';

const BASE = {
  format: ARTWORK_FORMAT,
  size: [640, 800],
  elements: [] as unknown[],
};

function expectRejected(canvas: Record<string, unknown>, needle: string): void {
  const dir = mkdtempSync(path.join(tmpdir(), 'molly-format-desc-'));
  try {
    writeFileSync(path.join(dir, 'design.yaml'), stringify(canvas));
    const result = validate(path.join(dir, 'design.yaml'), { projectRoot: dir });
    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.message.includes(needle)),
      `expected a diagnostic mentioning "${needle}", got ${JSON.stringify(result.diagnostics)}`
    ).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('describeAuthoringFormat derivation', () => {
  it('describes the same root fields the validator admits', () => {
    const description = describeAuthoringFormat();
    expect(description.format).toBe(ARTWORK_FORMAT);
    expect(description.entry).toBe('design.yaml');
    expect(description.rootFields).toEqual([...ARTWORK_ROOT_FIELDS]);
  });

  it('describes exactly the v4 kind vocabulary with common plus kind-specific fields', () => {
    const description = describeAuthoringFormat();
    expect(description.kinds.map((entry) => entry.kind)).toEqual([...BENTO_ELEMENT_KINDS_V4]);
    for (const entry of description.kinds) {
      const expected = [
        ...new Set<string>([
          ...BENTO_DOC_V4_FIELDS.elements.common,
          ...BENTO_DOC_V4_FIELDS.elements[entry.kind as keyof typeof BENTO_DOC_V4_FIELDS.elements],
        ]),
      ];
      expect(entry.fields).toEqual(expected);
    }
  });

  it('does not present excluded constructs as admissible', () => {
    const description = describeAuthoringFormat();
    expect(description.exclusions.map((exclusion) => exclusion.name)).toEqual(
      ARTWORK_EXCLUSIONS.map((exclusion) => exclusion.name)
    );
    for (const entry of description.kinds) {
      expect(entry.fields).not.toContain('theme');
      expect(entry.fields).not.toContain('seriesDefaults');
    }
    expect(description.rootFields).not.toContain('theme');
    expect(description.rootFields).not.toContain('pages');
  });

  it('carries value-level constraint notes', () => {
    const description = describeAuthoringFormat();
    expect(description.notes.length).toBeGreaterThan(0);
  });
});

describe('published exclusions are enforced by the validator', () => {
  it('rejects leftover PPTD manifests and version markers', () => {
    expectRejected({ ...BASE, version: 'v2' }, 'PPTD');
  });

  it('rejects theme at the root', () => {
    expectRejected({ ...BASE, theme: { palette: {} } }, 'theme');
  });

  it('rejects pages and PPTD page fields at the root', () => {
    expectRejected({ ...BASE, pages: {} }, 'pages');
    expectRejected({ ...BASE, notes: 'speaker notes' }, 'notes');
    expectRejected({ ...BASE, animations: [] }, 'animations');
    expectRejected({ ...BASE, pageType: 'cover' }, 'pageType');
  });

  it('rejects PPTD element identity and HTML content fields', () => {
    const element = { id: 'e1', kind: 'text', bounds: [0, 0, 100, 40], text: { paragraphs: [] } };
    expectRejected({ ...BASE, elements: [{ ...element, elementId: 'e1' }] }, 'elementId');
    expectRejected({ ...BASE, elements: [{ ...element, elementType: 'text' }] }, 'elementType');
    expectRejected({ ...BASE, elements: [{ ...element, content: '<b>x</b>' }] }, 'HTML');
  });

  it('rejects chart.seriesDefaults', () => {
    const chart = {
      id: 'c1',
      kind: 'chart',
      bounds: [0, 0, 100, 100],
      chart: { seriesDefaults: {}, data: { cols: [], rows: [] } },
    };
    expectRejected({ ...BASE, elements: [chart] }, 'seriesDefaults');
  });

  it('rejects remote asset URLs', () => {
    const image = {
      id: 'i1',
      kind: 'image',
      bounds: [0, 0, 100, 100],
      src: 'https://example.com/x.png',
      fit: 'cover',
    };
    expectRejected({ ...BASE, elements: [image] }, 'Remote');
  });
});
