import type { DesignNote } from '@molly/shared/design-selection-commands';

export type NoteRegion = NonNullable<DesignNote['region']>;
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

export function regionFromPoints(a: NormalizedPoint, b: NormalizedPoint): NoteRegion {
  return {
    from: [Math.min(a[0], b[0]), Math.min(a[1], b[1])],
    to: [Math.max(a[0], b[0]), Math.max(a[1], b[1])],
  };
}

export function regionCorners({ from, to }: NoteRegion): NormalizedPoint[] {
  return [from, [to[0], from[1]], to, [from[0], to[1]]];
}

export function drawNoteRegions(
  context: Canvas2D,
  regions: readonly { badge: number; region: NoteRegion }[],
  width: number,
  height: number
) {
  const edge = Math.max(width, height);
  const line = Math.max(3, Math.round(edge * 0.005));
  const badge = Math.max(10, Math.round(edge * 0.018));
  regions.forEach(({ badge: number, region }) => {
    const points = regionCorners(region).map(
      ([u, v]): NormalizedPoint => [u * width, v * height]
    );
    context.beginPath();
    points.forEach(([x, y], index) =>
      index ? context.lineTo(x, y) : context.moveTo(x, y)
    );
    context.closePath();
    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.strokeStyle = '#ffffff';
    context.lineWidth = line + 4;
    context.stroke();
    context.strokeStyle = REGION_COLOR;
    context.lineWidth = line;
    context.stroke();
    const [x, y] = points[0];
    context.beginPath();
    context.arc(x, y, badge, 0, Math.PI * 2);
    context.fillStyle = REGION_COLOR;
    context.fill();
    context.strokeStyle = '#ffffff';
    context.lineWidth = Math.max(2, badge / 6);
    context.stroke();
    context.fillStyle = '#ffffff';
    context.font = `700 ${Math.round(badge * 1.1)}px Inter, system-ui, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(String(number), x, y);
  });
}

export function svgOverlay() {
  const overlay = document.createElementNS(SVG_NS, 'svg');
  overlay.setAttribute('class', 'molly-note-regions');
  overlay.setAttribute('aria-hidden', 'true');
  return overlay;
}

export function paintRegionPolygon(
  overlay: SVGSVGElement,
  geo: ImageGeometry,
  region: NoteRegion,
  stroke: string
) {
  const node = document.createElementNS(SVG_NS, 'polygon');
  node.setAttribute(
    'points',
    regionCorners(region)
      .map((point) => toScreen(geo, point).join(','))
      .join(' ')
  );
  node.setAttribute('fill', 'rgb(255 45 85 / .12)');
  node.setAttribute('stroke', stroke);
  node.setAttribute('stroke-width', '2.5');
  node.setAttribute('stroke-linejoin', 'round');
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
