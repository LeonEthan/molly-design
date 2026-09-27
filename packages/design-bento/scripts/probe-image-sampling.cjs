const assert = require('node:assert/strict');
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto');
const artifactRoot = path.resolve(__dirname, '../../../e2e/artifacts/transparent-margin-mechanism');
fs.mkdirSync(artifactRoot, { recursive: true });
const out = fs.mkdtempSync(path.join(artifactRoot, 'run-'));
app.setPath('userData', path.join(out, 'profile'));
app.on('window-all-closed', () => {});
function asset(left = 0, top = 0, width = 128, height = 128) {
  const b = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const u = x + left - 19,
        v = y + top - 23;
      if (u < 0 || u >= 90 || v < 0 || v >= 80) continue;
      const i = (y * width + x) * 4;
      b[i] = (5 * u + 17 * v) % 256;
      b[i + 1] = (19 * u + 7 * v) % 256;
      b[i + 2] = (Math.floor(u / 2) + Math.floor(v / 2)) % 2 ? 220 : 30;
      b[i + 3] = 255;
    }
  return nativeImage.createFromBitmap(b, { width, height, scaleFactor: 1 }).toDataURL();
}
function diff(a, b) {
  if (a.length !== b.length) throw Error('size mismatch');
  let pixels = 0,
    max = 0;
  for (let i = 0; i < a.length; i += 4) {
    let d = 0;
    for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(a[i + c] - b[i + c]));
    if (d) pixels++;
    max = Math.max(max, d);
  }
  return { pixels, max };
}
function columns(image) {
  const { width, height } = image.getSize();
  const b = image.toBitmap(),
    half = width / 2,
    l = Buffer.alloc(half * height * 4),
    r = Buffer.alloc(l.length);
  for (let y = 0; y < height; y++) {
    b.copy(l, y * half * 4, y * width * 4, (y * width + half) * 4);
    b.copy(r, y * half * 4, (y * width + half) * 4, (y + 1) * width * 4);
  }
  return diff(l, r);
}
async function prepareImages(input) {
  const { scale, left, top, x, y } = input;
  document.body.style.cssText = 'margin:0;background:#F4F1E8';
  const bounds = [
    [x, y, 128 * scale, 128 * scale],
    [x + 256 + left * scale, y + top * scale, 94 * scale, 84 * scale],
  ];
  const images = await Promise.all(
    [input.full, input.crop].map(async (src, index) => {
      const image = new Image();
      image.src = src;
      await image.decode();
      const [imageX, imageY, width, height] = bounds[index];
      Object.assign(image.style, {
        position: 'absolute',
        objectFit: 'fill',
        left: `${imageX}px`,
        top: `${imageY}px`,
        width: `${width}px`,
        height: `${height}px`,
      });
      return image;
    })
  );
  document.body.replaceChildren(...images);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  window.probe = { images, bounds };
  return {
    dpr: devicePixelRatio,
    bounds,
    rects: images.map((image) => image.getBoundingClientRect().toJSON()),
  };
}

