import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const cliRequire = createRequire(new URL('../apps/cli/package.json', import.meta.url));
const electronRequire = createRequire(new URL('../apps/electron/package.json', import.meta.url));
const script = fileURLToPath(import.meta.url);
const fixtureDir = join(import.meta.dirname, 'g3-fixtures');
const designDir = resolve(import.meta.dirname, '../apps/electron/resources/design');
export const fixtures = ['sample-800x600', 'large-3000x2000', 'heavy-shadow-bleed-3000x2000'];

export async function decodePng(bytes) {
  const sharp = cliRequire('sharp');
  const image = sharp(bytes);
  assert.equal((await image.metadata()).format, 'png');
  const { data, info } = await image
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

export function compare(
  ref,
  cand,
  {
    tileEdge = 1536,
    captureDPR = 1,
    hostNativeDPR = null,
    targetScale = 1,
    crossEngine = false,
  } = {}
) {
  const { width, height } = ref;
  for (const image of [ref, cand]) {
    assert.equal(image.width, width);
    assert.equal(image.height, height);
    assert.equal(image.data.length, width * height * 4);
  }
  for (const n of [width, height, tileEdge]) assert(Number.isSafeInteger(n) && n > 0);
  for (const n of [captureDPR, targetScale]) assert(Number.isFinite(n) && n > 0);
  const pixelCount = width * height;
  let rgb = 0,
    alpha = 0;
  const diff = (i, c) => Math.abs(ref.data[i + c] - cand.data[i + c]);
  for (let i = 0; i < pixelCount * 4; i += 4) {
    rgb += diff(i, 0) + diff(i, 1) + diff(i, 2);
    alpha += diff(i, 3);
  }
  let seamMax = 0,
    worstWindow = null;
  function scan(vertical) {
    const across = vertical ? width : height,
      along = vertical ? height : width;
    const length = Math.min(32, along);
    for (let seam = tileEdge; seam < across; seam += tileEdge) {
      const start = Math.max(0, seam - 4),
        end = Math.min(across, seam + 4);
      const sums = new Float64Array(length * 4),
        rolling = new Float64Array(4);
      for (let pos = 0; pos < along; pos++) {
        for (let c = 0; c < 4; c++) {
          const slot = (pos % length) * 4 + c;
          rolling[c] -= sums[slot];
          let sum = 0;
          for (let a = start; a < end; a++)
            sum += diff(4 * (vertical ? pos * width + a : a * width + pos), c);
          sums[slot] = sum;
          rolling[c] += sum;
          if (pos + 1 < length) continue;
          const mean = rolling[c] / ((end - start) * length * 255);
          if (mean > seamMax) {
            seamMax = mean;
            worstWindow = {
              axis: vertical ? 'x' : 'y',
              seam,
              start: pos - length + 1,
              channel: 'RGBA'[c],
            };
          }
        }
      }
    }
  }
  scan(true);
  scan(false);
  const rgbMAE = rgb / (pixelCount * 3 * 255),
    alphaMAE = alpha / (pixelCount * 255);
  return {
    width,
    height,
    hostNativeDPR,
    captureDPR,
    targetScale,
    resamplingMode: captureDPR === targetScale ? 'direct-1to1' : 'area-resampled',
    rgbMAE,
    alphaMAE,
    ...(crossEngine
      ? {
          crossEngineSeamWindowMax: seamMax,
          legacyStage3ACrossEngineSeamPassed: seamMax <= 1.5 / 255,
        }
      : { seamMax }),
    worstWindow,
    passed:
      alphaMAE <= 0.5 / 255 &&
      (crossEngine ? rgbMAE <= 2 / 255 : rgbMAE <= 0.5 / 255 && seamMax <= 1.5 / 255),
  };
}

async function areaHalf(image) {
  const { width, height, data } = image;
  assert(width % 2 === 0 && height % 2 === 0, '2:1 box sampling requires even PNG dimensions');
  const output = Buffer.alloc(width * height);
  for (let y = 0; y < height; y += 2)
    for (let x = 0; x < width; x += 2) {
      const i = 4 * (y * width + x),
        j = (y / 2) * width * 2 + x * 2;
      let alpha = 0;
      const rgb = [0, 0, 0];
      for (const k of [i, i + 4, i + width * 4, i + width * 4 + 4]) {
        alpha += data[k + 3];
        for (let c = 0; c < 3; c++) rgb[c] += data[k + c] * data[k + 3];
      }
      for (let c = 0; c < 3; c++) output[j + c] = alpha ? Math.round(rgb[c] / alpha) : 0;
      output[j + 3] = Math.round(alpha / 4);
    }
  return { width: width / 2, height: height / 2, data: output };
}

export async function compareScales(ref, cand, meta = {}, areaCandidate, areaReference) {
  const direct = compare(ref, cand, meta);

  const area = compare(
    areaReference ?? (await areaHalf(ref)),
    areaCandidate ?? (await areaHalf(cand)),
    {
      ...meta,
      tileEdge: (meta.tileEdge ?? 1536) / 2,
      targetScale: direct.targetScale / 2,
    }
  );
  return { direct, area, passed: direct.passed && area.passed };
}

function run(exe, args, env) {
  const result = spawnSync(exe, args, {
    env,
    cwd: env.MOLLY_G3_SANDBOX ? env.HOME : resolve(import.meta.dirname, '..'),
    encoding: 'utf8',
    timeout: 120000,
    killSignal: 'SIGKILL',
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

async function prepareStage({ width, height }, large, target) {
  const stage = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          Error(
            'Bento stage timed out: ' +
              document.body.innerText.slice(-800) +
              ' ' +
              Boolean(window.bento) +
              ' ' +
              Boolean(document.querySelector('.bento-slide'))
          )
        ),
      20000
    );
    const observer = new MutationObserver(check);
    function check() {
      const node = document.querySelector('.ed-stage-scale .bento-slide');
      if (!window.bento?.doc || !node) return;
      clearTimeout(timer);
      observer.disconnect();
      resolve(node);
    }
    observer.observe(document, { childList: true, subtree: true });
    check();
  });
  if (stage.offsetWidth !== width || stage.offsetHeight !== height)
    throw Error('Incorrect stage dimensions');
  await document.fonts.ready;
  if ([...document.fonts].some((face) => face.status === 'error'))
    throw Error('Font decode failed');
  const images = [...stage.querySelectorAll('img')],
    vectors = [...stage.querySelectorAll('image')];
  if (large && !(images.length && vectors.length)) throw Error('Expected both HTML and SVG images');
  await Promise.all(
    [
      ...images,
      ...vectors.map((node) => {
        const image = new Image();
        image.src = node.getAttribute('href') || node.getAttribute('xlink:href');
        return image;
      }),
    ].map((image) => image.decode())
  );
  document.documentElement.style.cssText = document.body.style.cssText =
    'margin:0;background:transparent!important;overflow:hidden';
  stage.style.cssText += ';transform:none;position:absolute;left:0;top:0';
  const zoom = target / devicePixelRatio;
  stage.style.transformOrigin = 'top left';
  stage.style.transform = 'scale(' + zoom + ')';
  document.body.replaceChildren(stage);
  return devicePixelRatio * zoom;
}

