import { describe, expect, it } from 'vitest';

import {
  DESIGN_SELECTION_SUMMARY_ELEMENTS_MAX,
  DesignCanvasCommandResultSchema,
  DesignCanvasCommandSchema,
  DesignSelectionSummarySchema,
  DesignToolbarRequestSchema,
  DESIGN_ASK_PROMPT_MAX,
  DESIGN_SELECTION_BODY_LIMIT,
  DesignToolbarPresentationSchema,
  DesignHighlightSchema,
  DesignNotesSchema,
  DESIGN_NOTES_MAX,
  DESIGN_MARKS_MAX,
  DESIGN_MARKED_IMAGE_MAX_BYTES,
  decodeDesignMarkedImage,
  diffDesignElements,
} from '../src/design-selection-commands';

const textElement = {
  id: 'el-1',
  kind: 'text',
  width: 320,
  height: 80,
  color: '#000000',
  fontFamily: 'Inter',
  fontSize: 48,
  bold: false,
  italic: false,
  alignH: 'left',
};

describe('DesignSelectionSummarySchema', () => {
  it('accepts a full typed summary', () => {
    const summary = DesignSelectionSummarySchema.parse({
      count: 1,
      kinds: ['text'],
      elements: [textElement],
      fonts: ['Inter'],
    });
    expect(summary.elements?.[0]?.fontSize).toBe(48);
  });

  it('accepts valid image crop state and rejects degenerate crop state', () => {
    expect(
      DesignSelectionSummarySchema.parse({
        count: 1,
        kinds: ['image'],
        elements: [{ id: 'image-1', kind: 'image', crop: [0.12, 0, 0, 0] }],
      }).elements?.[0]?.crop
    ).toEqual([0.12, 0, 0, 0]);
    expect(
      DesignSelectionSummarySchema.safeParse({
        count: 1,
        kinds: ['image'],
        elements: [{ id: 'image-1', kind: 'image', crop: [0.6, 0, 0.4, 0] }],
      }).success
    ).toBe(false);
  });

  it('carries image lettering textCopy and bounds its length', () => {
    const summary = DesignSelectionSummarySchema.parse({
      count: 1,
      kinds: ['image'],
      elements: [{ id: 'title', kind: 'image', textCopy: '诺贝尔文学奖' }],
    });
    expect(summary.elements?.[0]?.textCopy).toBe('诺贝尔文学奖');
    expect(
      DesignSelectionSummarySchema.safeParse({
        count: 1,
        kinds: ['image'],
        elements: [{ id: 'title', kind: 'image', textCopy: '' }],
      }).success
    ).toBe(false);
    expect(
      DesignSelectionSummarySchema.safeParse({
        count: 1,
        kinds: ['image'],
        elements: [{ id: 'title', kind: 'image', textCopy: 'x'.repeat(2001) }],
      }).success
    ).toBe(false);
    // textCopy is a per-kind display hint: the summary schema admits it on any
    // element (the producer only sets it on images); the canonical kernel owns
    // the kind-level constraint.
    expect(
      DesignSelectionSummarySchema.safeParse({
        count: 1,
        kinds: ['text'],
        elements: [{ ...textElement, textCopy: 'stray' }],
      }).success
    ).toBe(true);
  });

  it('accepts a count-only summary without elements or fonts', () => {
    expect(DesignSelectionSummarySchema.parse({ count: 0, kinds: [] }).count).toBe(0);
  });

  it('rejects unknown keys and bad colors', () => {
    expect(
      DesignSelectionSummarySchema.safeParse({ count: 1, kinds: ['text'], extra: true }).success
    ).toBe(false);
    expect(
      DesignSelectionSummarySchema.safeParse({
        count: 1,
        kinds: ['text'],
        elements: [{ ...textElement, color: 'red' }],
      }).success
    ).toBe(false);
  });

  it('bounds the element list', () => {
    const elements = Array.from({ length: DESIGN_SELECTION_SUMMARY_ELEMENTS_MAX + 1 }, (_, i) => ({
      id: `el-${i}`,
      kind: 'shape',
    }));
    expect(
      DesignSelectionSummarySchema.safeParse({ count: 9, kinds: ['shape'], elements }).success
    ).toBe(false);
  });
});

