import {
  DESIGN_ASK_PROMPT_MAX,
  DESIGN_NOTES_MAX,
  type DesignToolbarPresentation,
  type DesignToolbarRequest,
} from '@molly/shared/design-selection-commands';

type Pin = { elementIds: string[]; text: string };

/**
 * Numbered notes pinned to elements, sent to Molly together as one turn. Pins are
 * screen-only canvas state keyed by element id: they never touch the document, and
 * the request carries only the notes epoch so main reads and validates the targets.
 */
export function createNotePins(options: {
  request(input: DesignToolbarRequest): Promise<{ ok: boolean; error?: string }>;
  selectedIds(): readonly string[];
  elementIds(): readonly string[];
}) {
  let pins: Pin[] = [];
  let epoch = 0;
  let readonly = true;
  let presentation: DesignToolbarPresentation | undefined;
  let busy = false;
  let message = '';
  let editing: { pin: Pin; node: HTMLElement } | undefined;
  let frame = 0;
  let press: { x: number; y: number } | undefined;
  const controller = new AbortController();
  const signal = controller.signal;
  const label = (key: string, fallback: string, count?: number) =>
    (presentation?.labels[key] ?? fallback).replace('{{count}}', String(count ?? ''));
  const style = document.createElement('style');
  style.textContent = `
.molly-note-pin{position:fixed;z-index:2147483099;display:flex;align-items:center;justify-content:center;width:22px;height:22px;min-width:0!important;padding:0!important;border-radius:11px 11px 11px 3px!important;background:#d9512c!important;color:#fff!important;font:600 11px/1 Inter,system-ui,sans-serif!important;box-shadow:0 2px 8px rgb(0 0 0 / .25);cursor:pointer}
.molly-note-pin[aria-expanded=true]{outline:2px solid #fff;outline-offset:1px}
.molly-note-tray{--surface:#fff;--ink:#242424;--muted:#f2f2f2;--line:#00000010;position:fixed;left:50%;bottom:calc(var(--molly-dock-bottom,18px) + var(--molly-dock-height,52px) + 12px);transform:translateX(-50%);z-index:2147483099;display:flex;align-items:center;gap:6px;padding:6px 6px 6px 12px;max-width:calc(100vw - 16px);border-radius:999px;background:var(--surface);color:var(--ink);border:1px solid var(--line);box-shadow:0 6px 20px rgb(0 0 0 / .12);font:12px Inter,system-ui,sans-serif;box-sizing:border-box}
.molly-note-tray .primary,.molly-note-editor .primary{background:var(--ink)!important;color:var(--surface)}
.molly-note-tray .molly-selection-error{max-width:260px}
.molly-note-editor{width:280px}
`;
  document.head.append(style);
  const layer = document.createElement('div');
  layer.className = 'molly-note-layer';
  const tray = document.createElement('div');
  tray.className = 'molly-note-tray';
  tray.dataset.mollyToolbar = '';
  tray.setAttribute('role', 'region');
  tray.hidden = true;
  document.body.append(layer, tray);
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
      marker.style.left = `${Math.max(4, Math.min(right - 8, innerWidth - 26))}px`;
      marker.style.top = `${Math.max(4, Math.min(top - 14, innerHeight - 26))}px`;
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
    layer.replaceChildren();
    tray.replaceChildren();
    tray.dataset.dark = String(presentation?.dark ?? false);
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
      layer.append(marker);
    });
    tray.hidden = readonly || !pins.length || !presentation;
    if (!tray.hidden) {
      tray.setAttribute('aria-label', label('notesCount', 'Notes · {{count}}', pins.length));
      const count = document.createElement('span');
      count.textContent = label('notesCount', 'Notes · {{count}}', pins.length);
      tray.append(count);
      button(tray, label('notesClear', 'Clear'), () => {
        closeEditor(false);
        pins = [];
        changed();
      }).disabled = busy;
      const send = button(
        tray,
        label('notesSend', 'Send to Molly'),
        () => void sendAll(),
        'primary'
      );
      send.disabled = busy || !presentation?.actionsEnabled;
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
    node.style.top = `${Math.max(8, Math.min(anchor.top, innerHeight - node.offsetHeight - 8))}px`;
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
    const node = document.createElement('div');
    node.className = 'molly-selection-popup molly-note-editor';
    node.dataset.mollyToolbar = '';
    node.dataset.dark = String(presentation?.dark ?? false);
    node.setAttribute('role', 'dialog');
    const name = label('notePin', 'Note {{count}}', pins.indexOf(pin) + 1);
    node.setAttribute('aria-label', name);
    const field = document.createElement('textarea');
    field.rows = 3;
    field.maxLength = DESIGN_ASK_PROMPT_MAX;
    field.value = pin.text;
    field.placeholder = label('notePlaceholder', 'What should change here?');
    field.setAttribute('aria-label', name);
    field.addEventListener(
      'input',
      () => {
        if (pin.text.trim() !== field.value.trim()) epoch++;
        pin.text = field.value;
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
          closeEditor(true);
        }
      },
      { signal }
    );
    const row = document.createElement('div');
    row.className = 'ask-actions';
    button(row, label('noteDelete', 'Delete'), () => {
      pins = pins.filter((item) => item !== pin);
      editing = undefined;
      node.remove();
      changed();
    });
    button(row, label('noteDone', 'Done'), () => closeEditor(true), 'primary');
    node.append(field, row);
    for (const type of ['pointerdown', 'mousedown', 'dblclick', 'keydown', 'keyup', 'wheel'])
      node.addEventListener(type, (event) => event.stopPropagation(), { signal });
    document.body.append(node);
    editing = { pin, node };
    render();
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
      if (value) closeEditor(false);
      render();
    },
    present(value: DesignToolbarPresentation) {
      presentation = value;
      if (editing) editing.node.dataset.dark = String(value.dark);
      render();
    },
    dispose() {
      controller.abort();
      cancelAnimationFrame(frame);
      editing?.node.remove();
      layer.remove();
      tray.remove();
      style.remove();
    },
  };
}
