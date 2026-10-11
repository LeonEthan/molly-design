import type { DesignHighlight } from '@molly/shared/design-selection-commands';

type Tone = DesignHighlight[number]['tone'];

/** Screen milliseconds a settled outline stays fully visible before fading; working never fades. */
export const HIGHLIGHT_HOLD_MS: Record<Tone, number | undefined> = {
  working: undefined,
  changed: 2400,
  outside: 6000,
};
const FADE_MS = 600;

/**
 * Outlines elements by id in screen pixels, outside the zoom transform. Geometry
 * stays local; the outline never intercepts input and never touches the document.
 */
export function createElementHighlight() {
  const style = document.createElement('style');
  style.textContent = `
.molly-highlight-layer{position:fixed;inset:0;pointer-events:none;z-index:2147483098}
.molly-highlight{position:fixed;box-sizing:border-box;border-radius:4px;pointer-events:none;transition:opacity ${FADE_MS}ms ease}
.molly-highlight[data-tone=working]{border:1.5px dashed #d9512c;background:rgb(217 81 44 / .06)}
.molly-highlight[data-tone=changed]{border:2px solid #d9512c}
.molly-highlight[data-tone=outside]{border:2px dashed #b7791f;background:rgb(183 121 31 / .08)}
.molly-highlight[data-fading=true]{opacity:0}
`;
  document.head.append(style);
  const layer = document.createElement('div');
  layer.className = 'molly-highlight-layer';
  layer.setAttribute('aria-hidden', 'true');
  document.body.append(layer);
  const boxes = new Map<string, { node: HTMLElement; id: string; timers: number[] }>();
  let frame = 0;

  const remove = (key: string) => {
    const box = boxes.get(key);
    if (!box) return;
    box.timers.forEach((timer) => window.clearTimeout(timer));
    box.node.remove();
    boxes.delete(key);
  };
  function position() {
    frame = 0;
    for (const box of boxes.values()) {
      const node = document.querySelector<HTMLElement>(
        `.ed-stage-scale [data-el-id="${CSS.escape(box.id)}"]`
      );
      const rect = node?.getBoundingClientRect();
      box.node.hidden = !rect || rect.width <= 0 || rect.height <= 0;
      if (!rect || box.node.hidden) continue;
      box.node.style.left = `${rect.left - 3}px`;
      box.node.style.top = `${rect.top - 3}px`;
      box.node.style.width = `${rect.width + 6}px`;
      box.node.style.height = `${rect.height + 6}px`;
    }
    if (boxes.size) frame = requestAnimationFrame(position);
  }

  return {
    /** Replaces only the tones named; an empty list clears every outline. */
    show(groups: DesignHighlight) {
      const tones = new Set(groups.map((group) => group.tone));
      for (const key of [...boxes.keys()])
        if (!groups.length || tones.has(key.slice(0, key.indexOf(':')) as Tone)) remove(key);
      for (const group of groups)
        for (const id of new Set(group.elementIds)) {
          const key = `${group.tone}:${id}`;
          const node = document.createElement('div');
          node.className = 'molly-highlight';
          node.dataset.tone = group.tone;
          node.hidden = true;
          layer.append(node);
          const timers: number[] = [];
          const hold = HIGHLIGHT_HOLD_MS[group.tone];
          if (hold !== undefined)
            timers.push(
              window.setTimeout(() => (node.dataset.fading = 'true'), hold),
              window.setTimeout(() => remove(key), hold + FADE_MS)
            );
          boxes.set(key, { node, id, timers });
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
}
