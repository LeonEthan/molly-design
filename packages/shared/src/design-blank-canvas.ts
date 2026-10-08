const DEFAULT_BACKGROUND_COLORS = new Set(['#ffffff', '#fff']);

/** A canvas still in the state a new design starts in: no elements and the default white fill. */
export function isBlankCanvas(doc: {
  elements: readonly unknown[];
  background: Record<string, unknown>;
}): boolean {
  const { type, color } = doc.background;
  return (
    doc.elements.length === 0 &&
    type === 'solid' &&
    typeof color === 'string' &&
    DEFAULT_BACKGROUND_COLORS.has(color.toLowerCase())
  );
}
