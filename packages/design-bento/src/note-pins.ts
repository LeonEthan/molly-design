import {
  DESIGN_ASK_PROMPT_MAX,
  DESIGN_NOTES_MAX,
  type DesignToolbarPresentation,
  type DesignToolbarRequest,
} from '@molly/shared/design-selection-commands';
import { arrowUpIcon, renderUiIconSvg, xIcon } from '@molly/shared/ui-icons';
import type { HighlightGroup } from './element-highlight';

type Pin = { elementIds: string[]; text: string };

const EDITOR_LINE_CAP = 4;

/**
 * Numbered notes pinned to elements, sent to Molly together as one turn. Pins are
 * screen-only canvas state keyed by element id: they never touch the document, and
 * the request carries only the notes epoch so main reads and validates the targets.
 */
export function createNotePins(options: {
  request(input: DesignToolbarRequest): Promise<{ ok: boolean; error?: string }>;
  selectedIds(): readonly string[];
  elementIds(): readonly string[];
  highlight?: { show(groups: readonly HighlightGroup[]): void };
}) {
  let pins: Pin[] = [];
  let epoch = 0;
  let readonly = true;
  let presentation: DesignToolbarPresentation | undefined;
  let busy = false;
  let message = '';
  let editing: { pin: Pin; node: HTMLElement } | undefined;
  let hovered = false;
  let frame = 0;
  let press: { x: number; y: number } | undefined;
  const controller = new AbortController();
  const signal = controller.signal;
  const label = (key: string, fallback: string, count?: number) =>
    (presentation?.labels[key] ?? fallback).replace('{{count}}', String(count ?? ''));
  const style = document.createElement('style');
  style.textContent = `
.molly-note-pin{position:fixed;z-index:2147483099;display:flex;align-items:center;justify-content:center;width:28px;height:28px;min-width:0!important;padding:0!important;box-sizing:border-box;border-radius:50%!important;border:2px solid var(--surface);background:var(--accent)!important;color:var(--on-accent)!important;font:600 12px/1 Inter,system-ui,sans-serif!important;box-shadow:0 2px 8px rgb(0 0 0 / .22);cursor:pointer;transition:transform .12s ease,box-shadow .12s ease}
.molly-note-pin[aria-expanded=true]{transform:scale(1.12);box-shadow:0 6px 16px rgb(0 0 0 / .3)}
.molly-note-tray{position:fixed;left:50%;bottom:calc(var(--molly-dock-bottom,18px) + var(--molly-dock-height,52px) + 12px);transform:translateX(-50%);z-index:2147483099;display:flex;align-items:center;gap:8px;padding:6px 6px 6px 14px;max-width:calc(100vw - 16px);border-radius:999px;background:var(--ink);color:var(--surface);border:1px solid var(--line);box-shadow:0 6px 20px rgb(0 0 0 / .22);font:12px Inter,system-ui,sans-serif;box-sizing:border-box}
.molly-note-tray :focus-visible{outline-color:var(--surface)}
.molly-note-tray .send{height:28px;padding:0 14px;border-radius:999px;background:var(--surface)!important;color:var(--ink)!important;font-weight:600}
.molly-note-tray .send:hover{background:var(--surface)!important;opacity:.9}
.molly-note-tray .clear{width:28px;min-width:28px;height:28px;padding:0;border-radius:50%;color:var(--surface)}
.molly-note-tray .clear:hover{background:color-mix(in srgb, var(--surface) 14%, transparent)}
.molly-note-tray .clear svg{width:14px;height:14px}
.molly-note-tray .molly-selection-error{max-width:260px}
.molly-note-editor{position:fixed;z-index:2147483101;display:flex;align-items:flex-end;gap:6px;width:min(320px,calc(100vw - 16px));padding:6px 6px 6px 14px;border-radius:999px;background:var(--surface);color:var(--ink);border:1px solid var(--line);box-shadow:0 6px 20px rgb(0 0 0 / .12);box-sizing:border-box;font:12px Inter,system-ui,sans-serif}
.molly-note-editor textarea{flex:1;min-width:0;display:block;border:0;background:transparent;color:inherit;font:13px/1.45 Inter,system-ui,sans-serif;padding:6px 0;outline:none;resize:none;overflow:hidden}
.molly-note-editor .save{width:30px;min-width:30px;height:30px;flex:none;padding:0!important;border-radius:50%!important;background:var(--accent)!important;color:var(--on-accent)!important}
.molly-note-editor .save:hover{background:var(--accent)!important;opacity:.88}
.molly-note-editor .save svg{width:16px;height:16px;stroke-width:1.8}
.molly-note-tooltip{position:fixed;z-index:2147483102;max-width:min(320px,calc(100vw - 16px));box-sizing:border-box;padding:7px 10px;border-radius:10px;background:var(--ink);color:var(--surface);box-shadow:0 6px 20px rgb(0 0 0 / .18);font:12px/1.4 Inter,system-ui,sans-serif;pointer-events:none;white-space:pre-wrap;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical}
.molly-note-tooltip[hidden]{display:none}
`;
  document.head.append(style);
  const layer = document.createElement('div');
  layer.className = 'molly-note-layer';
  const tray = document.createElement('div');
  tray.className = 'molly-note-tray';
  tray.dataset.mollyToolbar = '';
  tray.setAttribute('role', 'region');
  tray.hidden = true;
  const tooltip = document.createElement('div');
  tooltip.className = 'molly-note-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  document.body.append(layer, tray, tooltip);
  for (const node of [layer, tray])
    for (const type of ['pointerdown', 'mousedown', 'dblclick', 'keydown', 'keyup', 'wheel'])
      node.addEventListener(type, (event) => event.stopPropagation(), { signal });

  const nodeFor = (id: string) =>
    document.querySelector<HTMLElement>(`.ed-stage-scale [data-el-id="${CSS.escape(id)}"]`);
  const changed = () => {
    epoch++;
    message = '';
    render();
  };
  const prune = () => {
    const present = new Set(options.elementIds());
    if (pins.every((pin) => pin.elementIds.every((id) => present.has(id)))) return false;
    for (const pin of pins) pin.elementIds = pin.elementIds.filter((id) => present.has(id));
    if (editing && !editing.pin.elementIds.length) {
      editing.node.remove();
      editing = undefined;
    }
    pins = pins.filter((pin) => pin.elementIds.length);
    epoch++;
    return true;
  };
  const sameTargets = (a: Pin, b: Pin) =>
    a.elementIds.length === b.elementIds.length &&
    a.elementIds.every((id) => b.elementIds.includes(id));
  const clearHover = () => {
    if (!hovered) return;
    hovered = false;
    tooltip.hidden = true;
    options.highlight?.show([{ tone: 'hover', elementIds: [] }]);
  };
  function position() {
    frame = 0;
    if (!pins.length) return;
    if (prune()) return render();
    const markers = [...layer.children] as HTMLElement[];
    pins.forEach((pin, index) => {
      const marker = markers[index];
      const rects = pin.elementIds
        .map(nodeFor)
        .filter((node): node is HTMLElement => !!node)
        .map((node) => node.getBoundingClientRect());
      if (!marker) return;
      marker.hidden = readonly || !rects.length;
      if (marker.hidden) return;
      const right = Math.max(...rects.map((rect) => rect.right));
      const top = Math.min(...rects.map((rect) => rect.top));
      marker.style.left = `${Math.max(4, Math.min(right - 8, innerWidth - 32))}px`;
      marker.style.top = `${Math.max(4, Math.min(top - 14, innerHeight - 32))}px`;
    });
    if (editing) placeEditor();
    frame = requestAnimationFrame(position);
  }
  const button = (parent: HTMLElement, text: string, click: () => void, className = '') => {
    const node = document.createElement('button');
    node.type = 'button';
    node.textContent = text;
    node.setAttribute('aria-label', text);
    if (className) node.className = className;
    node.addEventListener('click', click, { signal });
    parent.append(node);
    return node;
  };
  function render() {
    clearHover();
    layer.replaceChildren();
    tray.replaceChildren();
    pins.forEach((pin, index) => {
      const marker = document.createElement('button');
      marker.type = 'button';
      marker.className = 'molly-note-pin';
      marker.dataset.mollyToolbar = '';
      marker.textContent = String(index + 1);
      marker.setAttribute(
        'aria-label',
        `${label('notePin', 'Note {{count}}', index + 1)}: ${pin.text}`
      );
      marker.setAttribute('aria-haspopup', 'dialog');
      marker.setAttribute('aria-expanded', String(editing?.pin === pin));
      marker.hidden = true;
      marker.addEventListener('pointerdown', (event) => event.stopPropagation(), { signal });
      marker.addEventListener('click', () => !readonly && !busy && openEditor(pin), {
        signal,
      });
      marker.addEventListener(
        'pointerenter',
        () => {
          if (readonly || busy) return;
          hovered = true;
          options.highlight?.show([{ tone: 'hover', elementIds: pin.elementIds }]);
          if (!pin.text.trim()) return;
          tooltip.textContent = pin.text;
          tooltip.hidden = false;
          const anchor = marker.getBoundingClientRect();
          const left = anchor.left + anchor.width / 2 - tooltip.offsetWidth / 2;
          tooltip.style.left = `${Math.max(8, Math.min(left, innerWidth - tooltip.offsetWidth - 8))}px`;
          const above = anchor.top - tooltip.offsetHeight - 8;
          tooltip.style.top = `${above >= 8 ? above : anchor.bottom + 8}px`;
        },
        { signal }
      );
      marker.addEventListener('pointerleave', clearHover, { signal });
      layer.append(marker);
    });
    tray.hidden = readonly || !pins.length || !presentation;
    if (!tray.hidden) {
      const count =
        pins.length === 1
          ? label('notesCountOne', '1 comment')
          : label('notesCount', '{{count}} comments', pins.length);
      tray.setAttribute('aria-label', count);
      const labelNode = document.createElement('span');
      labelNode.textContent = count;
      tray.append(labelNode);
      const send = button(tray, label('notesSend', 'Send'), () => void sendAll(), 'send');
      send.disabled = busy || !presentation?.actionsEnabled;
      const clearLabel = label('notesClear', 'Clear all notes');
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'clear';
      clear.innerHTML = renderUiIconSvg(xIcon, { size: 14 });
      clear.setAttribute('aria-label', clearLabel);
      clear.title = clearLabel;
      clear.disabled = busy;
      clear.addEventListener(
        'click',
        () => {
          closeEditor(false);
          pins = [];
          changed();
        },
        { signal }
      );
      tray.append(clear);
    }
    if (message && !tray.hidden) {
      const error = document.createElement('span');
      error.className = 'molly-selection-error';
      error.setAttribute('role', 'alert');
      error.textContent = message;
      tray.append(error);
    }
    cancelAnimationFrame(frame);
    frame = 0;
    position();
  }
  async function sendAll() {
    if (readonly || busy || !pins.length) return;
    closeEditor(false);
    busy = true;
    render();
    let failure = '';
    try {
      const result = await options.request({ type: 'notes', notesEpoch: epoch });
      if (!result.ok) failure = result.error ?? 'Canvas request failed';
    } catch (cause) {
      failure = String(cause);
    }
    if (!failure) return;
    busy = false;
    message = failure;
    render();
  }
  function placeEditor() {
    if (!editing) return;
    const marker = layer.children[pins.indexOf(editing.pin)] as HTMLElement | undefined;
    const anchor = marker && !marker.hidden ? marker.getBoundingClientRect() : undefined;
    if (!anchor) return;
    const { node } = editing;
    node.style.left = `${Math.max(8, Math.min(anchor.right + 8, innerWidth - node.offsetWidth - 8))}px`;
    node.style.top = `${Math.max(8, Math.min(anchor.top + anchor.height / 2 - node.offsetHeight / 2, innerHeight - node.offsetHeight - 8))}px`;
  }
  function closeEditor(focusMarker: boolean) {
    if (!editing) return;
    const { pin, node } = editing;
    editing = undefined;
    node.remove();
    if (!pin.text.trim() && pins.includes(pin)) {
      pins = pins.filter((item) => item !== pin);
      changed();
      return;
    }
    render();
    if (focusMarker) (layer.children[pins.indexOf(pin)] as HTMLElement | undefined)?.focus();
  }
  function openEditor(pin: Pin) {
    if (editing?.pin === pin) return;
    closeEditor(false);
    clearHover();
    const node = document.createElement('div');
    node.className = 'molly-note-editor';
    node.dataset.mollyToolbar = '';
    node.setAttribute('role', 'dialog');
    const name = label('notePin', 'Note {{count}}', pins.indexOf(pin) + 1);
    node.setAttribute('aria-label', name);
    const field = document.createElement('textarea');
    field.rows = 1;
    field.maxLength = DESIGN_ASK_PROMPT_MAX;
    field.value = pin.text;
    field.placeholder = label('notePlaceholder', 'What should change here?');
    field.setAttribute('aria-label', name);
    const grow = () => {
      field.style.height = '0px';
      const line = Number.parseFloat(getComputedStyle(field).lineHeight) || 19;
      const cap = Math.ceil(line * EDITOR_LINE_CAP) + 12;
      field.style.overflow = field.scrollHeight > cap ? 'auto' : 'hidden';
      field.style.height = `${Math.min(field.scrollHeight, cap)}px`;
    };
    field.addEventListener(
      'input',
      () => {
        if (pin.text.trim() !== field.value.trim()) epoch++;
        pin.text = field.value;
        grow();
      },
      { signal }
    );
    field.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          closeEditor(true);
        } else if (
          event.key === 'Enter' &&
          !event.shiftKey &&
          !event.isComposing &&
          event.keyCode !== 229
        ) {
          event.preventDefault();
          if (event.metaKey || event.ctrlKey) {
            closeEditor(false);
            void sendAll();
          } else closeEditor(true);
        }
      },
      { signal }
    );
    const saveLabel = label('noteSave', 'Save note');
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'save';
    save.innerHTML = renderUiIconSvg(arrowUpIcon, { size: 16 });
    save.setAttribute('aria-label', saveLabel);
    save.title = saveLabel;
    save.addEventListener('click', () => closeEditor(true), { signal });
    node.append(field, save);
    for (const type of ['pointerdown', 'mousedown', 'dblclick', 'keydown', 'keyup', 'wheel'])
      node.addEventListener(type, (event) => event.stopPropagation(), { signal });
    document.body.append(node);
    editing = { pin, node };
    render();
    grow();
    field.focus();
  }
  function add(elementIds: readonly string[], text = '') {
    if (readonly || busy || !elementIds.length) return;
    const pin = { elementIds: [...new Set(elementIds)], text };
    const existing = pins.find((item) => sameTargets(item, pin));
    if (existing) {
      if (text.trim())
        existing.text = existing.text.trim() ? `${existing.text.trim()}\n${text}` : text;
      changed();
      if (!text.trim()) openEditor(existing);
      return;
    }
    if (pins.length >= DESIGN_NOTES_MAX) {
      message = label(
        'notesFull',
        'Send or clear notes before adding more than {{count}}',
        DESIGN_NOTES_MAX
      );
      render();
      return;
    }
    pins = [...pins, pin];
    changed();
    if (!text.trim()) openEditor(pin);
  }
  document.addEventListener(
    'pointerdown',
    (event) => {
      press = { x: event.clientX, y: event.clientY };
      if (editing && !(event.target as Element | null)?.closest?.('[data-molly-toolbar]'))
        closeEditor(false);
    },
    { capture: true, signal }
  );
  document.addEventListener(
    'click',
    (event) => {
      const moved = press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 3;
      press = undefined;
      if (
        readonly ||
        moved ||
        event.button !== 0 ||
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.shiftKey
      )
        return;
      const target = event.target as Element | null;
      if (!target?.closest || target.closest('[data-molly-toolbar]')) return;
      let hit = target.closest<HTMLElement>('.ed-stage-scale [data-el-id]');
      if (!hit) return;
      for (
        let parent = hit.parentElement?.closest<HTMLElement>('.ed-stage-scale [data-el-id]');
        parent;
        parent = parent.parentElement?.closest<HTMLElement>('.ed-stage-scale [data-el-id]')
      )
        hit = parent;
      const selected = options.selectedIds();
      const inSelection = selected.some((id) => {
        const node = nodeFor(id);
        return !!node && (node.contains(target) || hit!.contains(node));
      });
      add(inSelection ? selected : [hit.dataset.elId!]);
    },
    { capture: true, signal }
  );
  window.addEventListener('resize', () => editing && placeEditor(), { signal });

  return {
    add,
    read(expected?: number) {
      if (prune()) render();
      if (expected !== undefined && expected !== epoch)
        throw Error('Notes changed; send them again');
      return {
        epoch,
        notes: pins
          .filter((pin) => pin.text.trim())
          .map((pin) => ({ elementIds: pin.elementIds, prompt: pin.text.trim() })),
      };
    },
    settle(expected: number, sent: boolean) {
      busy = false;
      if (!sent || expected !== epoch) {
        render();
        return false;
      }
      closeEditor(false);
      pins = [];
      changed();
      return true;
    },
    setReadonly(value: boolean) {
      if (readonly && !value) busy = false;
      readonly = value;
      if (value) {
        closeEditor(false);
        clearHover();
      }
      render();
    },
    present(value: DesignToolbarPresentation) {
      presentation = value;
      render();
    },
    dispose() {
      controller.abort();
      cancelAnimationFrame(frame);
      clearHover();
      editing?.node.remove();
      layer.remove();
      tray.remove();
      tooltip.remove();
      style.remove();
    },
  };
}