async function drawModel({ model, nativeDpr, rects }) {
  const { images, bounds } = window.probe;
  const dpr = devicePixelRatio;
  if (model === 'transform') {
    images.forEach((image, index) => {
      const [x, y, width, height] = bounds[index];
      image.style.cssText = 'position:absolute;left:0;top:0;transform-origin:0 0';
      Object.assign(image.style, {
        width: `${image.naturalWidth}px`,
        height: `${image.naturalHeight}px`,
        transform: `translate(${x}px,${y}px) scale(${width / image.naturalWidth},${height / image.naturalHeight})`,
      });
    });
    document.body.replaceChildren(...images);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 512 * dpr;
  canvas.height = 208 * dpr;
  canvas.style.cssText = 'width:512px;height:208px';
  const context = canvas.getContext('2d');
  context.fillStyle = '#F4F1E8';
  context.fillRect(0, 0, canvas.width, canvas.height);
  images.forEach((image, index) => {
    let [x, y, width, height] = bounds[index];
    if (model === 'layout' || model === 'native-layout-snap') {
      ({ x, y, width, height } = rects[index]);
    }
    if (model === 'native-snap' || model === 'native-layout-snap') {
      const right = Math.round((x + width) * nativeDpr) / nativeDpr;
      const bottom = Math.round((y + height) * nativeDpr) / nativeDpr;
      x = Math.round(x * nativeDpr) / nativeDpr;
      y = Math.round(y * nativeDpr) / nativeDpr;
      width = right - x;
      height = bottom - y;
    }
    x *= dpr;
    y *= dpr;
    width *= dpr;
    height *= dpr;
    if (model === 'round-edges') {
      const right = Math.round(x + width),
        bottom = Math.round(y + height);
      x = Math.round(x);
      y = Math.round(y);
      width = right - x;
      height = bottom - y;
    }
    context.drawImage(image, x, y, width, height);
  });
  document.body.replaceChildren(canvas);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return canvas.toDataURL();
}

const report = {
  scope: 'Minimal Chromium image-paint diagnostic, not application E2E',
  scriptSha256: crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),
  versions: process.versions,
  nativeDpr: null,
  cases: [],
};
const persist = () =>
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
(async () => {
  await app.whenReady();
  const w = new BrowserWindow({
    show: false,
    width: 512,
    height: 208,
    useContentSize: true,
    webPreferences: { backgroundThrottling: false },
  });
  await w.loadURL('data:text/html,<html><body></body></html>');
  const nativeDpr = await w.webContents.executeJavaScript('devicePixelRatio');
  report.nativeDpr = nativeDpr;
  w.webContents.debugger.attach('1.3');
  for (const dpr of [...new Set([nativeDpr, 1, 2, 3])]) {
    await w.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
      width: 512,
      height: 208,
      deviceScaleFactor: dpr,
      mobile: false,
    });
    for (const spec of [
      { name: 'one', scale: 1, left: 17, top: 21, x: 32, y: 40 },
      { name: 'half', scale: 0.5, left: 17, top: 21, x: 32, y: 40 },
      { name: '75', scale: 0.75, left: 17, top: 21, x: 32, y: 40 },
      { name: '75aligned', scale: 0.75, left: 16, top: 20, x: 32, y: 40 },
      {
        name: 'fraction',
        scale: 623 / 858,
        left: 17,
        top: 21,
        x: 32.87995337995335,
        y: 40.07925407925404,
      },
    ]) {
      const input = { ...spec, full: asset(), crop: asset(spec.left, spec.top, 94, 84) };
      const result = await w.webContents.executeJavaScript(
        `(${prepareImages.toString()})(${JSON.stringify(input)})`
      );
      const grab = async () =>
        nativeImage.createFromBuffer(
          Buffer.from(
            (
              await w.webContents.debugger.sendCommand('Page.captureScreenshot', {
                format: 'png',
                fromSurface: true,
                captureBeyondViewport: false,
              })
            ).data,
            'base64'
          )
        );
      assert.equal(result.dpr, dpr, 'Device emulation did not apply');
      const html = await grab();
      assert.deepEqual(html.getSize(), { width: 512 * dpr, height: 208 * dpr });
      fs.writeFileSync(path.join(out, `${spec.name}-dpr${dpr}-html.png`), html.toPNG());
      const record = {
        name: spec.name,
        requestedDpr: dpr,
        ...result,
        size: html.getSize(),
        html: columns(html),
        models: {},
      };
      for (const model of [
        'exact',
        'layout',
        'round-edges',
        'native-snap',
        'native-layout-snap',
        'transform',
      ]) {
        const data = await w.webContents.executeJavaScript(
          `(${drawModel.toString()})(${JSON.stringify({ model, nativeDpr, rects: result.rects })})`
        );
        const image = await grab();
        if (model === 'exact' || model === 'native-layout-snap') {
          fs.writeFileSync(path.join(out, `${spec.name}-dpr${dpr}-${model}.png`), image.toPNG());
        }
        record.models[model] = {
          pairs: columns(image),
          vsHtml: diff(html.toBitmap(), image.toBitmap()),
          readbackMatchesCapture: data
            ? diff(nativeImage.createFromDataURL(data).toBitmap(), image.toBitmap())
            : null,
        };
      }
      report.cases.push(record);
      persist();
      for (const value of Object.values(record.models)) {
        if (value.readbackMatchesCapture)
          assert.equal(
            value.readbackMatchesCapture.pixels,
            0,
            'Capture differs from canvas readback'
          );
      }
      if (dpr === nativeDpr)
        assert.equal(
          record.models['native-layout-snap'].vsHtml.pixels,
          0,
          'Snapped model does not reproduce HTML'
        );
      console.log(
        JSON.stringify({
          name: record.name,
          dpr,
          html: record.html,
          snappedVsHtml: record.models['native-layout-snap'].vsHtml,
          exact: record.models.exact.pairs,
        })
      );
    }
  }
  w.destroy();
  console.log(out);
  app.exit(0);
})().catch((e) => {
  report.error = String(e);
  persist();
  console.error(e);
  console.error(out);
  app.exit(2);
});
