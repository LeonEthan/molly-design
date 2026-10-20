import {
  DESIGN_STROKE_POINTS_MAX,
  type DesignNote,
} from '@molly/shared/design-selection-commands';

export type NoteRegion = NonNullable<DesignNote['region']>;
export type BoxRegion = Extract<NoteRegion, { kind: 'box' }>;
export type StrokeRegion = Extract<NoteRegion, { kind: 'stroke' }>;
export type NormalizedPoint = [number, number];
type Matrix = { a: number; b: number; c: number; d: number; e: number; f: number };
export type ImageGeometry = { node: HTMLElement; source: string; matrix: Matrix };
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

export const REGION_COLOR = '#ff2d55';
const SVG_NS = 'http://www.w3.org/2000/svg';

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

export function regionFromPoints(a: NormalizedPoint, b: NormalizedPoint): BoxRegion {
  return {
    kind: 'box',
    from: [Math.min(a[0], b[0]), Math.min(a[1], b[1])],
    to: [Math.max(a[0], b[0]), Math.max(a[1], b[1])],
  };
}

export function regionCorners({ from, to }: BoxRegion): NormalizedPoint[] {
  return [from, [to[0], from[1]], to, [from[0], to[1]]];
}

/** Points closer than this to the last kept point are dropped; it is 0.4% of the image edge. */
const STROKE_STEP = 0.004;

export function appendStrokePoint(points: NormalizedPoint[], point: NormalizedPoint) {
  const last = points[points.length - 1];
  if (!last || Math.hypot(point[0] - last[0], point[1] - last[1]) >= STROKE_STEP)
    points.push(point);
}

/** Thins a drawn stroke and resamples it evenly to the schema cap; undefined for a dot. */
export function strokeRegion(points: readonly NormalizedPoint[]): StrokeRegion | undefined {
  if (points.length < 2) return undefined;
  const last = points.length - 1;
  const kept =
    points.length <= DESIGN_STROKE_POINTS_MAX
      ? points
      : Array.from(
          { length: DESIGN_STROKE_POINTS_MAX },
          (_, index) => points[Math.round((index * last) / (DESIGN_STROKE_POINTS_MAX - 1))]
        );
  return { kind: 'stroke', points: kept.map(([u, v]): NormalizedPoint => [u, v]) };
}

/** A region's outline in image coordinates: a box's corners, or a stroke's own points. */
export function regionOutline(region: NoteRegion): NormalizedPoint[] {
  return region.kind === 'box' ? regionCorners(region) : region.points;
}

/** Where the region's number sits: the box corner, or the stroke's first point. */
export function regionAnchor(region: NoteRegion): NormalizedPoint {
  return regionOutline(region)[0];
}

/** The numbered badge radius for a marked copy or snapshot of the given edge. */
export function noteBadgeRadius(edge: number) {
  return Math.max(10, Math.round(edge * 0.018));
}

function paintBadge(context: Canvas2D, x: number, y: number, radius: number, number: number) {
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fillStyle = REGION_COLOR;
  context.fill();
  context.strokeStyle = '#ffffff';
  context.lineWidth = Math.max(2, radius / 6);
  context.stroke();
  context.fillStyle = '#ffffff';
  context.font = `700 ${Math.round(radius * 1.1)}px Inter, system-ui, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(String(number), x, y);
}

export function drawNoteRegions(
  context: Canvas2D,
  regions: readonly { badge: number; region: NoteRegion }[],
  width: number,
  height: number
) {
  const edge = Math.max(width, height);
  const line = Math.max(3, Math.round(edge * 0.005));
  const badge = noteBadgeRadius(edge);
  regions.forEach(({ badge: number, region }) => {
    const points = regionOutline(region).map(
      ([u, v]): NormalizedPoint => [u * width, v * height]
    );
    context.beginPath();
    points.forEach(([x, y], index) =>
      index ? context.lineTo(x, y) : context.moveTo(x, y)
    );
    if (region.kind === 'box') context.closePath();
    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.strokeStyle = '#ffffff';
    context.lineWidth = line + 4;
    context.stroke();
    context.strokeStyle = REGION_COLOR;
    context.lineWidth = line;
    context.stroke();
    const [x, y] = points[0];
    paintBadge(context, x, y, badge, number);
  });
}

/**
 * One note's annotation on the whole-artwork snapshot, already projected into
 * snapshot pixels: every note gets its numbered badge; a region note also gets
 * its outline. Badge and stroke sizes follow the snapshot edge, matching the
 * marked-copy style at any canvas size.
 */
export function drawNoteAnnotations(
  context: Canvas2D,
  notes: readonly { badge: number; at: NormalizedPoint; outline?: NormalizedPoint[]; closed?: boolean }[],
  width: number,
  height: number
) {
  const edge = Math.max(width, height);
  const line = Math.max(3, Math.round(edge * 0.005));
  const badge = noteBadgeRadius(edge);
  notes.forEach((note) => {
    if (note.outline?.length) {
      context.beginPath();
      note.outline.forEach(([x, y], index) =>
        index ? context.lineTo(x, y) : context.moveTo(x, y)
      );
      if (note.closed) context.closePath();
      context.lineJoin = 'round';
      context.lineCap = 'round';
      context.strokeStyle = '#ffffff';
      context.lineWidth = line + 4;
      context.stroke();
      context.strokeStyle = REGION_COLOR;
      context.lineWidth = line;
      context.stroke();
    }
    paintBadge(context, note.at[0], note.at[1], badge, note.badge);
  });
}

export function svgOverlay() {
  const overlay = document.createElementNS(SVG_NS, 'svg');
  overlay.setAttribute('class', 'molly-note-regions');
  overlay.setAttribute('aria-hidden', 'true');
  return overlay;
}

/** Boxes are shaded polygons; strokes are the plain line the brush drew. */
export function paintRegion(
  overlay: SVGSVGElement,
  geo: ImageGeometry,
  region: NoteRegion,
  stroke: string
) {
  const box = region.kind === 'box';
  const node = document.createElementNS(SVG_NS, box ? 'polygon' : 'polyline');
  node.setAttribute(
    'points',
    regionOutline(region)
      .map((point) => toScreen(geo, point).join(','))
      .join(' ')
  );
  node.setAttribute('fill', box ? 'rgb(255 45 85 / .12)' : 'none');
  node.setAttribute('stroke', stroke);
  node.setAttribute('stroke-width', '2.5');
  node.setAttribute('stroke-linejoin', 'round');
  node.setAttribute('stroke-linecap', 'round');
  overlay.append(node);
}

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
  const points = corners.map((corner): NormalizedPoint => {
    const rect = corner.getBoundingClientRect();
    return [rect.left, rect.top];
  });
  probe.remove();
  return points;
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

export function imageGeometry(elementId: string): ImageGeometry | undefined {
  const node = document.querySelector<HTMLElement>(
    `.ed-stage-scale [data-el-id="${CSS.escape(elementId)}"]`
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

export function toScreen(geo: ImageGeometry, [u, v]: NormalizedPoint): NormalizedPoint {
  return apply(geo.matrix, u, v);
}

export function toImage(geo: ImageGeometry, x: number, y: number): NormalizedPoint | undefined {
  const inverse = invert(geo.matrix);
  if (!inverse) return undefined;
  const [u, v] = apply(inverse, x, y);
  return [clamp01(u), clamp01(v)];
}
