import {
  DESIGN_ASK_PROMPT_MAX,
  DESIGN_MARKED_IMAGE_MAX_BYTES,
  DESIGN_MARKS_MAX,
  type DesignMarkedImage,
  type DesignToolbarPresentation,
  type DesignToolbarRequest,
} from '@molly/shared/design-selection-commands';
import {
  penLineIcon,
  renderUiIconSvg,
  squareIcon,
  undo2Icon,
  type UiIconNode,
} from '@molly/shared/ui-icons';

type NormalizedPoint = readonly [number, number];
export type ImageMark =
  | { kind: 'point'; at: NormalizedPoint }
  | { kind: 'box'; from: NormalizedPoint; to: NormalizedPoint }
  | { kind: 'stroke'; points: NormalizedPoint[] };
type Matrix = { a: number; b: number; c: number; d: number; e: number; f: number };
type Geometry = { node: HTMLElement; source: string; matrix: Matrix };
type Canvas2D = Pick<
  CanvasRenderingContext2D,
  | 'beginPath'
  | 'moveTo'
  | 'lineTo'
  | 'closePath'
  | 'arc'
  | 'stroke'
  | 'fill'
  | 'fillText'
  | 'strokeStyle'
  | 'fillStyle'
  | 'lineWidth'
  | 'lineJoin'
  | 'lineCap'
  | 'font'
  | 'textAlign'
  | 'textBaseline'
>;

const MARK_COLOR = '#ff2d55';
const COPY_MAX_EDGE = 1600;
const STROKE_POINTS_MAX = 400;

function apply(matrix: Matrix, x: number, y: number): NormalizedPoint {
  return [matrix.a * x + matrix.c * y + matrix.e, matrix.b * x + matrix.d * y + matrix.f];
}
function invert(matrix: Matrix): Matrix | undefined {
  const det = matrix.a * matrix.d - matrix.b * matrix.c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return undefined;
  return {
    a: matrix.d / det,
    b: -matrix.b / det,
    c: -matrix.c / det,
    d: matrix.a / det,
    e: (matrix.c * matrix.f - matrix.d * matrix.e) / det,
    f: (matrix.b * matrix.e - matrix.a * matrix.f) / det,
  };
}
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function markAnchor(mark: ImageMark): NormalizedPoint {
  if (mark.kind === 'point') return mark.at;
  if (mark.kind === 'box')
    return [Math.min(mark.from[0], mark.to[0]), Math.min(mark.from[1], mark.to[1])];
  return mark.points[0];
}

