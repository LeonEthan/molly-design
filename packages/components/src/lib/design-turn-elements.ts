import { readDesignElementReferences } from '@molly/shared/design-element-reference';
import type { ConversationView } from '@/lib/conversation-view/types';

function collectStrings(value: unknown, into: string[]) {
  if (typeof value === 'string') into.push(value);
  else if (Array.isArray(value)) for (const item of value) collectStrings(item, into);
  else if (value && typeof value === 'object')
    for (const item of Object.values(value)) collectStrings(item, into);
}

/** Element ids a turn referenced; a malformed or absent reference contributes none. */
export function designElementIdsInTurn(turn: unknown): string[] {
  const texts: string[] = [];
  collectStrings((turn as { items?: unknown } | undefined)?.items, texts);
  const ids = new Set<string>();
  for (const text of texts) {
    if (!text.includes('<molly-elements>')) continue;
    try {
      for (const reference of readDesignElementReferences(text))
        reference.elementIds.forEach((id) => ids.add(id));
    } catch {
      continue;
    }
  }
  return [...ids];
}

/**
 * A turn without element references owns every change. With references, changed
 * elements outside them are reported separately; this is advisory, never enforced.
 */
export function splitDesignChanges(
  changes: { changed: readonly string[]; removed: readonly string[] },
  referenced: readonly string[]
) {
  if (!referenced.length) return { inside: [...changes.changed], outside: [], removedOutside: 0 };
  const targets = new Set(referenced);
  return {
    inside: changes.changed.filter((id) => targets.has(id)),
    outside: changes.changed.filter((id) => !targets.has(id)),
    removedOutside: changes.removed.filter((id) => !targets.has(id)).length,
  };
}

/** Reads the user turn that owns `turnId` (itself, or the user turn before an assistant turn). */
export async function readDesignTurnElementIds(
  view: ConversationView | null | undefined,
  turnId: string
): Promise<string[]> {
  if (!view) return [];
  let index = view.indexOf(turnId);
  while (index >= 0 && view.index(index)?.role !== 'user') index -= 1;
  if (index < 0) return [];
  const range = view.acquireRange(index, index + 1);
  try {
    await range.ready;
    return designElementIdsInTurn(view.turn(index));
  } finally {
    range.release();
  }
}
