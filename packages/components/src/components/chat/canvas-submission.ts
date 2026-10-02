import type { SessionInputBlock } from '@molly/shared';

/** Capture artwork creation and first-turn input from the same landing selection. */
export function buildCanvasSubmission(
  inputBlocks: SessionInputBlock[],
  size: { mode: 'auto' | 'custom'; width: number; height: number } | undefined,
  instruction: (size: { width: number; height: number }) => string
) {
  if (size?.mode !== 'custom') return { inputBlocks, dimensions: undefined };
  const { width, height } = size;
  if (![width, height].every((value) => Number.isInteger(value) && value >= 1 && value <= 4096))
    throw new RangeError('Invalid canvas dimensions');
  return {
    inputBlocks: [...inputBlocks, { type: 'text' as const, text: instruction({ width, height }) }],
    dimensions: { width, height },
  };
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Recognize a durable first-turn size instruction written from any shipped `design.requestedSize` template. */
export function parseCanvasSizeInstruction(
  text: string,
  templates: readonly string[]
): { width: number; height: number } | null {
  const trimmed = text.trim();
  for (const template of templates) {
    if (!template.includes('{{width}}') || !template.includes('{{height}}')) continue;
    const pattern = escapeRegExp(template.trim())
      .replace(escapeRegExp('{{width}}'), '(?<width>\\d+)')
      .replace(escapeRegExp('{{height}}'), '(?<height>\\d+)');
    const groups = new RegExp(`^${pattern}$`).exec(trimmed)?.groups;
    if (groups) return { width: Number(groups.width), height: Number(groups.height) };
  }
  return null;
}
