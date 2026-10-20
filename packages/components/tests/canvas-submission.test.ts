import { describe, expect, it } from 'vitest';
import {
  buildPendingUserHistoryEntry,
  buildSessionTurnInputConfig,
  historyItemsToInputBlocks,
  extractPromptPreviewFromInputBlocks,
  normalizeSessionTurnInputConfig,
  type SessionInputBlock,
} from '@molly/shared';
import {
  buildCanvasSubmission,
  designSessionTitleBrief,
  parseCanvasSizeInstruction,
} from '../src/components/chat/canvas-submission';
import { wrapPastedTextChipLabel } from '../src/components/mentions/mention-chips';
import { insertPastedTextDraft } from '../src/lib/pasted-text-draft';
import en from '../../../locales/en.json';
import zhCN from '../../../locales/zh_CN.json';

const instruction = ({ width, height }: { width: number; height: number }) =>
  `Canvas size: ${width} × ${height} px. Design at exactly this width and height.`;
const draft: SessionInputBlock[] = [
  { type: 'text', text: 'Make a poster' },
  {
    type: 'image',
    imageId: 'reference',
    mimeType: 'image/png',
    width: 10,
    height: 10,
    sizeBytes: 100,
  },
];

describe('design session title brief', () => {
  it('keeps the composer text from before mention expansion', () => {
    const composer = 'Use $poster for a jazz night';
    const expanded =
      'Use use /poster [Skill Path](/skills/poster/SKILL.md) for a jazz night\nuse molly mcp to read the skill';
    expect(designSessionTitleBrief(`  ${composer}  `)).toBe(composer);
    expect(designSessionTitleBrief(composer)).not.toBe(expanded);
  });

  it('restores a large paste and leaves skill mentions literal', () => {
    const pasted = `${'Poster copy. '.repeat(80)}\nUse $poster for the headline.`;
    const prefix = 'Brief for $poster: ';
    const inserted = insertPastedTextDraft({
      currentValue: prefix,
      pastedText: pasted,
      displayText: wrapPastedTextChipLabel(`[Pasted ${pasted.length} chars]`),
      id: 'paste-1',
      selectionStart: prefix.length,
      selectionEnd: prefix.length,
    });
    expect(inserted).not.toBeNull();
    const brief = designSessionTitleBrief(inserted!.nextValue, [inserted!.draft]);
    expect(brief).toBe(`${prefix}${pasted}`);
    expect(brief).not.toContain('[Pasted');
    expect(brief).toContain('$poster');
    expect(brief).not.toContain('Skill Path');
    expect(brief).not.toContain('Canvas size:');
  });
});

describe('landing canvas submission through durable turn input', () => {
  it.each([
    [1200, 628],
    [628, 1200],
    [800, 600],
    [1, 4096],
  ])('delivers custom %i × %i with the same dimensions as artwork creation', (width, height) => {
    const submit = () =>
      buildCanvasSubmission(draft, { mode: 'custom', width, height }, instruction);
    const submission = submit();
    expect(submission.dimensions).toEqual({ width, height });
    const config = buildSessionTurnInputConfig({
      inputBlocks: submission.inputBlocks,
      titlePrompt: extractPromptPreviewFromInputBlocks(draft),
      cliType: 'codex',
      agentType: 'codex',
    });
    const entry = buildPendingUserHistoryEntry({
      userId: 'local:test',
      inputBlocks: submission.inputBlocks,
      timestamp: '2026-09-19T00:00:00Z',
      inputConfig: config,
    });
    expect(config.prompt).toContain(instruction({ width, height }));
    expect(normalizeSessionTurnInputConfig(entry?.inputConfig)?.titlePrompt).toBe('Make a poster');
    expect(historyItemsToInputBlocks(entry!.items)).toEqual(submission.inputBlocks);
    expect(submission.inputBlocks.slice(0, draft.length)).toEqual(draft);
    expect(submit()).toEqual(submission); // Retrying rebuilds from the untouched draft.
    expect(draft).toHaveLength(2);
  });
  it.each([undefined, { mode: 'auto' as const, width: 800, height: 600 }])(
    'keeps Auto and non-desktop submissions unconstrained',
    (size) => {
      expect(buildCanvasSubmission(draft, size, instruction)).toEqual({
        inputBlocks: draft,
        dimensions: undefined,
      });
    }
  );
  it.each([0, 4097, 1.5, NaN])('rejects invalid dimensions %s before create/send', (width) => {
    expect(() =>
      buildCanvasSubmission(draft, { mode: 'custom', width, height: 600 }, instruction)
    ).toThrow(RangeError);
  });
});

describe('recognizing the size instruction for display', () => {
  const templates = [en['design.requestedSize'], zhCN['design.requestedSize']];
  const render = (template: string, width: number, height: number) =>
    template.replace('{{width}}', String(width)).replace('{{height}}', String(height));

  it.each(templates)('reads dimensions back from %s', (template) => {
    expect(parseCanvasSizeInstruction(render(template, 1080, 1350), templates)).toEqual({
      width: 1080,
      height: 1350,
    });
  });

  it('leaves ordinary prompts that mention a size as text', () => {
    expect(
      parseCanvasSizeInstruction('Canvas size: 1080 × 1350 px. Make it bold.', templates)
    ).toBeNull();
    expect(parseCanvasSizeInstruction('Make a 1080 × 1350 poster', templates)).toBeNull();
  });
});
