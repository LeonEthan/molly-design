import type { DesignHighlight } from '@molly/shared/design-selection-commands';

/** The IPC tones plus `hover`, an in-page-only tone note pins use to preview targets. */
export type HighlightTone = DesignHighlight[number]['tone'] | 'hover';
export type HighlightGroup = {
  tone: HighlightTone;
  elementIds: readonly string[];
  badge?: number;
};

/** Screen milliseconds a settled outline stays fully visible before fading; working and hover never fade. */
export const HIGHLIGHT_HOLD_MS: Record<HighlightTone, number | undefined> = {
  working: undefined,
  changed: 2400,
  outside: 6000,
  hover: undefined,
};
const FADE_MS = 600;

/**
 * Outlines elements by id in screen pixels, outside the zoom transform. Geometry
 * stays local; the outline never intercepts input and never touches the document.
 * A group may also carry a notes-run badge number, drawn once at the top-right of
 * the group's union: working shows the number, changed a check before fading.
 */
export function createElementHighlight() {
  const style = document.createElement('style');
  style.textContent = `
.molly-highlight-layer{position:fixed;inset:0;pointer-events:none;z-index:2147483098}
.molly-highlight{position:fixed;box-sizing:border-box;border-radius:4px;pointer-events:none;transition:opacity ${FADE_MS}ms ease}
.molly-highlight[data-tone=working]{border:1.5px dashed var(--signal);background:color-mix(in srgb, var(--signal) 8%, transparent)}
.molly-highlight[data-tone=changed]{border:2px solid var(--signal)}
.molly-highlight[data-tone=outside]{border:2px dashed var(--outside);background:color-mix(in srgb, var(--outside) 8%, transparent)}
.molly-highlight[data-tone=hover]{border:1.5px solid var(--signal)}
.molly-highlight[data-fading=true]{opacity:0}
.molly-highlight-badge{position:fixed;box-sizing:border-box;display:flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 5px;border-radius:999px;border:1.5px solid var(--surface);background:var(--accent);color:var(--on-accent);font:600 11px/1 Inter,system-ui,sans-serif;pointer-events:none;transition:opacity ${FADE_MS}ms ease}
.molly-highlight-badge[hidden]{display:none}
.molly-highlight-badge[data-fading=true]{opacity:0}
`;
  document.head.append(style);
  const layer = document.createElement('div');
  layer.className = 'molly-highlight-layer';
  layer.setAttribute('aria-hidden', 'true');
  document.body.append(layer);
  const boxes = new Map<
    string,
    { node: HTMLElement; ids: readonly string[]; badge?: number; timers: number[] }
  >();
  let frame = 0;

  const remove = (key: string) => {
    const box = boxes.get(key);
    if (!box) return;
    box.timers.forEach((timer) => window.clearTimeout(timer));
    box.node.remove();
    boxes.delete(key);
  };
  const rectsOf = (ids: readonly string[]) =>
    ids
      .map((id) =>
        document
          .querySelector<HTMLElement>(`.ed-stage-scale [data-el-id="${CSS.escape(id)}"]`)
          ?.getBoundingClientRect()
      )
      .filter((rect): rect is DOMRect => !!rect);
  function position() {
    frame = 0;
    for (const box of boxes.values()) {
      const rects = rectsOf(box.ids);
      if (box.badge === undefined) {
        const rect = rects[0];
        box.node.hidden = !rect || rect.width <= 0 || rect.height <= 0;
        if (!rect || box.node.hidden) continue;
        box.node.style.left = `${rect.left - 3}px`;
        box.node.style.top = `${rect.top - 3}px`;
        box.node.style.width = `${rect.width + 6}px`;
        box.node.style.height = `${rect.height + 6}px`;
        continue;
      }
      box.node.hidden = !rects.length;
      if (!rects.length) continue;
      const right = Math.max(...rects.map((rect) => rect.right));
      const top = Math.min(...rects.map((rect) => rect.top));
      box.node.style.left = `${Math.max(2, Math.min(right - 8, innerWidth - 24))}px`;
      box.node.style.top = `${Math.max(2, Math.min(top - 10, innerHeight - 24))}px`;
    }
    if (boxes.size) frame = requestAnimationFrame(position);
  }

  return {
    /** Replaces only the tones named; an empty list clears every outline. */
    show(groups: readonly HighlightGroup[]) {
      const tones = new Set(groups.map((group) => group.tone));
      for (const key of [...boxes.keys()])
        if (!groups.length || tones.has(key.slice(0, key.indexOf(':')) as HighlightTone))
          remove(key);
      for (const group of groups) {
        for (const id of new Set(group.elementIds)) {
          const key = `${group.tone}:${id}`;
          const node = document.createElement('div');
          node.className = 'molly-highlight';
          node.dataset.tone = group.tone;
          node.hidden = true;
          layer.append(node);
          boxes.set(key, track(key, node, [id], group.tone));
        }
        if (group.badge !== undefined && group.elementIds.length) {
          const key = `${group.tone}:badge:${group.badge}`;
          const node = document.createElement('div');
          node.className = 'molly-highlight-badge';
          node.textContent = group.tone === 'changed' ? '✓' : String(group.badge);
          node.hidden = true;
          layer.append(node);
          boxes.set(key, track(key, node, group.elementIds, group.tone, group.badge));
        }
      }
      cancelAnimationFrame(frame);
      frame = 0;
      position();
    },
    dispose() {
      cancelAnimationFrame(frame);
      for (const key of [...boxes.keys()]) remove(key);
      layer.remove();
      style.remove();
    },
  };

  function track(
    key: string,
    node: HTMLElement,
    ids: readonly string[],
    tone: HighlightTone,
    badge?: number
  ) {
    const timers: number[] = [];
    const hold = HIGHLIGHT_HOLD_MS[tone];
    if (hold !== undefined)
      timers.push(
        window.setTimeout(() => (node.dataset.fading = 'true'), hold),
        window.setTimeout(() => remove(key), hold + FADE_MS)
      );
    return { node, ids, badge, timers };
  }
}
