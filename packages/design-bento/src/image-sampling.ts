interface SamplingImage {
  source: string;
  normalized: boolean;
  originalSize: { width: number; height: number };
  left: number;
  top: number;
  width: number;
  height: number;
  transparentBorder: boolean;
}

const samplingImages = new Map<string, { image?: SamplingImage; ready: Promise<SamplingImage> }>();

function requiresOriginalPng(source: string): boolean {
  const bytes = atob(source.slice(source.indexOf(',') + 1));
  if (bytes.charCodeAt(24) !== 8) return true;
  for (let offset = 8; offset + 12 <= bytes.length; ) {
    const size =
      bytes.charCodeAt(offset) * 16777216 +
      bytes.charCodeAt(offset + 1) * 65536 +
      bytes.charCodeAt(offset + 2) * 256 +
      bytes.charCodeAt(offset + 3);
    const chunk = bytes.slice(offset + 4, offset + 8);
    if (['acTL', 'iCCP', 'cICP', 'gAMA', 'cHRM'].includes(chunk)) return true;
    offset += size + 12;
  }
  return false;
}

async function samplingImage(source: string): Promise<SamplingImage> {
  const image = new Image();
  image.src = source;
  await image.decode();
  const original = {
    source,
    normalized: false,
    originalSize: { width: image.naturalWidth, height: image.naturalHeight },
    left: 0,
    top: 0,
    width: image.naturalWidth,
    height: image.naturalHeight,
    transparentBorder: false,
  };
  if (!source.startsWith('data:image/png;base64,') || requiresOriginalPng(source)) return original;
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw Error('Image sampling canvas unavailable');
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let left = canvas.width,
    top = canvas.height,
    right = 0,
    bottom = 0;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (pixels[(y * canvas.width + x) * 4 + 3] === 0) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x + 1);
      bottom = Math.max(bottom, y + 1);
    }
  }
  if (right === 0) {
    canvas.width = canvas.height = 0;
    return original;
  }
  const sampled = document.createElement('canvas');
  sampled.width = right - left + 4;
  sampled.height = bottom - top + 4;
  const sampledContext = sampled.getContext('2d');
  if (!sampledContext) throw Error('Image sampling canvas unavailable');
  sampledContext.drawImage(
    canvas,
    left,
    top,
    right - left,
    bottom - top,
    2,
    2,
    right - left,
    bottom - top
  );
  const result = {
    source: sampled.toDataURL('image/png'),
    normalized: true,
    originalSize: original.originalSize,
    left: left - 2,
    top: top - 2,
    width: sampled.width,
    height: sampled.height,
    transparentBorder: left > 0 && top > 0 && right < canvas.width && bottom < canvas.height,
  };
  canvas.width = canvas.height = sampled.width = sampled.height = 0;
  return result;
}

export function prepareImageSampling(source: string): Promise<SamplingImage> {
  const existing = samplingImages.get(source);
  if (existing) return existing.ready;
  const entry: { image?: SamplingImage; ready: Promise<SamplingImage> } = {
    ready: samplingImage(source),
  };
  entry.ready = entry.ready.then((image) => {
    entry.image = image;
    return image;
  });
  samplingImages.set(source, entry);
  return entry.ready;
}

export function renderSampledImage(
  source: string,
  frame: {
    fit: 'fill' | 'contain' | 'cover';
    radius: number;
    x: number;
    y: number;
    w: number;
    h: number;
  },
  host: HTMLElement
): HTMLElement {
  const container = document.createElement('div');
  container.style.cssText = `width:100%;height:100%;position:relative;overflow:hidden;border-radius:${frame.radius}px`;
  const image = document.createElement('img');
  image.draggable = false;
  image.style.cssText =
    'position:absolute;left:0;top:0;display:block;max-width:none;transform-origin:0 0';
  let sampling: SamplingImage | undefined;
  let previousFrame = '';
  const initialStyle = [host.style.left, host.style.top, host.style.width, host.style.height];
  const sync = () => {
    if (!sampling) return;
    const x = host.style.left === initialStyle[0] ? frame.x : Number.parseFloat(host.style.left);
    const y = host.style.top === initialStyle[1] ? frame.y : Number.parseFloat(host.style.top);
    const width =
      host.style.width === initialStyle[2] ? frame.w : Number.parseFloat(host.style.width);
    const height =
      host.style.height === initialStyle[3] ? frame.h : Number.parseFloat(host.style.height);
    const nextFrame = [x, y, width, height].join(',');
    if (nextFrame === previousFrame) return;
    previousFrame = nextFrame;
    host.style.marginLeft = `${-x}px`;
    host.style.marginTop = `${-y}px`;
    host.style.translate = `${x}px ${y}px`;
    host.style.transformOrigin = `${width / 2}px ${height / 2}px`;
    const size = sampling.originalSize;
    const horizontal = width / size.width;
    const vertical = height / size.height;
    const scale =
      frame.fit === 'cover' ? Math.max(horizontal, vertical) : Math.min(horizontal, vertical);
    const scaleX = frame.fit === 'fill' ? horizontal : scale;
    const scaleY = frame.fit === 'fill' ? vertical : scale;
    const offsetX = (width - size.width * scaleX) / 2 + sampling.left * scaleX;
    const offsetY = (height - size.height * scaleY) / 2 + sampling.top * scaleY;
    const visibleInsideFrame =
      offsetX + 2 * scaleX > 0 &&
      offsetY + 2 * scaleY > 0 &&
      offsetX + (sampling.width - 2) * scaleX < width &&
      offsetY + (sampling.height - 2) * scaleY < height;
    container.style.overflow =
      sampling.transparentBorder && !frame.radius && visibleInsideFrame ? 'visible' : 'hidden';
    image.style.transform = `translate(${offsetX}px,${offsetY}px) scale(${scaleX},${scaleY})`;
  };
  const apply = (prepared: SamplingImage) => {
    sampling = prepared;
    image.width = prepared.width;
    image.height = prepared.height;
    image.src = prepared.source;
    image.style.willChange = prepared.normalized ? 'transform' : 'auto';
    previousFrame = '';
    sync();
  };
  const prepared = samplingImages.get(source)?.image;
  if (prepared) apply(prepared);
  else
    void prepareImageSampling(source)
      .then(apply)
      .catch((error: unknown) => {
        image.alt = 'Image rendering failed';
        image.dispatchEvent(new Event('error'));
        reportError(error);
      });
  new MutationObserver(sync).observe(host, { attributes: true, attributeFilter: ['style'] });
  container.appendChild(image);
  return container;
}
