import type {
  DesignCanvasCommand,
  DesignSelectedElement,
  DesignSelectionSummary,
  DesignToolbarPresentation,
  DesignToolbarRequest,
} from '@molly/shared/design-selection-commands';

const PALETTE = [
  '#000000',
  '#6b7280',
  '#ffffff',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#78350f',
];
type Rect = { left: number; top: number; right: number; bottom: number };
/** Screen pixels: the toolbar never inherits the artwork's zoom transform. */
export function placeToolbar(
  anchor: Rect,
  width: number,
  height: number,
  viewport: { width: number; height: number }
) {
  if (
    anchor.right <= 0 ||
    anchor.bottom <= 0 ||
    anchor.left >= viewport.width ||
    anchor.top >= viewport.height
  )
    return null;
  const clamp = (value: number, max: number) => Math.max(8, Math.min(value, max - 8));
  const center = (Math.max(0, anchor.left) + Math.min(viewport.width, anchor.right)) / 2;
  return {
    left: clamp(center - width / 2, viewport.width - width),
    top: clamp(
      anchor.top >= height + 20 ? anchor.top - height - 12 : anchor.bottom + 12,
      viewport.height - height
    ),
  };
}

const paths = {
  reference:
    '<path d="M21 11a8 8 0 0 1-8 8H5l-4 3V11a8 8 0 0 1 8-8h4a8 8 0 0 1 8 8Z"/><path d="M6 8h10M6 12h7"/>',
  generate:
    '<rect x="3" y="4" width="14" height="16" rx="2"/><path d="m3 16 5-5 8 9M20 2v6M17 5h6"/>',
  edit: '<path d="m15 4 5 5M3 21l4-1L21 6l-5-5L2 15v6Z"/>',
  style:
    '<path d="M12 3a9 9 0 1 0 0 18h2a2 2 0 0 0 1-4 2 2 0 0 1 1-4h2a3 3 0 0 0 3-3c0-4-4-7-9-7Z"/><path d="M7 8h.01M12 6h.01M17 8h.01M5 13h.01"/>',
  regenerate: '<path d="M20 7v5h-5M4 17v-5h5M5 7a8 8 0 0 1 14-1l1 6M4 12l1 6a8 8 0 0 0 14-1"/>',
  bold: '<path d="M6 3h7a5 5 0 0 1 0 9H6Zm0 9h8a5 5 0 0 1 0 9H6Z"/>',
  italic: '<path d="M10 3h10M4 21h10M15 3 9 21"/>',
  crop: '<path d="M6 2v16h16M2 6h16v16M20 2 2 20"/>',
};
const svg = (path: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;

export function createSelectionToolbar(options: {
  request(input: DesignToolbarRequest): Promise<{ ok: boolean; error?: string }>;
}) {
  let summary: DesignSelectionSummary = { count: 0, kinds: [] };
  let ids: string[] = [];
  let epoch = 0;
  let readonly = true;
  let presentation: DesignToolbarPresentation | undefined;
  let busy = false;
  let dragging = false;
  let pointer: { x: number; y: number } | undefined;
  let frame = 0;
  let generation = 0;
  let popup: HTMLElement | undefined;
  let popupTrigger: HTMLButtonElement | undefined;
  let signature = '';
  let renderPending = false;
  const controller = new AbortController();
  const signal = controller.signal;
  const style = document.createElement('style');
  style.textContent = `
.molly-selection-toolbar,.molly-selection-popup,.molly-selection-tooltip{--surface:#fff;--ink:#242424;--muted:#f2f2f2;--line:#e4e4e4;position:fixed;z-index:2147483100;background:var(--surface);color:var(--ink);border:1px solid var(--line);box-shadow:0 5px 20px #0002;border-radius:9px;font:12px Inter,system-ui,sans-serif;box-sizing:border-box;color-scheme:light}
[data-molly-toolbar][data-dark=true]{--surface:#262626;--ink:#ededed;--muted:#373737;--line:#464646;color-scheme:dark}
.molly-selection-toolbar{display:flex;align-items:center;gap:2px;padding:5px;max-width:calc(100vw - 16px);overflow-x:auto;scrollbar-width:thin}
[data-molly-toolbar][hidden]{display:none!important}
[data-molly-toolbar] button,[data-molly-toolbar] input{font:inherit;color:inherit;box-sizing:border-box}
[data-molly-toolbar] button{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:0;border-radius:5px;background:transparent;min-width:30px;height:30px;padding:0 7px;white-space:nowrap;cursor:pointer;flex:none}
[data-molly-toolbar] button:hover,[data-molly-toolbar] button[aria-pressed=true],[data-molly-toolbar] button[aria-expanded=true]{background:var(--muted)}
[data-molly-toolbar] button:disabled,[data-molly-toolbar] input:disabled{opacity:.4;cursor:default}
[data-molly-toolbar] :focus-visible{outline:2px solid #6195ed;outline-offset:-2px}
[data-molly-toolbar] svg{height:15px;width:15px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
[data-molly-toolbar] input{height:28px;min-width:0;width:51px;border:0;border-radius:4px;background:var(--muted);padding:0 5px;text-align:center}
[data-molly-toolbar] input[type=number]{appearance:textfield;-moz-appearance:textfield}
[data-molly-toolbar] input::-webkit-inner-spin-button{appearance:none}
[data-molly-toolbar] .field{display:flex;align-items:center;gap:3px;padding:0 3px;flex:none}
[data-molly-toolbar] .field>span{font-size:10px;opacity:.6}
[data-molly-toolbar] .count{display:flex;align-items:center;justify-content:center;min-width:22px;height:22px;padding:0 5px;border-radius:4px;background:var(--ink);color:var(--surface);flex:none;margin:0 4px}
[data-molly-toolbar] .sep{height:18px;width:1px;background:var(--line);margin:0 4px;flex:none}
[data-molly-toolbar] .swatch{width:17px;height:17px;border:1px solid #8886;border-radius:50%;display:block}
.molly-selection-popup{z-index:2147483101;padding:8px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);overflow:auto;min-width:150px}
.molly-selection-popup .choices{display:flex;flex-direction:column;gap:2px}
.molly-selection-popup .choices button{justify-content:flex-start;width:100%}
.molly-selection-popup .palette{display:grid;grid-template-columns:repeat(6,26px);gap:3px;margin-bottom:8px}
.molly-selection-popup .palette button{min-width:26px;width:26px;height:26px;padding:3px}
.molly-selection-popup .crop-fields{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px}
.molly-selection-popup .crop-fields label{display:flex;flex-direction:column;gap:5px}
.molly-selection-popup .crop-fields input{width:88px}
.molly-selection-popup input[type=color]{padding:2px;width:45px;vertical-align:middle}
.molly-selection-tooltip{z-index:2147483102;padding:6px 9px;pointer-events:none;max-width:calc(100vw - 16px)}
.molly-selection-error{color:#ef6464;max-width:220px;white-space:normal;padding:4px 8px;flex:none;font-size:11px}
`;
  document.head.append(style);
  const bar = document.createElement('div');
  bar.className = 'molly-selection-toolbar';
  bar.dataset.mollyToolbar = '';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Selection');
  bar.hidden = true;
  const tooltip = document.createElement('div');
  tooltip.className = 'molly-selection-tooltip';
  tooltip.dataset.mollyToolbar = '';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  document.body.append(bar, tooltip);
  const label = (key: string, fallback: string) => presentation?.labels[key] ?? fallback;
  const closePopup = (focus = false) => {
    popup?.remove();
    popup = undefined;
    popupTrigger?.setAttribute('aria-expanded', 'false');
    if (focus) popupTrigger?.focus();
    popupTrigger = undefined;
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(position);
  };
  function position() {
    frame = 0;
    const nodes = ids.map((id) =>
      document.querySelector<HTMLElement>(`.ed-stage-scale [data-el-id="${CSS.escape(id)}"]`)
    );
    const rects = nodes
      .filter((node): node is HTMLElement => !!node)
      .map((node) => node.getBoundingClientRect());
    if (readonly || !presentation || dragging || !summary.count || !rects.length) {
      bar.hidden = true;
      closePopup();
      tooltip.hidden = true;
      return;
    }
    const anchor = {
      left: Math.min(...rects.map((r) => r.left)),
      top: Math.min(...rects.map((r) => r.top)),
      right: Math.max(...rects.map((r) => r.right)),
      bottom: Math.max(...rects.map((r) => r.bottom)),
    };
    bar.hidden = false;
    const place = placeToolbar(anchor, bar.offsetWidth, bar.offsetHeight, {
      width: innerWidth,
      height: innerHeight,
    });
    if (!place) {
      bar.hidden = true;
      closePopup();
      tooltip.hidden = true;
      return;
    }
    bar.style.left = `${place.left}px`;
    bar.style.top = `${place.top}px`;
    if (popup && popupTrigger) positionPopup(popup, popupTrigger);
  }
  function positionPopup(node: HTMLElement, trigger: HTMLElement) {
    const rect = trigger.getBoundingClientRect();
    const place = placeToolbar(rect, node.offsetWidth, node.offsetHeight, {
      width: innerWidth,
      height: innerHeight,
    });
    if (place) {
      node.style.left = `${place.left}px`;
      node.style.top = `${place.top}px`;
    }
  }
  const error = (message: string) => {
    bar.querySelector('[role=alert]')?.remove();
    const node = document.createElement('span');
    node.className = 'molly-selection-error';
    node.setAttribute('role', 'alert');
    node.textContent = message;
    bar.append(node);
    schedule();
  };
  const request = async (input: DesignToolbarRequest) => {
    if (readonly || busy) return;
    const mine = generation;
    busy = true;
    closePopup();
    tooltip.hidden = true;
    bar.setAttribute('aria-busy', 'true');
    bar
      .querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button')
      .forEach((node) => (node.disabled = true));
    let message: string | undefined;
    try {
      const result = await options.request(input);
      if (!result.ok) message = result.error ?? 'Canvas command failed';
    } catch (cause) {
      message = String(cause);
    }
    if (mine !== generation) return;
    busy = false;
    bar.setAttribute('aria-busy', 'false');
    render(true);
    if (message) error(message);
  };
  const command = (value: DesignCanvasCommand) =>
    void request({ type: 'command', selectionEpoch: epoch, command: value });
  function button(
    parent: HTMLElement,
    text: string,
    name: string,
    click: () => void,
    icon = false
  ) {
    const createdEpoch = epoch;
    const node = document.createElement('button');
    node.type = 'button';
    node.setAttribute('aria-label', name);
    if (icon) node.innerHTML = svg(text);
    else node.textContent = text;
    node.disabled = busy;
    node.addEventListener('click', () => {
      if (createdEpoch === epoch && !readonly) click();
    });
    parent.append(node);
    return node;
  }
  function openPopup(trigger: HTMLButtonElement, name: string, fill: (node: HTMLElement) => void) {
    if (popupTrigger === trigger) {
      closePopup();
      return;
    }
    closePopup();
    tooltip.hidden = true;
    popupTrigger = trigger;
    trigger.setAttribute('aria-expanded', 'true');
    popup = document.createElement('div');
    popup.className = 'molly-selection-popup';
    popup.dataset.mollyToolbar = '';
    popup.dataset.dark = String(presentation?.dark ?? false);
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', name);
    fill(popup);
    document.body.append(popup);
    shield(popup);
    positionPopup(popup, trigger);
    popup.querySelector<HTMLElement>('button,input')?.focus();
  }
  function number(
    parent: HTMLElement,
    name: string,
    prefix: string,
    value: number | undefined,
    min: number,
    max: number,
    commit: (value: number) => void
  ) {
    const createdEpoch = epoch;
    const wrap = document.createElement('label');
    wrap.className = 'field';
    if (prefix) {
      const span = document.createElement('span');
      span.textContent = prefix;
      wrap.append(span);
    }
    const input = document.createElement('input');
    input.type = 'number';
    input.value = value === undefined ? '' : String(Math.round(value * 1000) / 1000);
    input.min = String(min);
    input.max = String(max);
    input.step = 'any';
    input.setAttribute('aria-label', name);
    input.onblur = () => {
      if (createdEpoch !== epoch || readonly) return;
      const next = Number(input.value);
      if (
        input.value.trim() &&
        Number.isFinite(next) &&
        next >= min &&
        next <= max &&
        next !== value
      )
        commit(next);
      else input.value = value === undefined ? '' : String(value);
    };
    input.onkeydown = (event) => {
      if (event.key === 'Enter') input.blur();
      if (event.key === 'Escape') {
        input.value = value === undefined ? '' : String(value);
        input.blur();
      }
    };
    wrap.append(input);
    parent.append(wrap);
    return input;
  }
  function color(
    key: string,
    fallback: string,
    value: string | null | undefined,
    allowNone: boolean,
    commit: (value: string | null) => void
  ) {
    const name = label(key, fallback);
    const trigger = button(bar, '', name, () =>
      openPopup(trigger, name, (node) => {
        const palette = document.createElement('div');
        palette.className = 'palette';
        for (const hex of PALETTE) {
          const item = button(palette, '', hex, () => commit(hex));
          item.setAttribute('aria-pressed', String(value === hex));
          const dot = document.createElement('span');
          dot.className = 'swatch';
          dot.style.background = hex;
          item.append(dot);
        }
        node.append(palette);
        const custom = document.createElement('input');
        custom.type = 'color';
        custom.setAttribute('aria-label', label('customColor', 'Custom color'));
        custom.value = value?.slice(0, 7) ?? '#000000';
        custom.onchange = () => commit(custom.value);
        node.append(custom);
        if (allowNone)
          button(node, label('colorNone', 'None'), label('colorNone', 'None'), () => commit(null));
      })
    );
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', 'false');
    const dot = document.createElement('span');
    dot.className = 'swatch';
    dot.style.background =
      value ?? 'linear-gradient(135deg,#fff 44%,#ef4444 45%,#ef4444 55%,#fff 56%)';
    trigger.append(dot);
  }
  function choices(
    key: string,
    fallback: string,
    value: string | undefined,
    items: [string, string][],
    commit: (value: string) => void
  ) {
    const name = label(key, fallback);
    const trigger = button(
      bar,
      `${items.find((item) => item[0] === value)?.[1] ?? name} ⌄`,
      name,
      () => {
        // A choice popup with zero entries is a dead end; keep it closed.
        if (items.length === 0) return;
        openPopup(trigger, name, (node) => {
          const list = document.createElement('div');
          list.className = 'choices';
          for (const [item, title] of items) {
            const b = button(list, title, title, () => commit(item));
            b.setAttribute('aria-pressed', String(item === value));
          }
          node.append(list);
        });
      }
    );
    if (items.length === 0) trigger.disabled = true;
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', 'false');
  }
  function crop(current: DesignSelectedElement) {
    const name = label('crop', 'Crop');
    const trigger = button(
      bar,
      paths.crop,
      name,
      () =>
        openPopup(trigger, name, (node) => {
          const grid = document.createElement('div');
          grid.className = 'crop-fields';
          const fields = ['Left', 'Top', 'Right', 'Bottom'].map((edge, i) => {
            const wrap = document.createElement('label');
            wrap.textContent = label(`crop${edge}`, edge);
            const input = document.createElement('input');
            input.type = 'number';
            input.step = '0.01';
            input.min = '-10';
            input.max = '0.999999';
            input.value = String(current.crop?.[i] ?? 0);
            input.setAttribute('aria-label', wrap.textContent);
            wrap.append(input);
            grid.append(wrap);
            return input;
          });
          node.append(grid);
          const apply = button(node, label('applyCrop', 'Apply'), label('applyCrop', 'Apply'), () =>
            command({
              verb: 'image-crop',
              crop: fields.map((input) => Number(input.value)) as [number, number, number, number],
            })
          );
          const validate = () => {
            const [l, t, r, b] = fields.map((input) => Number(input.value));
            apply.disabled =
              fields.some((input) => !input.value.trim() || !input.checkValidity()) ||
              l + r >= 1 ||
              t + b >= 1;
          };
          fields.forEach((input) => (input.oninput = validate));
          validate();
          button(node, label('resetCrop', 'Reset'), label('resetCrop', 'Reset'), () =>
            command({ verb: 'image-crop', crop: null })
          );
        }),
      true
    );
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', 'false');
  }
  function render(force = false) {
    if (
      !force &&
      (busy || bar.contains(document.activeElement) || popup?.contains(document.activeElement))
    ) {
      renderPending = true;
      schedule();
      return;
    }
    const next = JSON.stringify([summary, presentation]);
    if (!force && next === signature) {
      schedule();
      return;
    }
    signature = next;
    bar.setAttribute('aria-busy', String(busy));
    renderPending = false;
    closePopup();
    bar.replaceChildren();
    bar.dataset.dark = tooltip.dataset.dark = String(presentation?.dark ?? false);
    bar.setAttribute(
      'aria-label',
      label('selectedElements', 'Selected elements ({{count}})').replace(
        '{{count}}',
        String(summary.count)
      )
    );
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = String(summary.count);
    count.setAttribute(
      'aria-label',
      label('selectionCount', '{{count}} item(s)').replace('{{count}}', String(summary.count))
    );
    bar.append(count);
    const action = (
      name: 'reference' | 'generate' | 'edit' | 'style' | 'regenerate',
      key: string,
      fallback: string
    ) => {
      const b = button(
        bar,
        paths[name],
        label(key, fallback),
        () => void request({ type: 'action', selectionEpoch: epoch, action: name }),
        true
      );
      b.disabled = busy || !presentation?.actionsEnabled;
    };
    const separator = () => {
      const node = document.createElement('span');
      node.className = 'sep';
      bar.append(node);
    };
    action('reference', 'referenceSelection', 'Reference selected elements');
    separator();
    const kind = summary.kinds.length === 1 ? summary.kinds[0] : undefined;
    const current = summary.elements?.find((element) => element.kind === kind);
    const typed = current && kind !== 'table' && kind !== 'chart' && summary.count <= 8;
    if (!typed || kind === 'image') {
      action('generate', 'generateSelectedImages', 'Generate selected images');
      action('edit', 'editSelectedImages', 'Edit selected images');
      action('style', 'adjustSelectedStyle', 'Adjust selected style');
      action('regenerate', 'regenerateSelection', 'Regenerate selection');
      if (typed) separator();
    }
    if (typed) {
      const c = current;
      if (c.x !== undefined && c.y !== undefined) {
        number(bar, label('positionX', 'Position X'), 'X', c.x, 0, 4096, (x) =>
          command({ verb: 'position', x, y: c.y! })
        );
        number(bar, label('positionY', 'Position Y'), 'Y', c.y, 0, 4096, (y) =>
          command({ verb: 'position', x: c.x!, y })
        );
        separator();
      }
      if (kind === 'text') {
        color('textColor', 'Text color', c.color, false, (value) => {
          if (value) command({ verb: 'text-style', color: value });
        });
        choices(
          'fontFamily',
          'Font',
          c.fontFamily,
          [
            ...new Set([c.fontFamily, ...(summary.fonts ?? [])].filter((f): f is string => !!f)),
          ].map((f) => [f, f]),
          (fontFamily) => command({ verb: 'text-style', fontFamily })
        );
        number(bar, label('fontSize', 'Font size'), '', c.fontSize, 1, 1000, (fontSize) =>
          command({ verb: 'text-style', fontSize })
        );
        for (const key of ['bold', 'italic'] as const) {
          const b = button(
            bar,
            paths[key],
            label(key, key === 'bold' ? 'Bold' : 'Italic'),
            () => command({ verb: 'text-style', [key]: !c[key] }),
            true
          );
          b.setAttribute('aria-pressed', String(c[key] === true));
        }
        for (const align of ['left', 'center', 'right', 'justify'] as const) {
          const x = align === 'center' ? 6 : align === 'right' ? 9 : 3;
          const path = `<path d="M3 5h18M${x} 10h${align === 'justify' ? 18 : 12}M3 15h18M${x} 20h${align === 'justify' ? 18 : 12}"/>`;
          const b = button(
            bar,
            path,
            label(`align${align[0].toUpperCase()}${align.slice(1)}`, `Align ${align}`),
            () => command({ verb: 'text-style', alignH: align }),
            true
          );
          b.setAttribute('aria-pressed', String(c.alignH === align));
        }
      }
      if (kind === 'shape' || kind === 'icon')
        color('fillColor', 'Fill', c.fill, true, (fill) => command({ verb: 'fill', fill }));
      if (kind === 'shape' || kind === 'line')
        color('strokeColor', 'Stroke', c.borderColor, true, (stroke) =>
          command({ verb: 'border', color: stroke })
        );
      if (kind === 'shape') {
        number(bar, label('elementWidth', 'Width'), 'W', c.width, 1, 100000, (width) =>
          command({ verb: 'size', width, height: c.height ?? width })
        );
        number(bar, label('elementHeight', 'Height'), 'H', c.height, 1, 100000, (height) =>
          command({ verb: 'size', width: c.width ?? height, height })
        );
      }
      if (kind === 'line')
        choices(
          'lineArrows',
          'Arrowheads',
          c.arrowStart && c.arrowEnd ? 'both' : c.arrowEnd ? 'end' : 'none',
          [
            ['none', label('arrowsNone', 'None')],
            ['end', label('arrowsEnd', 'End')],
            ['both', label('arrowsBoth', 'Both ends')],
          ],
          (preset) => command({ verb: 'line-arrow', preset: preset as 'none' | 'end' | 'both' })
        );
      if (kind === 'image') {
        choices(
          'imageFit',
          'Image fit',
          c.fit,
          ['fill', 'contain', 'cover'].map((fit) => [
            fit,
            label(`imageFit${fit[0].toUpperCase()}${fit.slice(1)}`, fit),
          ]),
          (fit) => command({ verb: 'image-fit', fit: fit as 'fill' | 'contain' | 'cover' })
        );
        crop(c);
      }
    }
    schedule();
  }
  function shield(node: HTMLElement) {
    // Stop canvas bubble listeners; its capture-phase exclusions are assembled in build.mjs.
    for (const type of ['pointerdown', 'mousedown', 'dblclick', 'keydown', 'keyup', 'wheel'])
      node.addEventListener(type, (event) => event.stopPropagation(), { signal });
    node.addEventListener(
      'mousedown',
      (event) => {
        if ((event.target as Element).closest('button')) event.preventDefault();
      },
      { signal }
    );
    node.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          closePopup(true);
          tooltip.hidden = true;
        }
      },
      { signal }
    );
    node.addEventListener(
      'focusout',
      () =>
        queueMicrotask(() => {
          if (
            renderPending &&
            !bar.contains(document.activeElement) &&
            !popup?.contains(document.activeElement)
          )
            render();
        }),
      { signal }
    );
    node.addEventListener(
      'pointerover',
      (event) => {
        const target = (event.target as Element).closest<HTMLButtonElement>('button');
        if (!target || popup || dragging) return;
        tooltip.textContent = target.getAttribute('aria-label');
        tooltip.hidden = false;
        positionPopup(tooltip, target);
      },
      { signal }
    );
    node.addEventListener('pointerleave', () => (tooltip.hidden = true), { signal });
  }
  shield(bar);
  document.addEventListener(
    'pointerdown',
    (event) => {
      if ((event.target as Element)?.closest('[data-molly-toolbar]')) return;
      closePopup();
      tooltip.hidden = true;
      pointer = { x: event.clientX, y: event.clientY };
    },
    { capture: true, signal }
  );
  document.addEventListener(
    'pointermove',
    (event) => {
      if (pointer && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 3) {
        dragging = true;
        schedule();
      }
    },
    { capture: true, signal }
  );
  const end = () => {
    pointer = undefined;
    dragging = false;
    schedule();
  };
  window.addEventListener('pointerup', end, { capture: true, signal });
  window.addEventListener('pointercancel', end, { capture: true, signal });
  window.addEventListener('blur', end, { signal });
  window.addEventListener('resize', schedule, { signal });
  document.addEventListener(
    'scroll',
    () => {
      tooltip.hidden = true;
      schedule();
    },
    { capture: true, signal }
  );
  const observer = new MutationObserver((records) => {
    if (
      records.some(
        (record) =>
          record.target instanceof Element &&
          (record.target.closest('.ed-stage-scale,.ed-canvas') ||
            [...record.addedNodes].some(
              (node) => node instanceof Element && node.matches('.ed-stage-scale')
            ))
      )
    )
      schedule();
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['style', 'class'],
  });
  const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
  resize?.observe(bar);
  return {
    update(next: DesignSelectionSummary, selectedIds: string[], selectionEpoch: number) {
      if (epoch !== selectionEpoch) {
        generation++;
        bar.hidden = true;
        busy = false;
        closePopup();
        signature = '';
        renderPending = false;
      }
      const changed = epoch !== selectionEpoch;
      epoch = selectionEpoch;
      ids = selectedIds;
      summary = next;
      render(changed);
    },
    setReadonly(value: boolean) {
      readonly = value;
      if (value) closePopup();
      render(true);
    },
    present(value: DesignToolbarPresentation) {
      presentation = value;
      // Theme changes must apply even while a field or popup retains focus.
      bar.dataset.dark = tooltip.dataset.dark = String(value.dark);
      if (popup) popup.dataset.dark = String(value.dark);
      document.documentElement.style.colorScheme = value.dark ? 'dark' : 'light';
      render();
    },
    refresh: schedule,
    dispose() {
      controller.abort();
      observer.disconnect();
      resize?.disconnect();
      cancelAnimationFrame(frame);
      closePopup();
      bar.remove();
      tooltip.remove();
      style.remove();
    },
  };
}
