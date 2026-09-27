import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createIsolatedEnvironment, ElectronHarness } from './electron-harness.js';
import { OnboardingPage } from './pages/onboarding-page.js';
import {
  acceptanceCases,
  compareColumns,
  cropCases,
  cropFixture,
  patternBitmap,
  sha256,
} from './fixtures/transparent-margin.js';

assert.ok(
  !(process.env.MOLLY_E2E_INSTALLED_EXECUTABLE ?? process.env.LODY_E2E_INSTALLED_EXECUTABLE),
  'This regression targets the local build; unset the installed executable override'
);
const acceptance = process.argv.includes('--acceptance');
const forcedScale = process.env.MOLLY_CROP_DEVICE_SCALE;
assert.ok(
  forcedScale === undefined || ['1', '2', '3'].includes(forcedScale),
  'Device scale must be 1, 2 or 3'
);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const artifacts = join(root, 'e2e/artifacts/transparent-margin');
await mkdir(artifacts, { recursive: true });
const directory = await mkdtemp(join(artifacts, 'run-'));
const harness = new ElectronHarness(
  {
    rootDir: directory,
    scenarioDir: directory,
    stableId: 'ISSUE-15',
  },
  forcedScale === '1' ? 1 : forcedScale === '2' ? 2 : forcedScale === '3' ? 3 : undefined
);
const report: {
  status: string;
  issue: number;
  acceptance: boolean;
  forcedScale?: string;
  checkout?: string;
  runtime?: unknown;
  buildHashes: Record<string, string>;
  cases: Array<{
    name: string;
    pngHash: string;
    comparison: ReturnType<typeof compareColumns>;
    unchanged: boolean;
    deviceScales: unknown;
  }>;
  editing?: unknown;
  error?: string;
} = { status: 'running', issue: 15, acceptance, forcedScale, buildHashes: {}, cases: [] };
async function projectionHashes(projectionDirectory: string) {
  const files = await readdir(projectionDirectory, { recursive: true, withFileTypes: true });
  return Object.fromEntries(
    await Promise.all(
      files
        .filter((file) => file.isFile())
        .map(async (file) => {
          const absolute = join(file.parentPath, file.name);
          return [absolute.slice(projectionDirectory.length + 1), sha256(await readFile(absolute))];
        })
    )
  );
}
const persist = () =>
  writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
