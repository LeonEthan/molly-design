import {
  DESIGN_ASK_PROMPT_MAX,
  DESIGN_MARKED_IMAGE_MAX_BYTES,
  DESIGN_NOTES_MAX,
  type DesignMarkedImage,
  type DesignNote,
  type DesignToolbarPresentation,
  type DesignToolbarRequest,
} from '@molly/shared/design-selection-commands';
import { arrowUpIcon, renderUiIconSvg, xIcon } from '@molly/shared/ui-icons';
import type { HighlightGroup } from './element-highlight';
import {
  appendStrokePoint,
  drawNoteRegions,
  imageGeometry,
  paintRegion,
  REGION_COLOR,
  regionAnchor,
  regionFromPoints,
  strokeRegion,
  svgOverlay,
  toImage,
  toScreen,
  type ImageGeometry,
  type NormalizedPoint,
  type NoteRegion,
} from './image-regions';

type Pin = {
  elementIds: string[];
  text: string;
  pin?: { elementId: string; at: NormalizedPoint };
  region?: NoteRegion;
};
/** Mutually exclusive dock tools: comment places pins and boxes, brush draws strokes. */
type NoteTool = 'select' | 'comment' | 'brush';
type Drag =
  | {
      kind: 'box';
      elementId: string;
      geo: ImageGeometry;
      origin: { x: number; y: number };
      start: NormalizedPoint;
      current: NormalizedPoint;
    }
  | {
      kind: 'stroke';
      elementId: string;
      geo: ImageGeometry;
      origin: { x: number; y: number };
      points: NormalizedPoint[];
    };

const EDITOR_LINE_CAP = 4;
const COPY_MAX_EDGE = 1600;
const MOVE_SLOP = 3;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const moved = (origin: { x: number; y: number }, event: { clientX: number; clientY: number }) =>
  Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > MOVE_SLOP;

/**
 * Numbered notes pinned to the canvas, sent to Molly together as one turn. A note is
 * a pin (a point inside an element, or the element's default corner) or a region (a box
 * drawn on one image, marked on a copy of that image). Notes are screen-only canvas state
 * keyed by element id: they never touch the document, and the request carries only the
 * notes epoch so main reads and validates the targets.
 */
