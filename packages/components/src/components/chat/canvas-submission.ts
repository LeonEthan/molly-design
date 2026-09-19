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