export function drawImageMarks(
  context: Canvas2D,
  marks: readonly ImageMark[],
  width: number,
  height: number
) {
  const edge = Math.max(width, height);
  const line = Math.max(3, Math.round(edge * 0.005));
  const badge = Math.max(10, Math.round(edge * 0.018));
  const at = ([u, v]: NormalizedPoint): NormalizedPoint => [u * width, v * height];
  const path = (points: readonly NormalizedPoint[], closed: boolean) => {
    context.beginPath();
    points
      .map(at)
      .forEach(([x, y], index) => (index ? context.lineTo(x, y) : context.moveTo(x, y)));
    if (closed) context.closePath();
    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.strokeStyle = '#ffffff';
    context.lineWidth = line + 4;
    context.stroke();
    context.strokeStyle = MARK_COLOR;
    context.lineWidth = line;
    context.stroke();
  };
  marks.forEach((mark, index) => {
    if (mark.kind === 'box') {
      const [[x0, y0], [x1, y1]] = [mark.from, mark.to];
      path(
        [
          [x0, y0],
          [x1, y0],
          [x1, y1],
          [x0, y1],
        ],
        true
      );
    } else if (mark.kind === 'stroke') path(mark.points, false);
    const [x, y] = at(markAnchor(mark));
    context.beginPath();
    context.arc(x, y, badge, 0, Math.PI * 2);
    context.fillStyle = MARK_COLOR;
    context.fill();
    context.strokeStyle = '#ffffff';
    context.lineWidth = Math.max(2, badge / 6);
    context.stroke();
    context.fillStyle = '#ffffff';
    context.font = `700 ${Math.round(badge * 1.1)}px Inter, system-ui, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(String(index + 1), x, y);
  });
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Numbered marks drawn on one selected image. Marks are screen-only canvas state
 * in image-normalized coordinates; the request carries only their epoch, and main
 * reads a marked copy of the image for the Agent to use as a guide.
 */
export function createImageMarks(options: {
  request(input: DesignToolbarRequest): Promise<{ ok: boolean; error?: string }>;
}) {
  let target: { elementId: string; selectionEpoch: number } | undefined;
  let marks: ImageMark[] = [];
  let draft: { mark: ImageMark; start: NormalizedPoint } | undefined;
  let epoch = 0;
  let tool: 'box' | 'brush' = 'box';
  let readonly = true;
  let presentation: DesignToolbarPresentation | undefined;
  let busy = false;
  let message = '';
  let text = '';
  let frame = 0;
  const controller = new AbortController();
  const signal = controller.signal;
  const label = (key: string, fallback: string, count?: number) =>
    (presentation?.labels[key] ?? fallback).replace('{{count}}', String(count ?? ''));
  const style = document.createElement('style');
  style.textContent = `
.molly-mark-overlay{position:fixed;inset:0;width:100vw;height:100vh;z-index:2147483097;pointer-events:none;overflow:visible}
.molly-mark-capture{position:fixed;z-index:2147483098;cursor:crosshair;touch-action:none;outline:1.5px dashed ${MARK_COLOR};outline-offset:2px}
.molly-mark-panel{width:300px}
.molly-mark-panel .mark-tools{display:flex;align-items:center;gap:2px;margin-bottom:8px}
.molly-mark-panel .mark-tools .grow{flex:1}
.molly-mark-panel .mark-hint{opacity:.65;font-size:11px;margin:0 2px 6px}
`;
  document.head.append(style);
  const overlay = document.createElementNS(SVG_NS, 'svg');
  overlay.setAttribute('class', 'molly-mark-overlay');
  overlay.setAttribute('aria-hidden', 'true');
  const capture = document.createElement('div');
  capture.className = 'molly-mark-capture';
  capture.dataset.mollyToolbar = '';
  capture.tabIndex = -1;
  capture.hidden = true;
  const panel = document.createElement('div');
  panel.className = 'molly-selection-popup molly-mark-panel';
  panel.dataset.mollyToolbar = '';
  panel.setAttribute('role', 'dialog');
  panel.hidden = true;
  document.body.append(overlay, capture, panel);
  for (const node of [capture, panel])
    for (const type of [
      'pointerdown',
      'mousedown',
      'click',
      'dblclick',
      'keydown',
      'keyup',
      'wheel',
    ])
      node.addEventListener(type, (event) => event.stopPropagation(), { signal });

  function contentBox(image: HTMLImageElement) {
    const [width, height] = [image.offsetWidth, image.offsetHeight];
    const [natural, box] = [image.naturalWidth / image.naturalHeight, width / height];
    const fit = getComputedStyle(image).objectFit;
    if (!Number.isFinite(natural) || !natural || fit === 'fill' || natural === box)
      return { x: 0, y: 0, width, height };
    const widthBound = fit === 'cover' ? natural < box : natural > box;
    const size = widthBound
      ? { width, height: width / natural }
      : { width: height * natural, height };
    return { x: (width - size.width) / 2, y: (height - size.height) / 2, ...size };
  }
  function screenCorners(image: HTMLImageElement): NormalizedPoint[] | undefined {
    const parent = image.parentElement;
    if (!parent || !image.offsetWidth || !image.offsetHeight) return undefined;
    const box = contentBox(image);
    const probe = document.createElement('div');
    probe.style.cssText = `position:absolute;left:${image.offsetLeft}px;top:${image.offsetTop}px;width:0;height:0;visibility:hidden;pointer-events:none;transform-origin:0 0;transform:${getComputedStyle(image).transform}`;
    const corners = [
      [box.x, box.y],
      [box.x + box.width, box.y],
      [box.x, box.y + box.height],
    ].map(([x, y]) => {
      const corner = document.createElement('div');
      corner.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:0;height:0`;
      probe.append(corner);
      return corner;
    });
    parent.append(probe);
    const points = corners.map((corner) => {
      const rect = corner.getBoundingClientRect();
      return [rect.left, rect.top] as const;
    });
    probe.remove();
    return points;
  }
  function geometry(): Geometry | undefined {
    if (!target) return undefined;
    const node = document.querySelector<HTMLElement>(
      `.ed-stage-scale [data-el-id="${CSS.escape(target.elementId)}"]`
    );
    const placed = node?.querySelector<SVGImageElement>('svg image');
    const image = placed ? undefined : node?.querySelector('img');
    const corners = placed ? placedCorners(placed) : image && screenCorners(image);
    const source = placed ? placed.getAttribute('href') : image?.currentSrc || image?.src;
    if (!node || !corners || !source) return undefined;
    const [[e, f], [right, top], [left, bottom]] = corners;
    const matrix = { a: right - e, b: top - f, c: left - e, d: bottom - f, e, f };
    return invert(matrix) ? { node, source, matrix } : undefined;
  }
  function placedCorners(image: SVGImageElement): NormalizedPoint[] | undefined {
    const ctm = image.getScreenCTM?.();
    const attribute = (name: string) => Number.parseFloat(image.getAttribute(name) ?? '');
    const [x, y, width, height] = ['x', 'y', 'width', 'height'].map(attribute);
    if (!ctm || ![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0)
      return undefined;
    return [
      [x, y],
      [x + width, y],
      [x, y + height],
    ].map(([px, py]) => apply(ctm, px, py));
  }
  const toScreen = (geo: Geometry, [u, v]: NormalizedPoint) => apply(geo.matrix, u, v);
  function toImage(geo: Geometry, x: number, y: number): NormalizedPoint | undefined {
    const inverse = invert(geo.matrix);
    if (!inverse) return undefined;
    const [u, v] = apply(inverse, x, y);
    return [clamp01(u), clamp01(v)];
  }
  const svg = (name: string, attributes: Record<string, string>) => {
    const node = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    overlay.append(node);
    return node;
  };
  function paint(geo: Geometry) {
    overlay.replaceChildren();
    const shown = draft ? [...marks, draft.mark] : marks;
    shown.forEach((mark, index) => {
      const points = (
        mark.kind === 'box'
          ? [
              mark.from,
              [mark.to[0], mark.from[1]] as NormalizedPoint,
              mark.to,
              [mark.from[0], mark.to[1]] as NormalizedPoint,
            ]
          : mark.kind === 'stroke'
            ? mark.points
            : []
      ).map((point) => toScreen(geo, point).join(','));
      if (points.length)
        svg(mark.kind === 'box' ? 'polygon' : 'polyline', {
          points: points.join(' '),
          fill: mark.kind === 'box' ? 'rgb(255 45 85 / .12)' : 'none',
          stroke: MARK_COLOR,
          'stroke-width': '2.5',
          'stroke-linejoin': 'round',
          'stroke-linecap': 'round',
        });
      const [x, y] = toScreen(geo, markAnchor(mark));
      svg('circle', {
        cx: String(x),
        cy: String(y),
        r: '10',
        fill: MARK_COLOR,
        stroke: '#fff',
        'stroke-width': '2',
      });
      const number = svg('text', {
        x: String(x),
        y: String(y),
        fill: '#fff',
        'font-size': '11',
        'font-weight': '700',
        'font-family': 'Inter, system-ui, sans-serif',
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
      });
      number.textContent = String(index + 1);
    });
  }
  function position() {
    frame = 0;
    const geo = geometry();
    if (!target || readonly || !presentation || !geo) {
      if (target) close();
      return;
    }
    const rect = geo.node.getBoundingClientRect();
    Object.assign(capture.style, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
    paint(geo);
    const below = rect.bottom + 12;
    const height = panel.offsetHeight || 220;
    const top = below + height <= innerHeight - 8 ? below : Math.max(8, rect.top - height - 12);
    panel.style.left = `${Math.max(8, Math.min(rect.left + rect.width / 2 - 150, innerWidth - 308))}px`;
    panel.style.top = `${top}px`;
    frame = requestAnimationFrame(position);
  }
  const changed = () => {
    epoch++;
    message = '';
    render();
  };
  const iconButton = (
    parent: HTMLElement,
    icon: readonly UiIconNode[],
    name: string,
    click: () => void
  ) => {
    const node = document.createElement('button');
    node.type = 'button';
    node.innerHTML = renderUiIconSvg(icon, { size: 18 });
    node.setAttribute('aria-label', name);
    node.title = name;
    node.addEventListener('click', click, { signal });
    parent.append(node);
    return node;
  };
  const textButton = (parent: HTMLElement, name: string, click: () => void, className = '') => {
    const node = document.createElement('button');
    node.type = 'button';
    node.textContent = name;
    node.setAttribute('aria-label', name);
    if (className) node.className = className;
    node.addEventListener('click', click, { signal });
    parent.append(node);
    return node;
  };
  function render() {
    panel.replaceChildren();
    panel.dataset.dark = String(presentation?.dark ?? false);
    const open = !!target && !readonly && !!presentation;
    panel.hidden = capture.hidden = !open;
    if (!open) {
      overlay.replaceChildren();
      return;
    }
    const name = label('markImage', 'Mark areas to edit');
    panel.setAttribute('aria-label', name);
    const tools = document.createElement('div');
    tools.className = 'mark-tools';
    for (const [value, icon, key, fallback] of [
      ['box', squareIcon, 'markBox', 'Box'],
      ['brush', penLineIcon, 'markBrush', 'Brush'],
    ] as const) {
      const node = iconButton(tools, icon, label(key, fallback), () => {
        tool = value;
        render();
      });
      node.setAttribute('aria-pressed', String(tool === value));
    }
    const grow = document.createElement('span');
    grow.className = 'grow';
    tools.append(grow);
    iconButton(tools, undo2Icon, label('markUndo', 'Undo mark'), () => {
      marks = marks.slice(0, -1);
      changed();
    }).disabled = busy || !marks.length;
    textButton(tools, label('markClear', 'Clear'), () => {
      marks = [];
      changed();
    }).disabled = busy || !marks.length;
    const hint = document.createElement('div');
    hint.className = 'mark-hint';
    hint.textContent = label('markHint', 'Drag to mark an area, or click to drop a point');
    const field = document.createElement('textarea');
    field.rows = 3;
    field.maxLength = DESIGN_ASK_PROMPT_MAX;
    field.value = text;
    field.placeholder = label('markPlaceholder', 'What should change in the marked areas?');
    field.setAttribute('aria-label', name);
    const row = document.createElement('div');
    row.className = 'ask-actions';
    textButton(row, label('markCancel', 'Cancel'), close, 'secondary');
    const add = textButton(
      row,
      label('askMollyAddToChat', 'Add to chat'),
      () => void submit(false),
      'secondary'
    );
    const send = textButton(row, label('askMollySend', 'Send'), () => void submit(true), 'primary');
    const validate = () => {
      const blocked = busy || !marks.length || !field.value.trim() || !presentation?.actionsEnabled;
      send.disabled = add.disabled = blocked;
    };
    field.addEventListener(
      'input',
      () => {
        text = field.value;
        validate();
      },
      { signal }
    );
    field.addEventListener(
      'keydown',
      (event) => {
        if (
          event.key === 'Enter' &&
          !event.shiftKey &&
          !event.isComposing &&
          event.keyCode !== 229
        ) {
          event.preventDefault();
          void submit(true);
        }
      },
      { signal }
    );
    validate();
    panel.append(tools, hint, field, row);
    if (message) {
      const error = document.createElement('div');
      error.className = 'molly-selection-error';
      error.setAttribute('role', 'alert');
      error.textContent = message;
      panel.append(error);
    }
    cancelAnimationFrame(frame);
    position();
  }
  async function submit(send: boolean) {
    const prompt = text.trim();
    if (!target || readonly || busy || !marks.length || !prompt) return;
    busy = true;
    render();
    let failure = '';
    try {
      const result = await options.request({
        type: 'marks',
        selectionEpoch: target.selectionEpoch,
        marksEpoch: epoch,
        prompt,
        send,
      });
      if (!result.ok) failure = result.error ?? 'Canvas request failed';
    } catch (cause) {
      failure = String(cause);
    }
    busy = false;
    if (!failure) return close();
    message = failure;
    render();
  }
  function close() {
    target = undefined;
    marks = [];
    draft = undefined;
    text = '';
    busy = false;
    epoch++;
    message = '';
    cancelAnimationFrame(frame);
    frame = 0;
    render();
  }
  capture.addEventListener(
    'pointerdown',
    (event) => {
      event.preventDefault();
      const geo = geometry();
      const start = geo && event.button === 0 && toImage(geo, event.clientX, event.clientY);
      if (!start || busy || readonly) return;
      if (marks.length >= DESIGN_MARKS_MAX) {
        message = label('marksFull', 'Up to {{count}} marks per request', DESIGN_MARKS_MAX);
        render();
        return;
      }
      capture.setPointerCapture?.(event.pointerId);
      draft = {
        start: [event.clientX, event.clientY],
        mark:
          tool === 'brush'
            ? { kind: 'stroke', points: [start] }
            : { kind: 'box', from: start, to: start },
      };
    },
    { signal }
  );
  capture.addEventListener(
    'pointermove',
    (event) => {
      const geo = geometry();
      const point = draft && geo && toImage(geo, event.clientX, event.clientY);
      if (!draft || !point || !geo) return;
      if (draft.mark.kind === 'box') draft.mark = { ...draft.mark, to: point };
      else if (draft.mark.kind === 'stroke' && draft.mark.points.length < STROKE_POINTS_MAX)
        draft.mark.points.push(point);
      paint(geo);
    },
    { signal }
  );
  capture.addEventListener(
    'pointerup',
    (event) => {
      if (!draft) return;
      const { mark, start } = draft;
      draft = undefined;
      const moved = Math.hypot(event.clientX - start[0], event.clientY - start[1]) > 4;
      const origin =
        mark.kind === 'box' ? mark.from : mark.kind === 'stroke' ? mark.points[0] : mark.at;
      marks = [...marks, moved ? mark : { kind: 'point', at: origin }];
      changed();
    },
    { signal }
  );
  for (const node of [capture, panel])
    node.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          close();
        }
      },
      { signal }
    );

  async function read(expected: number): Promise<DesignMarkedImage> {
    if (expected !== epoch || !target || !marks.length)
      throw Error('Marks changed; send them again');
    const geo = geometry();
    if (!geo) throw Error('The marked image is no longer visible');
    const source = new Image();
    source.src = geo.source;
    await source.decode();
    if (expected !== epoch) throw Error('Marks changed; send them again');
    const scale = Math.min(1, COPY_MAX_EDGE / Math.max(source.naturalWidth, source.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(source.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(source.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw Error('Marked image could not be drawn');
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    drawImageMarks(context, marks, canvas.width, canvas.height);
    let mimeType: DesignMarkedImage['mimeType'] = 'image/png';
    let url = canvas.toDataURL(mimeType);
    if (((url.length - url.indexOf(',') - 1) * 3) / 4 > DESIGN_MARKED_IMAGE_MAX_BYTES) {
      context.globalCompositeOperation = 'destination-over';
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      mimeType = 'image/jpeg';
      url = canvas.toDataURL(mimeType, 0.9);
    }
    return {
      elementId: target.elementId,
      count: marks.length,
      mimeType,
      data: url.slice(url.indexOf(',') + 1),
    };
  }

  return {
    open(elementId: string, selectionEpoch: number) {
      if (readonly) return;
      if (target?.elementId !== elementId) close();
      target = { elementId, selectionEpoch };
      render();
      capture.focus?.();
    },
    isOpen: () => !!target,
    select(ids: readonly string[], selectionEpoch: number) {
      if (!target) return;
      if (ids.length !== 1 || ids[0] !== target.elementId) close();
      else target.selectionEpoch = selectionEpoch;
    },
    read,
    setReadonly(value: boolean) {
      readonly = value;
      if (value) close();
      else render();
    },
    present(value: DesignToolbarPresentation) {
      presentation = value;
      render();
    },
    dispose() {
      controller.abort();
      cancelAnimationFrame(frame);
      overlay.remove();
      capture.remove();
      panel.remove();
      style.remove();
    },
  };
}