describe('DesignCanvasCommandSchema', () => {
  it('parses every verb', () => {
    expect(DesignCanvasCommandSchema.parse({ verb: 'text-style', bold: true }).verb).toBe(
      'text-style'
    );
    expect(DesignCanvasCommandSchema.parse({ verb: 'fill', fill: null }).verb).toBe('fill');
    expect(DesignCanvasCommandSchema.parse({ verb: 'border', color: '#fff', width: 2 }).verb).toBe(
      'border'
    );
    expect(DesignCanvasCommandSchema.parse({ verb: 'size', width: 10, height: 20 }).verb).toBe(
      'size'
    );
    expect(DesignCanvasCommandSchema.parse({ verb: 'position', x: 12, y: 34 }).verb).toBe(
      'position'
    );
    expect(DesignCanvasCommandSchema.parse({ verb: 'image-fit', fit: 'cover' }).verb).toBe(
      'image-fit'
    );
    expect(
      DesignCanvasCommandSchema.parse({ verb: 'image-crop', crop: [0.12, 0, 0, 0] }).verb
    ).toBe('image-crop');
    expect(DesignCanvasCommandSchema.parse({ verb: 'image-crop', crop: null }).crop).toBeNull();
    expect(DesignCanvasCommandSchema.parse({ verb: 'line-arrow', preset: 'both' }).verb).toBe(
      'line-arrow'
    );
    expect(DesignCanvasCommandSchema.parse({ verb: 'add-element', kind: 'text' }).verb).toBe(
      'add-element'
    );
    expect(
      DesignCanvasCommandSchema.parse({ verb: 'add-element', kind: 'shape', shapeName: 'ellipse' })
        .verb
    ).toBe('add-element');
    expect(
      DesignCanvasCommandSchema.parse({
        verb: 'add-element',
        kind: 'image',
        src: `asset:${'a'.repeat(64)}`,
        naturalWidth: 800,
        naturalHeight: 600,
      }).verb
    ).toBe('add-element');
  });

  it('rejects unknown verbs, fields and out-of-range values', () => {
    expect(DesignCanvasCommandSchema.safeParse({ verb: 'delete' }).success).toBe(false);
    expect(DesignCanvasCommandSchema.safeParse({ verb: 'fill', fill: null, x: 1 }).success).toBe(
      false
    );
    expect(DesignCanvasCommandSchema.safeParse({ verb: 'size', width: 0, height: 5 }).success).toBe(
      false
    );
    expect(
      DesignCanvasCommandSchema.safeParse({ verb: 'line-arrow', preset: 'start' }).success
    ).toBe(false);
    expect(
      DesignCanvasCommandSchema.safeParse({ verb: 'image-crop', crop: [0.8, 0, 0.2, 0] }).success
    ).toBe(false);
    expect(DesignCanvasCommandSchema.safeParse({ verb: 'add-element', kind: 'icon' }).success).toBe(
      false
    );
    expect(
      DesignCanvasCommandSchema.safeParse({
        verb: 'add-element',
        kind: 'image',
        src: 'https://example.com/x.png',
      }).success
    ).toBe(false);
    expect(
      DesignCanvasCommandSchema.safeParse({ verb: 'add-element', kind: 'image' }).success
    ).toBe(false);
    expect(
      DesignCanvasCommandSchema.safeParse({
        verb: 'add-element',
        kind: 'shape',
        shapeName: 'custom',
      }).success
    ).toBe(false);
  });
});

describe('DesignCanvasCommandResultSchema', () => {
  it('round-trips ok and error shapes', () => {
    expect(DesignCanvasCommandResultSchema.parse({ ok: true, applied: 3 }).applied).toBe(3);
    expect(DesignCanvasCommandResultSchema.parse({ ok: false, error: 'No match' }).error).toBe(
      'No match'
    );
    expect(DesignCanvasCommandResultSchema.safeParse({ ok: true, applied: -1 }).success).toBe(
      false
    );
  });
});