export function createNotePins(options: {
  request(input: DesignToolbarRequest): Promise<{ ok: boolean; error?: string }>;
  selectedIds(): readonly string[];
  elements(): readonly { id: string; kind: string }[];
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
  let tool: NoteTool = 'select';
  let frame = 0;
  let press: { x: number; y: number } | undefined;
  let drag: Drag | undefined;
  const controller = new AbortController();
  const signal = controller.signal;
  const label = (key: string, fallback: string, count?: number) =>
    (presentation?.labels[key] ?? fallback).replace('{{count}}', String(count ?? ''));
  const style = document.createElement('style');
  style.textContent = `
body[data-commenting="true"] .ed-stage-scale [data-el-id],body[data-brushing="true"] .ed-stage-scale [data-el-id]{cursor:crosshair!important}
.molly-note-regions{position:fixed;inset:0;width:100vw;height:100vh;z-index:2147483097;pointer-events:none;overflow:visible}
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
  const overlay = svgOverlay();
  const tray = document.createElement('div');
  tray.className = 'molly-note-tray';
  tray.dataset.mollyToolbar = '';
  tray.setAttribute('role', 'region');
  tray.hidden = true;
  const tooltip = document.createElement('div');
  tooltip.className = 'molly-note-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  document.body.append(overlay, layer, tray, tooltip);
  for (const node of [layer, tray])
    for (const type of ['pointerdown', 'mousedown', 'dblclick', 'keydown', 'keyup', 'wheel'])
      node.addEventListener(type, (event) => event.stopPropagation(), { signal });

  const nodeFor = (id: string) =>
    document.querySelector<HTMLElement>(`.ed-stage-scale [data-el-id="${CSS.escape(id)}"]`);
  const kindOf = (id: string) => options.elements().find((element) => element.id === id)?.kind;
  const changed = () => {
    epoch++;
    message = '';
    render();
  };
  const full = () => {
    message = label('notesFull', 'Send or clear notes before adding more than {{count}}', DESIGN_NOTES_MAX);
    render();
  };
  const setTool = (value: NoteTool) => {
    tool = readonly ? 'select' : value;
    drag = undefined;
    document.body.dataset.commenting = String(tool === 'comment');
    document.body.dataset.brushing = String(tool === 'brush');
    paintRegions();
  };
  const prune = () => {
    const present = new Set(options.elements().map((element) => element.id));
    const stale = (pin: Pin) =>
      pin.elementIds.some((id) => !present.has(id)) ||
      (!!pin.pin && !present.has(pin.pin.elementId));
    if (!pins.some(stale)) return false;
    for (const pin of pins) {
      pin.elementIds = pin.elementIds.filter((id) => present.has(id));
      if (pin.pin && !present.has(pin.pin.elementId)) delete pin.pin;
    }
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
  const pinPoint = (pin: Pin): { x: number; y: number } | undefined => {
    if (pin.region) {
      const geo = imageGeometry(pin.elementIds[0]);
      if (!geo) return undefined;
      const [x, y] = toScreen(geo, regionAnchor(pin.region));
      return { x, y };
    }
    const anchor = pin.pin && nodeFor(pin.pin.elementId);
    if (!pin.pin || !anchor) return undefined;
    const rect = anchor.getBoundingClientRect();
    return {
      x: rect.left + pin.pin.at[0] * rect.width,
      y: rect.top + pin.pin.at[1] * rect.height,
    };
  };
  function paintRegions() {
    overlay.replaceChildren();
    for (const pin of pins) {
      if (!pin.region) continue;
      const geo = imageGeometry(pin.elementIds[0]);
      if (geo) paintRegion(overlay, geo, pin.region, REGION_COLOR);
    }
    if (drag) {
      const region =
        drag.kind === 'box'
          ? regionFromPoints(drag.start, drag.current)
          : { kind: 'stroke' as const, points: drag.points };
      paintRegion(overlay, drag.geo, region, REGION_COLOR);
    }
  }
  function position() {
    frame = 0;
    if (!pins.length) return paintRegions();
    if (prune()) return render();
    const markers = [...layer.children] as HTMLElement[];
    pins.forEach((pin, index) => {
      const marker = markers[index];
      const point = pinPoint(pin);
      const rects = pin.elementIds
        .map(nodeFor)
        .filter((node): node is HTMLElement => !!node)
        .map((node) => node.getBoundingClientRect());
      if (!marker) return;
      marker.hidden = readonly || (!point && !rects.length);
      if (marker.hidden) return;
      const place = (x: number, y: number) => {
        marker.style.left = `${Math.max(4, Math.min(x, innerWidth - 32))}px`;
        marker.style.top = `${Math.max(4, Math.min(y, innerHeight - 32))}px`;
      };
      if (point) return place(point.x - 14, point.y - 14);
      const right = Math.max(...rects.map((rect) => rect.right));
      const top = Math.min(...rects.map((rect) => rect.top));
      place(right - 8, top - 14);
    });
    paintRegions();
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
  function add(elementIds: readonly string[], text = '', point?: Pin['pin']) {
    if (readonly || busy || !elementIds.length) return;
    const pin: Pin = {
      elementIds: [...new Set(elementIds)],
      text,
      ...(point ? { pin: point } : {}),
    };
    const existing = !point && pins.find((item) => !item.pin && !item.region && sameTargets(item, pin));
    if (existing) {
      if (text.trim())
        existing.text = existing.text.trim() ? `${existing.text.trim()}\n${text}` : text;
      changed();
      if (!text.trim()) openEditor(existing);
      return;
    }
    if (pins.length >= DESIGN_NOTES_MAX) return full();
    pins = [...pins, pin];
    changed();
    if (!text.trim()) openEditor(pin);
  }
  function addRegion(elementId: string, region: NoteRegion) {
    if (readonly || busy) return;
    if (pins.some((pin) => pin.region && pin.elementIds[0] !== elementId)) {
      message = label('notesRegionOneImage', 'Mark regions on one image at a time');
      render();
      return;
    }
    if (pins.length >= DESIGN_NOTES_MAX) return full();
    const pin: Pin = { elementIds: [elementId], text: '', region };
    pins = [...pins, pin];
    changed();
    openEditor(pin);
  }
  function startRegion(event: PointerEvent) {
    if (
      tool === 'select' ||
      busy ||
      event.button !== 0 ||
      event.altKey ||
      event.shiftKey ||
      event.metaKey ||
      event.ctrlKey
    )
      return;
    const target = event.target as Element | null;
    if (!target?.closest || target.closest('[data-molly-toolbar]')) return;
    const elementId = target.closest<HTMLElement>('.ed-stage-scale [data-el-id]')?.dataset.elId;
    if (!elementId || kindOf(elementId) !== 'image') return;
    const geo = imageGeometry(elementId);
    const start = geo && toImage(geo, event.clientX, event.clientY);
    if (!geo || !start) return;
    event.stopPropagation();
    event.preventDefault();
    const origin = { x: event.clientX, y: event.clientY };
    drag =
      tool === 'brush'
        ? { kind: 'stroke', elementId, geo, origin, points: [start] }
        : { kind: 'box', elementId, geo, origin, start, current: start };
  }
  document.addEventListener(
    'pointerdown',
    (event) => {
      press = { x: event.clientX, y: event.clientY };
      if (editing && !(event.target as Element | null)?.closest?.('[data-molly-toolbar]'))
        closeEditor(false);
      startRegion(event);
    },
    { capture: true, signal }
  );
  document.addEventListener(
    'pointermove',
    (event) => {
      if (!drag) return;
      const point = toImage(drag.geo, event.clientX, event.clientY);
      if (!point) return;
      if (drag.kind === 'box') drag.current = point;
      else appendStrokePoint(drag.points, point);
      paintRegions();
    },
    { capture: true, signal }
  );
  const endRegion = (event: PointerEvent, commit: boolean) => {
    if (!drag) return;
    const finished = drag;
    drag = undefined;
    const end = toImage(finished.geo, event.clientX, event.clientY);
    if (finished.kind === 'box') {
      paintRegions();
      if (commit && moved(finished.origin, event))
        addRegion(finished.elementId, regionFromPoints(finished.start, end ?? finished.current));
      return;
    }
    if (end) appendStrokePoint(finished.points, end);
    paintRegions();
    const stroke = strokeRegion(finished.points);
    if (commit && stroke && moved(finished.origin, event)) addRegion(finished.elementId, stroke);
  };
  document.addEventListener('pointerup', (event) => endRegion(event, true), {
    capture: true,
    signal,
  });
  document.addEventListener('pointercancel', (event) => endRegion(event, false), {
    capture: true,
    signal,
  });
  document.addEventListener(
    'click',
    (event) => {
      const dragged = press && moved(press, event);
      press = undefined;
      if (
        readonly ||
        dragged ||
        event.button !== 0 ||
        !(tool === 'comment' || event.metaKey || event.ctrlKey) ||
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
      const rect = hit.getBoundingClientRect();
      const point: Pin['pin'] | undefined =
        rect.width && rect.height && hit.dataset.elId
          ? {
              elementId: hit.dataset.elId,
              at: [
                clamp01((event.clientX - rect.left) / rect.width),
                clamp01((event.clientY - rect.top) / rect.height),
              ],
            }
          : undefined;
      add(inSelection ? selected : [hit.dataset.elId!], '', point);
    },
    { capture: true, signal }
  );
  window.addEventListener('resize', () => editing && placeEditor(), { signal });

  const sentNotes = () => pins.filter((pin) => pin.text.trim());
  const toNote = (pin: Pin): DesignNote => ({
    elementIds: [...pin.elementIds],
    prompt: pin.text.trim(),
    ...(pin.pin ? { pin: { elementId: pin.pin.elementId, at: [...pin.pin.at] as NormalizedPoint } } : {}),
    ...(pin.region ? { region: pin.region } : {}),
  });

  return {
    add,
    read(expected?: number) {
      if (prune()) render();
      if (expected !== undefined && expected !== epoch)
        throw Error('Notes changed; send them again');
      return { epoch, notes: sentNotes().map(toNote) };
    },
    async marked(expected: number): Promise<DesignMarkedImage | null> {
      if (expected !== epoch) throw Error('Notes changed; send them again');
      const regions = sentNotes().flatMap((pin, index) =>
        pin.region ? [{ badge: index + 1, region: pin.region, elementId: pin.elementIds[0] }] : []
      );
      if (!regions.length) return null;
      const { elementId } = regions[0];
      const geo = imageGeometry(elementId);
      if (!geo) throw Error('The marked image is no longer visible');
      const source = new Image();
      source.src = geo.source;
      await source.decode();
      if (expected !== epoch) throw Error('Notes changed; send them again');
      const scale = Math.min(1, COPY_MAX_EDGE / Math.max(source.naturalWidth, source.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(source.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(source.naturalHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) throw Error('Marked image could not be drawn');
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      drawNoteRegions(context, regions, canvas.width, canvas.height);
      let mimeType: DesignMarkedImage['mimeType'] = 'image/png';
      let url = canvas.toDataURL(mimeType);
      if (((url.length - url.indexOf(',') - 1) * 3) / 4 > DESIGN_MARKED_IMAGE_MAX_BYTES) {
        context.globalCompositeOperation = 'destination-over';
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        mimeType = 'image/jpeg';
        url = canvas.toDataURL(mimeType, 0.9);
      }
      return { elementId, mimeType, data: url.slice(url.indexOf(',') + 1) };
    },
    snapshot(): DesignNote[] {
      return sentNotes().map(toNote);
    },
    restore(notes: readonly DesignNote[]) {
      if (pins.length || !notes.length) return;
      pins = notes.slice(0, DESIGN_NOTES_MAX).map((note) => ({
        elementIds: [...new Set(note.elementIds)],
        text: note.prompt,
        ...(note.pin ? { pin: note.pin } : {}),
        ...(note.region ? { region: note.region } : {}),
      }));
      prune();
      changed();
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
        setTool('select');
        closeEditor(false);
        clearHover();
        drag = undefined;
      }
      render();
    },
    setTool,
    tool: () => tool,
    present(value: DesignToolbarPresentation) {
      presentation = value;
      render();
    },
    dispose() {
      controller.abort();
      cancelAnimationFrame(frame);
      clearHover();
      setTool('select');
      editing?.node.remove();
      layer.remove();
      overlay.remove();
      tray.remove();
      tooltip.remove();
      style.remove();
    },
  };
}