let failed = false;
try {
  report.checkout = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  for (const file of [
    'apps/electron/out/main/index.js',
    'apps/electron/resources/cli/design.js',
    'apps/electron/resources/design/editor.html',
    'apps/electron/resources/design/build.json',
  ]) {
    report.buildHashes[file] = sha256(await readFile(join(root, file)));
  }
  await harness.launch();
  const electron = harness.app!;
  const page = harness.page!;
  await new OnboardingPage(page).waitForLocalBootstrap();
  const runtime = await electron.evaluate(({ app, screen }) => ({
    versions: process.versions,
    platform: process.platform,
    arch: process.arch,
    appVersion: app.getVersion(),
    dataRoot: process.env.MOLLY_DATA_DIR ?? process.env.LODY_DATA_DIR,
    displayScale: screen.getPrimaryDisplay().scaleFactor,
  }));
  report.runtime = runtime;
  assert.ok(runtime.dataRoot, 'Isolated data root unavailable');
  for (const spec of acceptance ? [...cropCases, ...acceptanceCases] : cropCases) {
    const pngs = await electron.evaluate(
      ({ nativeImage }, bitmaps) =>
        bitmaps.map(({ bitmap, width, height }) =>
          nativeImage
            .createFromBitmap(Buffer.from(bitmap, 'base64'), { width, height, scaleFactor: 1 })
            .toDataURL()
        ),
      [
        patternBitmap(0, 0, 128, 128, spec.softEdge),
        patternBitmap(spec.left, spec.top, 94, 84, spec.softEdge),
      ]
    );
    const fixture = cropFixture(spec, pngs);
    const sessionId = randomUUID();
    const request = {
      operation: 'create',
      association: {
        sessionId,
        name: `Transparent margins ${spec.name}`,
        userId: 'local:regression',
        machineId: 'regression',
        createdAt: '2026-09-26T00:00:00.000Z',
      },
      ...fixture.doc.canvas,
      copy: fixture,
    };
    const seedResponse = JSON.parse(
      execFileSync(process.execPath, [join(root, 'apps/electron/resources/cli/design.js')], {
        input: JSON.stringify(request) + '\n',
        encoding: 'utf8',
        timeout: 30_000,
        maxBuffer: 8 * 1024 * 1024,
        env: createIsolatedEnvironment({ MOLLY_DATA_DIR: runtime.dataRoot }),
      })
    );
    assert.equal(seedResponse.ok, true, seedResponse.error);
    const seeded = seedResponse.value;
    assert.deepEqual(
      seeded.doc.elements,
      fixture.doc.elements,
      'Fixture coordinates changed during creation'
    );
    assert.deepEqual(seeded.assets, fixture.assets, 'Fixture assets changed during creation');
    await writeFile(join(directory, `${spec.name}-fixture.json`), JSON.stringify(fixture, null, 2));
    const projection = join(runtime.dataRoot, 'chats', sessionId, 'design-current');
    const beforeProjection = await projectionHashes(projection);
    assert.ok(beforeProjection['design.yaml'], 'YAML projection missing');
    const destination = join(directory, `${spec.name}.png`);
    await electron.evaluate(({ app, dialog }, file) => {
      const state = globalThis as typeof globalThis & {
        cropProbe?: {
          saveDialog: typeof dialog.showSaveDialog;
          listener: (event: Electron.Event, window: Electron.BrowserWindow) => void;
          scales: Array<Promise<number>>;
        };
      };
      const scales: Array<Promise<number>> = [];
      const [listener] = [
        (_event: Electron.Event, window: Electron.BrowserWindow) => {
          window.webContents.once('did-finish-load', () => {
            if (window.webContents.getURL().startsWith('molly-design://')) {
              scales.push(window.webContents.executeJavaScript('devicePixelRatio'));
            }
          });
        },
      ];
      state.cropProbe = { saveDialog: dialog.showSaveDialog, listener, scales };
      app.on('browser-window-created', listener);
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, destination);
    let deviceScales: unknown;
    try {
      await page.evaluate(async (id) => {
        if (!window.ipc) throw Error('Desktop IPC unavailable');
        await window.ipc.invoke('design.export', id, 'png', 'Transparent margins');
      }, sessionId);
      deviceScales = await electron.evaluate(async () => {
        const state = globalThis as typeof globalThis & {
          cropProbe?: { scales: Array<Promise<number>> };
        };
        return Promise.all(state.cropProbe!.scales);
      });
      assert.ok(
        Array.isArray(deviceScales) && deviceScales.length > 0,
        'Export device scale not observed'
      );
    } finally {
      await electron.evaluate(({ app, dialog }) => {
        const state = globalThis as typeof globalThis & {
          cropProbe?: {
            saveDialog: typeof dialog.showSaveDialog;
            listener: (event: Electron.Event, window: Electron.BrowserWindow) => void;
          };
        };
        if (state.cropProbe) {
          dialog.showSaveDialog = state.cropProbe.saveDialog;
          app.removeListener('browser-window-created', state.cropProbe.listener);
          delete state.cropProbe;
        }
      });
    }
    if (forcedScale !== undefined)
      assert.ok(
        (deviceScales as number[]).every((scale) => scale === Number(forcedScale)),
        'Requested device scale was not observed'
      );
    const png = await readFile(destination);
    const decoded = await electron.evaluate(({ nativeImage }, base64) => {
      const image = nativeImage.createFromBuffer(Buffer.from(base64, 'base64'));
      return { ...image.getSize(), bitmap: image.toBitmap().toString('base64') };
    }, png.toString('base64'));
    const current = await page.evaluate(
      async (id) => window.ipc!.invoke('design.read', id),
      sessionId
    );
    assert.deepEqual(current, seeded, 'Export changed canonical artwork or assets');
    assert.deepEqual(
      await projectionHashes(projection),
      beforeProjection,
      'Export changed YAML or projected assets'
    );
    const bitmap = Buffer.from(decoded.bitmap, 'base64');
    const comparison = compareColumns(bitmap, decoded.width, decoded.height);
    const background = Buffer.from([232, 241, 244, 255]);
    assert.deepEqual(bitmap.subarray(0, 4), background, 'Canvas background missing');
    if (spec.shadow) {
      const shadow = (145 * 512 + 144) * 4;
      assert.ok(
        [0, 1, 2].every((channel) => bitmap[shadow + channel]! < background[channel]! - 5),
        'Drop shadow disappeared outside the source subject'
      );
    }
    if (spec.softEdge && !spec.shadow) {
      const edge = (63 * 512 + 51) * 4;
      assert.notDeepEqual(bitmap.subarray(edge, edge + 4), background, 'Alpha-1 edge disappeared');
    }
    for (const { row } of comparison) {
      let subjectPixels = 0;
      for (let y = row * 208; y < (row + 1) * 208; y++) {
        for (let x = 0; x < 256; x++) {
          const offset = (y * 512 + x) * 4;
          if (!bitmap.subarray(offset, offset + 4).equals(background)) subjectPixels++;
        }
      }
      assert.ok(subjectPixels > 100, `Rendered subject missing in row ${row}`);
    }
    if (process.argv.includes('--editing') && spec.name === 'original') {
      await page.evaluate(async (id) => {
        await window.ipc!.invoke('design.attach', id, { x: 0, y: 0, width: 800, height: 600 }, id);
      }, sessionId);
      const target = await electron.evaluate(async ({ webContents }, id) => {
        const canvas = webContents
          .getAllWebContents()
          .find(
            (contents) =>
              contents.getURL().startsWith('molly-design://') &&
              new URL(contents.getURL()).searchParams.get('ws') === id
          );
        if (!canvas) throw Error('Editable canvas missing');
        const info = await canvas.executeJavaScript(
          `({ state: window.molly.state(), rect: document.querySelector('.ed-stage-scale .bento-slide [data-el-id="full-0"]').getBoundingClientRect().toJSON() })`
        );
        if (info.state.readonly || !info.state.ready) throw Error('Canvas not editable');
        const x = Math.round(info.rect.x + info.rect.width / 2),
          y = Math.round(info.rect.y + info.rect.height / 2);
        canvas.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
        canvas.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
        await canvas.executeJavaScript(
          'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
        );
        const selection = await canvas.executeJavaScript('window.molly.selection()');
        if (
          !selection.some((item: string | { id: string }) =>
            typeof item === 'string' ? item === 'full-0' : item.id === 'full-0'
          )
        )
          throw Error('Pointer selection failed: ' + JSON.stringify({ selection, info, x, y }));
        canvas.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
        for (const delta of [8, 16, 24, 32, 40])
          canvas.sendInputEvent({
            type: 'mouseMove',
            x: x + delta,
            y: y + Math.round(delta * 0.7),
            button: 'left',
            modifiers: ['leftbuttondown'],
          });
        canvas.sendInputEvent({
          type: 'mouseUp',
          x: x + 40,
          y: y + 28,
          button: 'left',
          clickCount: 1,
        });
        await canvas.executeJavaScript(
          'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
        );
        const after = await canvas.executeJavaScript(
          `document.querySelector('.ed-stage-scale .bento-slide [data-el-id="full-0"]').getBoundingClientRect().toJSON()`
        );
        return { before: info.rect, after, selection };
      }, sessionId);
      await writeFile(join(directory, 'editing-target.json'), JSON.stringify(target, null, 2));
      assert.ok(
        Math.abs(target.after.x - target.before.x - 40) < 1,
        'Drag horizontal mapping changed'
      );
      assert.ok(
        Math.abs(target.after.y - target.before.y - 28) < 1,
        'Drag vertical mapping changed'
      );
      await page.screenshot({ path: join(directory, 'edited-desktop.png') });
      assert.equal(
        await page.evaluate((id) => window.ipc!.invoke('design.close', id), sessionId),
        true,
        'Edited canvas did not close'
      );
      const saved = (await page.evaluate(
        (id) => window.ipc!.invoke('design.read', id),
        sessionId
      )) as typeof fixture;
      const moved = saved.doc.elements.find((element: { id: string }) => element.id === 'full-0');
      assert.ok(moved, 'Edited element missing');
      const scale = target.before.width / 128;
      assert.ok(
        Math.abs(moved.bounds[0] - 32 - (target.after.x - target.before.x) / scale) < 0.02,
        'Saved horizontal position differs'
      );
      assert.ok(
        Math.abs(moved.bounds[1] - 40 - (target.after.y - target.before.y) / scale) < 0.02,
        'Saved vertical position differs'
      );
      assert.deepEqual(moved.bounds.slice(2), [128, 128], 'Drag changed source dimensions');
      assert.deepEqual(saved.assets, seeded.assets, 'Editing rewrote source assets');
      report.editing = {
        pointerSelection: target.selection,
        requestedDragPixels: [40, 28],
        observedDragPixels: [target.after.x - target.before.x, target.after.y - target.before.y],
        before: [32, 40, 128, 128],
        after: moved.bounds,
        assetsUnchanged: true,
        closedAndSaved: true,
      };
    }
    report.cases.push({
      name: spec.name,
      pngHash: sha256(png),
      comparison,
      unchanged: true,
      deviceScales,
    });
    console.log(JSON.stringify(report.cases.at(-1)));
    await persist();
  }
  assert.equal(report.cases[0]!.pngHash, report.cases[1]!.pngHash, 'Repeated exports differ');
  failed = report.cases.some((result) =>
    result.comparison.some((row) => row.differingPixels !== 0)
  );
  report.status = failed ? 'pixel-invariance-failed' : 'passed';
} catch (error) {
  failed = true;
  report.status = 'probe-error';
  report.error = String(error);
} finally {
  try {
    if (harness.page) {
      await harness.page.screenshot({ path: join(directory, 'desktop.png') });
      await writeFile(
        join(directory, 'runtime.json'),
        JSON.stringify(await harness.captureSnapshot(), null, 2)
      );
      await writeFile(
        join(directory, 'cli-backlog.json'),
        JSON.stringify(await harness.captureCliBacklog(), null, 2)
      );
      await harness.stopTrace(join(directory, 'trace.zip'));
    }
  } catch (error) {
    failed = true;
    report.error = `${report.error ?? ''}\nEvidence capture: ${String(error)}`;
  }
  try {
    await harness.close();
  } catch (error) {
    failed = true;
    report.error = `${report.error ?? ''}\nTeardown: ${String(error)}`;
  }
  if (report.error) report.status = 'probe-error';
  await persist();
}
console.log(`${report.status}: ${directory}`);
process.exitCode = report.status === 'probe-error' ? 2 : failed ? 1 : 0;