describe('native toolbar boundary', () => {
  it('accepts only named actions and validated commands with a selection epoch', () => {
    expect(
      DesignToolbarRequestSchema.parse({ type: 'action', action: 'reference', selectionEpoch: 2 })
    ).toEqual({ type: 'action', action: 'reference', selectionEpoch: 2 });
    for (const input of [
      { type: 'action', action: 'execute', selectionEpoch: 2 },
      { type: 'action', action: 'reference', selectionEpoch: -1 },
      { type: 'command', selectionEpoch: 2, command: { verb: 'position', x: -1, y: 0 } },
      { type: 'action', action: 'reference', selectionEpoch: 2, hostId: 'untrusted' },
    ])
      expect(DesignToolbarRequestSchema.safeParse(input).success).toBe(false);
  });
  it('carries the new wording for edit-wording and nothing else', () => {
    expect(
      DesignToolbarRequestSchema.parse({
        type: 'action',
        action: 'edit-wording',
        selectionEpoch: 3,
        wording: '安妮·卡森 著',
      })
    ).toEqual({
      type: 'action',
      action: 'edit-wording',
      selectionEpoch: 3,
      wording: '安妮·卡森 著',
    });
    for (const input of [
      { type: 'action', action: 'edit-wording', selectionEpoch: 3, wording: '' },
      { type: 'action', action: 'edit-wording', selectionEpoch: 3, wording: 7 },
      { type: 'action', action: 'edit-wording', selectionEpoch: 3, wording: 'x'.repeat(2001) },
    ])
      expect(DesignToolbarRequestSchema.safeParse(input).success).toBe(false);
  });
  it('carries an inline ask prompt with an explicit send choice', () => {
    expect(
      DesignToolbarRequestSchema.parse({
        type: 'ask',
        selectionEpoch: 4,
        prompt: '  把标题改暖一点  ',
        send: true,
      })
    ).toEqual({ type: 'ask', selectionEpoch: 4, prompt: '把标题改暖一点', send: true });
    for (const input of [
      { type: 'ask', selectionEpoch: 4, prompt: '   ', send: true },
      { type: 'ask', selectionEpoch: 4, prompt: 'Warmer', send: 'yes' },
      { type: 'ask', selectionEpoch: 4, prompt: 'Warmer' },
      { type: 'ask', selectionEpoch: 4, prompt: 'x'.repeat(DESIGN_ASK_PROMPT_MAX + 1), send: true },
      { type: 'ask', selectionEpoch: 4, prompt: 'Warmer', send: true, action: 'reference' },
      { type: 'action', action: 'reference', selectionEpoch: 4, prompt: 'Warmer' },
    ])
      expect(DesignToolbarRequestSchema.safeParse(input).success).toBe(false);
    const largest = JSON.stringify({
      type: 'ask',
      selectionEpoch: Number.MAX_SAFE_INTEGER,
      prompt: '暖'.repeat(DESIGN_ASK_PROMPT_MAX),
      send: false,
    });
    expect(largest.length).toBeLessThanOrEqual(DESIGN_SELECTION_BODY_LIMIT);
  });
  it('bounds presentation data and carries no artwork mutation authority', () => {
    expect(
      DesignToolbarPresentationSchema.safeParse({
        dark: true,
        actionsEnabled: true,
        labels: { bold: 'Bold' },
      }).success
    ).toBe(true);
    expect(
      DesignToolbarPresentationSchema.safeParse({
        dark: true,
        actionsEnabled: true,
        labels: { bold: 'x'.repeat(501) },
      }).success
    ).toBe(false);
  });
});

