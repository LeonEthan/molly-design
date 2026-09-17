import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { exportAuthoring, intakeAuthoring } from '../src/index.ts';

const enc = new TextEncoder();
describe('molly-canvas/1', () => {
  it('imports a single canvas and deterministically exports only design.yaml', () => {
    const result = intakeAuthoring(
      'design.yaml',
      new Map([
        [
          'design.yaml',
          enc.encode(`format: molly-canvas/1
size: [285, 2000]
elements:
  - id: heading
    kind: text
    bounds: [12, 12, 261, 48]
    text:
      paragraphs:
        - runs:
            - text: "Synthetic title"
`),
        ],
      ])
    );
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.document.canvas).toEqual({ width: 285, height: 2000 });
    expect(result.document.background).toEqual({ type: 'solid', color: '#FFFFFF' });
    expect(result.document.elements[0]?.zIndex).toBe(0);
    const snapshot = exportAuthoring(result.document, result.assets);
    expect([...snapshot.keys()]).toEqual(['design.yaml']);
    const reread = intakeAuthoring('design.yaml', snapshot);
    expect(reread.status).toBe('ok');
    if (reread.status === 'ok') expect(reread.document).toEqual(result.document);
  });
  it.each(['', 'geon-canvas/2'])('rejects an absent or unknown format: %s', (format) => {
    const result = intakeAuthoring(
      'design.yaml',
      new Map([['design.yaml', enc.encode(`format: "${format}"\nsize: [10, 10]\nelements: []`)]])
    );
    expect(result.status).toBe('invalid');
  });
});

it('reads legacy canvas bytes without mutation and writes the new format losslessly', () => {
  const bytes = enc.encode('format: geon-canvas/1\nsize: [320, 200]\nelements: []\n');
  const source = new Map([['design.yaml', bytes]]);
  const result = intakeAuthoring('design.yaml', source);
  expect(result.status).toBe('ok');
  if (result.status !== 'ok') return;
  const saved = exportAuthoring(result.document, result.assets);
  expect(parse(new TextDecoder().decode(saved.get('design.yaml'))).format).toBe('molly-canvas/1');
  expect(new TextDecoder().decode(source.get('design.yaml'))).toContain('format: geon-canvas/1');
  const reopened = intakeAuthoring('design.yaml', saved);
  expect(reopened.status).toBe('ok');
  if (reopened.status === 'ok') expect(reopened.document).toEqual(result.document);
});