async function electronReference(fixture, out) {
  const { app, BrowserWindow, protocol, session, screen } = await import('electron');
  const target = Number(process.env.MOLLY_G3_REFERENCE_SCALE ?? 1);
  app.setPath('userData', process.env.MOLLY_ELECTRON_USER_DATA_DIR);
  protocol.registerSchemesAsPrivileged([
    { scheme: 'molly-design', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
  await app.whenReady();
  const payload = JSON.parse(readFileSync(fixture));
  const canvas = payload.doc.canvas;
  const origin = 'molly-design://g3';
  const ws = '/ws/' + payload.association.sessionId;
  const isolated = session.fromPartition('g3');
  isolated.webRequest.onBeforeRequest((req, cb) =>
    cb({ cancel: !req.url.startsWith(origin + '/') && !/^(data|blob):/.test(req.url) })
  );
  isolated.protocol.handle('molly-design', (req) => {
    const path = new URL(req.url).pathname;
    if (path === ws) return Response.json(payload);
    if (path === '/editor.html')
      return new Response(readFileSync(join(designDir, 'editor.html')), {
        headers: {
          'Content-Type': 'text/html',
          'Content-Security-Policy':
            "default-src 'none'; script-src 'self' 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'self' data:; worker-src blob:",
        },
      });
    return new Response(null, { status: 404 });
  });
  const win = new BrowserWindow({
    width: canvas.width * target,
    height: canvas.height * target,
    useContentSize: true,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    enableLargerThanScreen: true,
    webPreferences: {
      offscreen: true,
      session: isolated,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.webContents.on('console-message', (event) => {
    if (event.level === 'error') console.error(event.message);
  });
  await win.loadURL(origin + '/editor.html?ws=' + payload.association.sessionId);
  const captureDPR = await win.webContents.executeJavaScript(
    '(' +
      prepareStage.toString() +
      ')(' +
      JSON.stringify(canvas) +
      ',' +
      fixture.endsWith('/large-3000x2000.json') +
      ',' +
      target +
      ')'
  );
  const expected = Buffer.from(payload.doc.background.color.slice(1), 'hex');
  const image = await new Promise((done, reject) => {
    const timer = setTimeout(
      () => reject(Error('Electron did not paint the fixture background')),
      15000
    );
    function painted(_event, _dirty, frame) {
      if (frame.isEmpty()) return;
      const pixel = frame.crop({ x: 0, y: 0, width: 1, height: 1 }).toBitmap();
      if (!expected.every((channel, i) => Math.abs(pixel[2 - i] - channel) <= 2)) return;
      clearTimeout(timer);
      win.webContents.off('paint', painted);
      done(frame);
    }
    win.webContents.on('paint', painted);
    win.webContents.invalidate();
  });
  writeFileSync(out, image.toPNG());
  writeFileSync(
    out + '.json',
    JSON.stringify({
      hostNativeDPR: screen.getDisplayMatching(win.getBounds()).scaleFactor,
      viewportDPR: await win.webContents.executeJavaScript('devicePixelRatio'),
      captureDPR,
    })
  );
  win.destroy();
  app.quit();
}

function sandbox(root, name) {
  const base = join(root, name);
  const env = {
    PATH: process.env.PATH,
    HOME: join(base, 'home'),
    TMPDIR: join(base, 'tmp'),
    MOLLY_DATA_DIR: join(base, 'data'),
    MOLLY_ELECTRON_USER_DATA_DIR: join(base, 'profile'),
  };
  for (const path of Object.values(env).slice(1)) mkdirSync(path, { recursive: true });
  env.CFFIXED_USER_HOME = env.HOME;
  env.MOLLY_G3_SANDBOX = root;
  return env;
}

export function detectsSeamMutation(controlPassed, mutation) {
  return controlPassed && mutation.seamMax > 1.5 / 255;
}

export async function verifyTruncatedShadow() {
  const fixture = JSON.parse(readFileSync(join(fixtureDir, fixtures[2] + '.json')));
  const { width, height } = fixture.doc.canvas;
  const caster = fixture.doc.elements[0];
  const [left, top, w, h] = caster.bounds;
  const sharp = cliRequire('sharp');
  const background = Buffer.from(fixture.doc.background.color.slice(1), 'hex');
  const shadow = Buffer.from(caster.shadow.color.slice(1), 'hex');
  const fill = Buffer.from(caster.fill.color.slice(1), 'hex');
  const bleed = Math.ceil(2.5 * caster.shadow.blur);
  async function render(tileEdge, bleedPx) {
    const data = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y += tileEdge)
      for (let x = 0; x < width; x += tileEdge) {
        const x0 = Math.max(0, x - bleedPx),
          y0 = Math.max(0, y - bleedPx);
        const x1 = Math.min(width, x + tileEdge + bleedPx),
          y1 = Math.min(height, y + tileEdge + bleedPx);
        const mask = Buffer.alloc((x1 - x0) * (y1 - y0));
        for (let row = Math.max(top, y0); row < Math.min(top + h, y1); row++) {
          const a = Math.max(left, x0),
            b = Math.min(left + w, x1);
          if (a < b)
            mask.fill(255, (row - y0) * (x1 - x0) + a - x0, (row - y0) * (x1 - x0) + b - x0);
        }
        const blurred = await sharp(mask, { raw: { width: x1 - x0, height: y1 - y0, channels: 1 } })
          .blur(caster.shadow.blur / 2)
          .greyscale()
          .raw()
          .toBuffer();
        for (let py = y; py < Math.min(height, y + tileEdge); py++)
          for (let px = x; px < Math.min(width, x + tileEdge); px++) {
            const covered = px >= left && px < left + w && py >= top && py < top + h;
            const a = blurred[(py - y0) * (x1 - x0) + px - x0] / 255;
            const out = (py * width + px) * 4;
            for (let c = 0; c < 3; c++)
              data[out + c] = covered
                ? fill[c]
                : Math.round(background[c] * (1 - a) + shadow[c] * a);
            data[out + 3] = 255;
          }
      }
    return { width, height, data };
  }
  const reference = await render(width, 0);
  const control = compare(reference, await render(1536, bleed));
  const mutation = compare(reference, await render(1536, 0));
  return {
    renderer: 'tile-local shadow convolution',
    fixture: fixtures[2],
    bleedPx: bleed,
    control,
    mutantBleedPx: 0,
    mutation,
    passed: detectsSeamMutation(control.passed, mutation),
  };
}

function buildMygo(root, variant = 'tiled') {
  const output = join(root, 'mygo-' + variant);
  const args = ['build', '-mod=readonly', '-o', output];
  const replacements = {};
  function instrument(file, edits) {
    const source = resolve(import.meta.dirname, '../internal/shell', file);
    let code = readFileSync(source, 'utf8');
    for (const [anchor, substitution] of edits) {
      assert.equal(code.split(anchor).length, 2, 'Update G3 bench instrumentation for ' + anchor);
      code = code.replace(anchor, substitution);
    }
    const replacement = join(root, file);
    writeFileSync(replacement, code);
    replacements[source] = replacement;
  }
  if (variant === 'single') {
    instrument('exporter.go', [['DefaultTileEdge      = 1536', 'DefaultTileEdge      = 8192']]);
  }
  if (variant === 'zero') {
    const anchor = 'const bounds = stage.getBoundingClientRect();';
    instrument('app.go', [
      [
        anchor,
        `
      document.body.style.cssText += ';position:fixed;inset:0;overflow:hidden';
      for (const source of stage.querySelectorAll('.bento-el')) {
        const rect = source.getBoundingClientRect();
        const outside = rect.right <= 0 || rect.bottom <= 0 ||
          rect.left >= innerWidth || rect.top >= innerHeight;
        source.style.clipPath = outside ? 'inset(50%%)' : '';
      }
      ` + anchor,
      ],
    ]);
    const signature = 'func ComputeDynamicBleedPx(docJSON []byte) int {';
    instrument('exporter.go', [[signature, signature + '\n if docJSON != nil {return 0}']]);
  }
  const overlay = join(root, 'overlay.json');
  writeFileSync(overlay, JSON.stringify({ Replace: replacements }));
  args.push('-overlay', overlay);
  run('go', [...args, './cmd/molly-desktop'], { ...process.env, CGO_ENABLED: '0' });
  return output;
}

export function summarizeBenchmark(reports, nativeMutation) {
  const passed =
    reports.every((report) => report.passed) && nativeMutation?.mutationDetected === true;
  return {
    reports,
    nativeMutation,
    gateProfile: 'stage3b-two-tier',
    stage3bTwoTierPassed: passed,
    legacyStage3ACrossEngineSeamPassed: reports.every(
      (report) => report.legacyStage3ACrossEngineSeamPassed
    ),
    passed,
  };
}

async function benchmark(options) {
  const root = mkdtempSync(join(tmpdir(), 'molly-g3-'));
  const reports = [];
  let nativeMutation;
  try {
    const binary = options.mygo ?? buildMygo(root);
    const singleBinary = buildMygo(root, 'single');
    const electron = electronRequire('electron');
    for (const name of options['native-mutation'] ? [fixtures[2]] : fixtures) {
      const fixture = join(fixtureDir, name + '.json'),
        reference = join(root, name + '.ref.png'),
        candidate = join(root, name + '.png');
      const mygoArgs = [
        '--design-dir',
        designDir,
        '--self-test-g3-sample',
        fixture,
        '--self-test-g3-out',
      ];
      const env = sandbox(root, name + '-mygo');
      const { width, height } = JSON.parse(readFileSync(fixture)).doc.canvas;
      async function capture(executable, targetScale, tileCount) {
        const receipt = JSON.parse(
          run(executable, [...mygoArgs, candidate], {
            ...env,
            MOLLY_G3_SCALE: String(targetScale),
          })
        );
        assert(receipt.passed && receipt.captureDPR === 2 && receipt.targetScale === targetScale);
        assert.equal(receipt.tileCount, tileCount);
        const image = await decodePng(readFileSync(candidate));
        assert.equal(image.width, width * targetScale);
        assert.equal(image.height, height * targetScale);
        return { receipt, image };
      }
      const scale = 2;
      const tiles = Math.ceil(width / 1536) * Math.ceil(height / 1536);
      const { receipt: report, image: actual } = await capture(binary, scale, tiles);
      const { image: areaOutput } = await capture(binary, 1, tiles);
      const { image: single } = await capture(singleBinary, scale, 1);
      const { image: singleArea } = await capture(singleBinary, 1, 1);
      const electronEnv = sandbox(root, name + '-electron');
      electronEnv.MOLLY_G3_REFERENCE_SCALE = String(scale);
      run(
        electron,
        [
          '--user-data-dir=' + electronEnv.MOLLY_ELECTRON_USER_DATA_DIR,
          '--use-mock-keychain',
          '--password-store=basic',
          script,
          '--electron-reference',
          fixture,
          reference,
        ],
        electronEnv
      );
      const meta = JSON.parse(readFileSync(reference + '.json'));
      const ref = await decodePng(readFileSync(reference));
      assert.equal(ref.width, width * meta.captureDPR);
      assert.equal(ref.height, height * meta.captureDPR);
      assert.equal(meta.captureDPR, scale);
      const comparison = {
        hostNativeDPR: report.hostNativeDPR,
        tileEdge: 1536 * scale,
        captureDPR: scale,
        targetScale: scale,
      };
      const sameEngine = await compareScales(single, actual, comparison, areaOutput, singleArea);
      const crossEngine = await compareScales(
        ref,
        actual,
        { ...comparison, crossEngine: true },
        areaOutput
      );
      reports.push({
        name,
        reference: meta,
        sameEngine,
        crossEngine,
        stage3bTwoTierPassed: sameEngine.passed && crossEngine.passed,
        legacyStage3ACrossEngineSeamPassed:
          crossEngine.direct.legacyStage3ACrossEngineSeamPassed &&
          crossEngine.area.legacyStage3ACrossEngineSeamPassed,
        passed: sameEngine.passed && crossEngine.passed,
      });
      if (name === fixtures[2]) {
        assert(report.bleedPx >= 180, 'Missing dynamic bleed on control');
        const mutated = join(root, 'zero.png');
        const mutant = options['mutant-mygo'] ?? buildMygo(root, 'zero');
        const receipt = JSON.parse(
          run(mutant, [...mygoArgs, mutated], {
            ...sandbox(root, 'mutant'),
            MOLLY_G3_SCALE: String(scale),
          })
        );
        assert(receipt.passed && receipt.bleedPx === 0);
        const diff = compare(actual, await decodePng(readFileSync(mutated)), {
          tileEdge: 1536 * scale,
          captureDPR: scale,
          targetScale: scale,
          hostNativeDPR: meta.hostNativeDPR,
        });
        reports.at(-1).mutation = {
          ...diff,
          mutationMode: 'zero-bleed-with-tile-clipping',
          note: 'Pure bleedPx=0 measured 0/255 because WKWebView does not clip off-tile shadows by default.',
          controlBleedPx: report.bleedPx,
          mutantBleedPx: receipt.bleedPx,
        };
        const mutationDetected = detectsSeamMutation(sameEngine.passed, diff);
        reports.at(-1).mutationDetected = mutationDetected;
        nativeMutation = { ...reports.at(-1).mutation, mutationDetected };
      }
    }
    return summarizeBenchmark(reports, nativeMutation);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

if (process.versions.electron && process.argv.includes('--electron-reference')) {
  electronReference(...process.argv.slice(-2)).catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else if (process.argv[1] && resolve(process.argv[1]) === script) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      compare: { type: 'boolean' },
      mygo: { type: 'string' },
      'mutant-mygo': { type: 'string' },
      'native-mutation': { type: 'boolean' },
      'verify-mutation': { type: 'boolean' },
      'tile-edge': { type: 'string' },
    },
  });
  let result;
  if (values.compare) {
    assert.equal(positionals.length, 2);
    const images = await Promise.all(positionals.map((file) => decodePng(readFileSync(file))));
    result = compare(...images, { tileEdge: Number(values['tile-edge'] ?? 1536) });
  } else if (values['verify-mutation']) result = await verifyTruncatedShadow();
  else result = await benchmark(values);
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
}