describe('element change feedback', () => {
  it('reports added and modified elements, ignoring key and stacking order', () => {
    const before = {
      elements: [
        { id: 'title', kind: 'text', style: { color: '#000', size: 40 } },
        { id: 'leaf', kind: 'shape', fill: '#d80' },
        { id: 'logo', kind: 'image' },
      ],
    };
    const after = {
      elements: [
        { id: 'leaf', fill: '#d80', kind: 'shape' },
        { id: 'title', kind: 'text', style: { size: 40, color: '#a84a2a' } },
        { id: 'badge', kind: 'shape' },
      ],
    };
    expect(diffDesignElements(before, after)).toEqual({
      changed: ['title', 'badge'],
      removed: ['logo'],
    });
    expect(diffDesignElements(before, before)).toEqual({ changed: [], removed: [] });
  });
  it('bounds highlight groups to the known tones', () => {
    expect(
      DesignHighlightSchema.parse([
        { tone: 'changed', elementIds: ['a'] },
        { tone: 'outside', elementIds: [] },
      ])
    ).toHaveLength(2);
    for (const input of [
      [{ tone: 'flash', elementIds: ['a'] }],
      [{ tone: 'changed', elementIds: [''] }],
      [{ tone: 'changed', elementIds: ['a'], color: 'red' }],
      Array.from({ length: DESIGN_NOTES_MAX + 4 }, () => ({ tone: 'changed', elementIds: [] })),
    ])
      expect(DesignHighlightSchema.safeParse(input).success).toBe(false);
  });
  it('carries an optional note badge number on a highlight group', () => {
    expect(
      DesignHighlightSchema.parse([
        { tone: 'working', elementIds: ['a'], badge: 1 },
        { tone: 'changed', elementIds: ['a'], badge: DESIGN_NOTES_MAX },
      ])
    ).toEqual([
      { tone: 'working', elementIds: ['a'], badge: 1 },
      { tone: 'changed', elementIds: ['a'], badge: DESIGN_NOTES_MAX },
    ]);
    expect(
      DesignHighlightSchema.parse(
        Array.from({ length: DESIGN_NOTES_MAX }, (_, index) => ({
          tone: 'working',
          elementIds: [`el-${index}`],
          badge: index + 1,
        }))
      ).at(-1)?.badge
    ).toBe(DESIGN_NOTES_MAX);
    for (const badge of [0, DESIGN_NOTES_MAX + 1, 1.5, '1'])
      expect(
        DesignHighlightSchema.safeParse([{ tone: 'working', elementIds: ['a'], badge }]).success
      ).toBe(false);
  });
  it('carries only the notes epoch in a toolbar request and bounds the read notes', () => {
    expect(DesignToolbarRequestSchema.parse({ type: 'notes', notesEpoch: 3 })).toEqual({
      type: 'notes',
      notesEpoch: 3,
    });
    expect(
      DesignToolbarRequestSchema.safeParse({ type: 'notes', notesEpoch: 3, elementIds: ['a'] })
        .success
    ).toBe(false);
    expect(DesignNotesSchema.parse([{ elementIds: ['a'], prompt: ' Warmer ' }])).toEqual([
      { elementIds: ['a'], prompt: 'Warmer' },
    ]);
    const note = { elementIds: ['a'], prompt: 'Warmer' };
    for (const input of [
      [],
      [{ elementIds: [], prompt: 'Warmer' }],
      [{ elementIds: ['a'], prompt: '   ' }],
      [{ ...note, x: 1 }],
      Array.from({ length: DESIGN_NOTES_MAX + 1 }, () => note),
    ])
      expect(DesignNotesSchema.safeParse(input).success).toBe(false);
  });
  it('lets a preset stand in for the prompt only when it needs no detail', () => {
    const ask = { type: 'ask', selectionEpoch: 4, send: true };
    expect(
      DesignToolbarRequestSchema.parse({ ...ask, prompt: '  ', preset: 'remove-background' })
    ).toEqual({ ...ask, prompt: '', preset: 'remove-background' });
    expect(
      DesignToolbarRequestSchema.parse({ ...ask, prompt: 'a red umbrella', preset: 'replace-object' })
    ).toEqual({ ...ask, prompt: 'a red umbrella', preset: 'replace-object' });
    for (const input of [
      { ...ask, prompt: '', preset: 'replace-object' },
      { ...ask, prompt: '' },
      { ...ask, prompt: 'Warmer', preset: 'upscale' },
    ])
      expect(DesignToolbarRequestSchema.safeParse(input).success).toBe(false);
  });
  it('carries only the marks epoch and a prompt in a marks request', () => {
    const marks = { type: 'marks', selectionEpoch: 2, marksEpoch: 5, prompt: 'Gold', send: true };
    expect(DesignToolbarRequestSchema.parse(marks)).toEqual(marks);
    for (const input of [
      { ...marks, prompt: ' ' },
      { ...marks, marks: [{ kind: 'point', at: [0.5, 0.5] }] },
      { ...marks, image: 'iVBORw0KGgo=' },
      { type: 'marks', selectionEpoch: 2, prompt: 'Gold', send: true },
    ])
      expect(DesignToolbarRequestSchema.safeParse(input).success).toBe(false);
  });
  it('decodes a marked copy only for the referenced image and real image bytes', () => {
    const png = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0));
    const copy = { elementId: 'photo', count: 2, mimeType: 'image/png', data: png };
    const decoded = decodeDesignMarkedImage(copy, 'photo');
    expect(decoded.count).toBe(2);
    expect([...decoded.bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(() => decodeDesignMarkedImage(copy, 'headline')).toThrow('another element');
    expect(() =>
      decodeDesignMarkedImage({ ...copy, mimeType: 'image/jpeg' }, 'photo')
    ).toThrow('valid PNG or JPEG');
    expect(() => decodeDesignMarkedImage({ ...copy, data: btoa('<svg/>') }, 'photo')).toThrow();
    for (const input of [
      { ...copy, count: 0 },
      { ...copy, count: DESIGN_MARKS_MAX + 1 },
      { ...copy, mimeType: 'image/svg+xml' },
      { ...copy, data: 'not base64!' },
      { ...copy, data: 'A'.repeat(Math.ceil(DESIGN_MARKED_IMAGE_MAX_BYTES / 3) * 4 + 4) },
      { ...copy, marks: [] },
    ])
      expect(() => decodeDesignMarkedImage(input, 'photo')).toThrow();
  });
});
