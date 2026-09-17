import { describe, expect, it } from 'vitest';

import {
  DESIGN_SELECTION_SUMMARY_ELEMENTS_MAX,
  DesignCanvasCommandResultSchema,
  DesignCanvasCommandSchema,
  DesignSelectionSummarySchema,
  DesignToolbarRequestSchema,
  DesignToolbarPresentationSchema,
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
