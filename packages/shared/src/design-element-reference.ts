import { z } from 'zod';

/** Stable canonical identities; labels and viewport geometry never identify a target. */
export const DesignElementReferenceSchema = z
  .object({
    artworkId: z.string().min(1).max(200),
    baselineRevisionId: z.string().regex(/^[a-f0-9]{64}$/),
    elementIds: z.array(z.string().min(1).max(200)).min(1).max(1000),
  })
  .strict();
export type DesignElementReference = z.infer<typeof DesignElementReferenceSchema>;

const PREFIX = '<molly-elements>';
const SUFFIX = '</molly-elements>';
export function formatDesignElementReference(reference: DesignElementReference): string {
  return (
    PREFIX +
    JSON.stringify(DesignElementReferenceSchema.parse(reference)).replaceAll('<', '\\u003c') +
    SUFFIX
  );
}

/** The ordinary prompt is frozen verbatim. Malformed identity markers fail closed. */
export function readDesignElementReferences(prompt: string): DesignElementReference[] {
  const references: DesignElementReference[] = [];
  let offset = 0;
  for (;;) {
    const start = prompt.indexOf(PREFIX, offset);
    if (start < 0) return references;
    const end = prompt.indexOf(SUFFIX, start + PREFIX.length);
    if (end < 0)
      throw Error('Invalid element reference; remove it and select the current elements again');
    references.push(
      DesignElementReferenceSchema.parse(JSON.parse(prompt.slice(start + PREFIX.length, end)))
    );
    offset = end + SUFFIX.length;
  }
}

export function validateDesignElementReferences(
  references: readonly DesignElementReference[],
  artworkId: string,
  baseline: { revisionId: string; doc: { elements: readonly { id: string }[] } }
): void {
  const ids = new Set(baseline.doc.elements.map((element) => element.id));
  for (const reference of references) {
    if (reference.artworkId !== artworkId)
      throw Error(
        'Element reference belongs to another artwork; remove it and select the current elements again'
      );
    if (reference.elementIds.some((id) => !ids.has(id)))
      throw Error(
        'Referenced element was deleted; remove the reference and select the current elements again'
      );
    if (reference.baselineRevisionId !== baseline.revisionId)
      throw Error(
        'Element reference is stale because the artwork changed; remove it and select the current elements again'
      );
  }
}
