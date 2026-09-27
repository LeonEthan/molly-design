const { app, BrowserWindow, nativeImage } = require('electron');
const { readFileSync, mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { crc32, deflateSync } = require('node:zlib');
const ts = require('typescript');

const profile = mkdtempSync(join(tmpdir(), 'molly-image-sampling-'));
app.setPath('userData', profile);
app.on('window-all-closed', () => {});

function chunk(name, bytes) {
  const body = Buffer.concat([Buffer.from(name), bytes]);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(bytes.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([size, body, checksum]);
}

function rgba16() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 16;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from([0, 0, 0, 0, 0, 0, 0, 255, 255]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function animated(png) {
  const control = Buffer.alloc(8);
  control.writeUInt32BE(1);
  const frame = Buffer.alloc(26);
  frame.writeUInt32BE(12, 4);
  frame.writeUInt32BE(12, 8);
  frame.writeUInt16BE(1, 20);
  frame.writeUInt16BE(10, 22);
  return Buffer.concat([
    png.subarray(0, 33),
    chunk('acTL', control),
    chunk('fcTL', frame),
    png.subarray(33),
  ]);
}

async function verify(sources) {
  const assert = (condition, message) => {
    if (!condition) throw Error(message);
  };
  const normalized = await window.sampling.prepareImageSampling(sources.plain);
  assert(normalized.width === 10 && normalized.height === 10, 'Sampling border dimensions');
  assert(normalized.left === 1 && normalized.top === 1, 'Sampling offset');
  assert(normalized.transparentBorder, 'Transparent frame edges');
  const alreadyNormalized = await window.sampling.prepareImageSampling(normalized.source);
  assert(alreadyNormalized.normalized, 'Already-normalized bitmap lost its sampling mode');
  for (const key of ['gamma', 'highDepth', 'animated', 'empty']) {
    const prepared = await window.sampling.prepareImageSampling(sources[key]);
    assert(prepared.source === sources[key], `${key} encoding changed`);
  }
  for (const fit of ['fill', 'contain', 'cover']) {
    const host = document.createElement('div');
    const frame = { x: 17.25, y: 21.75, w: 96, h: 48, radius: 0, fit };
    host.style.cssText = 'position:absolute;left:17.25px;top:21.75px;width:96px;height:48px';
    const content = window.sampling.renderSampledImage(sources.plain, frame, host);
    host.append(content);
    document.body.append(host);
    const image = host.querySelector('img');
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    assert(context.getImageData(2, 2, 1, 1).data[3] === 1, 'Alpha one was removed');
    assert(content.style.overflow === (fit === 'cover' ? 'hidden' : 'visible'), 'Frame clipping');
    for (const [x, y, width, height] of [
      [0, 0, 64, 64],
      [17.25, 21.75, 96, 48],
      [0, 0, 128, 128],
    ]) {
      Object.assign(host.style, {
        left: `${x}px`,
        top: `${y}px`,
        width: `${width}px`,
        height: `${height}px`,
      });
      await new Promise((resolve) => requestAnimationFrame(resolve));
      assert(
        content.style.overflow === (fit === 'cover' && width !== height ? 'hidden' : 'visible'),
        'Live cover clipping'
      );
      const scale =
        fit === 'cover' ? Math.max(width / 12, height / 12) : Math.min(width / 12, height / 12);
      const sx = fit === 'fill' ? width / 12 : scale,
        sy = fit === 'fill' ? height / 12 : scale;
      const rect = image.getBoundingClientRect();
      const expected = [
        x + (width - 12 * sx) / 2 + sx,
        y + (height - 12 * sy) / 2 + sy,
        10 * sx,
        10 * sy,
      ];
      assert(
        [rect.x, rect.y, rect.width, rect.height].every(
          (value, i) => Math.abs(value - expected[i]) < 0.01
        ),
        `${fit} live geometry`
      );
      assert(
        Number.parseFloat(host.style.left) === x && Number.parseFloat(host.style.top) === y,
        'Editor coordinates changed'
      );
    }
    host.remove();
    const rounded = window.sampling.renderSampledImage(
      sources.plain,
      { ...frame, radius: 4 },
      host
    );
    assert(rounded.style.overflow === 'hidden', 'Rounded clipping removed');
  }
  return {
    status: 'passed',
    deviceScale: devicePixelRatio,
    originalEncodings: 4,
    liveFrames: 9,
    alphaOne: true,
  };
}

void (async () => {
  let window;
  let status = 0;
  try {
    await app.whenReady();
    const bitmap = Buffer.alloc(12 * 12 * 4);
    for (let y = 3; y < 9; y++)
      for (let x = 3; x < 9; x++) bitmap[(y * 12 + x) * 4 + 3] = x === 3 && y === 3 ? 1 : 255;
    const plain = nativeImage
      .createFromBitmap(bitmap, { width: 12, height: 12, scaleFactor: 1 })
      .toPNG();
    const gamma = Buffer.alloc(4);
    gamma.writeUInt32BE(45455);
    const sources = Object.fromEntries(
      Object.entries({
        plain,
        gamma: Buffer.concat([plain.subarray(0, 33), chunk('gAMA', gamma), plain.subarray(33)]),
        highDepth: rgba16(),
        animated: animated(plain),
        empty: nativeImage
          .createFromBitmap(Buffer.alloc(12 * 12 * 4), { width: 12, height: 12, scaleFactor: 1 })
          .toPNG(),
      }).map(([key, bytes]) => [key, `data:image/png;base64,${bytes.toString('base64')}`])
    );
    const helper = ts.transpile(readFileSync(join(__dirname, '../src/image-sampling.ts'), 'utf8'), {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    });
    window = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    await window.loadURL('data:text/html,<body style="margin:0">');
    await window.webContents.executeJavaScript(
      `window.sampling = (() => { const exports = {}; ${helper}; return exports; })(); void 0`
    );
    console.log(
      JSON.stringify(
        await window.webContents.executeJavaScript(
          `(${verify.toString()})(${JSON.stringify(sources)})`
        )
      )
    );
  } catch (error) {
    status = 1;
    console.error(error);
  } finally {
    window?.destroy();
    rmSync(profile, { recursive: true, force: true });
    app.exit(status);
  }
})();
