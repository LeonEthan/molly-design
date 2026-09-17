/** Acceptance-only mechanical measurements; no model or human-quality verdict. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { cpus, totalmem, platform, arch, release } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { ElectronHarness } from '../src/support/electron-harness.ts';
import { OnboardingPage } from '../src/support/pages/onboarding-page.ts';
import { collectAuthoring, intakeAuthoring } from '../../packages/design-authoring/src/index.ts';
import { designOperation } from '../../apps/cli/src/design/store.ts';

assert((process.env.MOLLY_E2E_INSTALLED_EXECUTABLE ?? process.env.LODY_E2E_INSTALLED_EXECUTABLE), 'Set the final installed executable');
assert((process.env.MOLLY_E2E_EXPECTED_SOURCE_COMMIT ?? process.env.LODY_E2E_EXPECTED_SOURCE_COMMIT), 'Set its sealed source commit');
const root = fileURLToPath(new URL('../artifacts/acceptance/', import.meta.url));
await mkdir(root, { recursive: true });
const round = await mkdtemp(path.join(root, 'design-measurement-'));
const harness = new ElectronHarness({
  rootDir: round,
  scenarioDir: round,
  stableId: 'design-measurement',
});
const report = {
  status: 'running',
  humanVisualVerdict: 'pending',
  humanEditingVerdict: 'pending',
  scope:
    'Seeded synthetic canvas operations; excludes Agent creation/continuation and physical human interaction',
  expectedSourceCommit: (process.env.MOLLY_E2E_EXPECTED_SOURCE_COMMIT ?? process.env.LODY_E2E_EXPECTED_SOURCE_COMMIT),
  machine: {
    platform: platform(),
    arch: arch(),
    release: release(),
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    memoryBytes: totalmem(),
  },
  samples: [],
};
const persist = () =>
  writeFile(path.join(round, 'measurements.json'), JSON.stringify(report, null, 2) + '\n');
let failure;
try {
  await harness.launch();
  const { page, app } = harness;
  assert(page && app);
  const onboarding = new OnboardingPage(page);
  await onboarding.waitForLocalBootstrap();
  await onboarding.skipConfigurationAndEnterProduct();
  report.runtime = await app.evaluate(async ({ app: nativeApp, screen }) => {
    const fs = process.getBuiltinModule('fs');
    const nativePath = process.getBuiltinModule('path');
    const manifest = JSON.parse(
      fs.readFileSync(nativePath.join(nativeApp.getAppPath(), 'package.json'), 'utf8')
    );
    return {
      version: nativeApp.getVersion(),
      sourceCommit: manifest.mollySourceCommit,
      versions: process.versions,
      dataRoot: (process.env.MOLLY_DATA_DIR ?? process.env.LODY_DATA_DIR),
      display: screen.getPrimaryDisplay(),
    };
  });
  assert.equal(report.runtime.sourceCommit, report.expectedSourceCommit);
  assert(report.runtime.dataRoot);
  report.bootstrap = await harness.captureSnapshot();
  const ipc = (method, ...args) =>
    page.evaluate(({ method: channel, args: values }) => window.ipc.invoke(channel, ...values), { method, args });
  const editor = (script) =>
    app.evaluate(async ({ BrowserWindow }, sourceCode) => {
      const owner = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().includes('#/local/')
      );
      const view = owner?.contentView.children.find((v) =>
        v.webContents?.getURL().includes('design')
      );
      if (!view) throw Error('No attached Bento view');
      return view.webContents.executeJavaScript(sourceCode);
    }, script);
  const ready = () =>
    editor(`new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { observer.disconnect(); reject(Error('Bento readiness timeout')); }, 30000);
    const observer = new MutationObserver(check);
    observer.observe(document, { childList: true, subtree: true });
    function check() { if (window.molly && window.bento?.doc && document.querySelector('[data-c2a-kind="shape"]')) { clearTimeout(timeout); observer.disconnect(); resolve(true); } }
    check();
  })`);
  for (const scene of ['poster', 'infographic', 'long-image']) {
    const source = fileURLToPath(new URL(`../fixtures/design/${scene}/`, import.meta.url));
    const intake = intakeAuthoring('design.pptd', collectAuthoring(source));
    assert.equal(intake.status, 'ok', JSON.stringify(intake));
    const id = randomUUID(),
      hostId = randomUUID();
    const seeded = await designOperation(report.runtime.dataRoot, {
      operation: 'create',
      association: {
        sessionId: id,
        name: scene,
        userId: 'local:acceptance',
        machineId: 'acceptance',
        createdAt: new Date().toISOString(),
      },
      ...intake.document.canvas,
      copy: {
        doc: intake.document,
        assets: Object.fromEntries(
          [...intake.assets].map(([hash, bytes]) => [
            hash,
            `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`,
          ])
        ),
      },
    });
    let latest = seeded;
    for (let iteration = 0; iteration < 3; iteration++) {
      const sample = {
        scene,
        iteration,
        canvas: intake.document.canvas,
        initialElements: latest.doc.elements.length,
        timesMs: {},
        status: 'running',
      };
      report.samples.push(sample);
      await persist();
      const timed = async (operation, run) => {
        const start = performance.now();
        const value = await run();
        sample.timesMs[operation] = performance.now() - start;
        return value;
      };
      await timed(iteration === 0 ? 'coldAttach' : 'reopen', async () => {
        await ipc('design.attach', id, { x: 0, y: 0, width: 1100, height: 750 }, hostId);
        await ready();
        assert.deepEqual(JSON.parse(await editor('window.bento.visual.snapshot()')), latest.doc);
      });
      sample.loadedMemory = await harness.captureSnapshot();
      await timed('edit', async () => {
        await editor(`document.querySelector('[data-c2a-kind="shape"]').click()`);
        const changed = JSON.parse(await editor('window.bento.visual.snapshot()'));
        assert.equal(changed.elements.length, latest.doc.elements.length + 1);
      });
      await timed('save', async () => {
        await ipc('design.save', id);
        const saved = await ipc('design.read', id);
        assert.notEqual(saved.revisionId, latest.revisionId);
        assert.equal(saved.doc.elements.length, latest.doc.elements.length + 1);
        latest = saved;
      });
      sample.savedMemory = await harness.captureSnapshot();
      if (iteration === 0) {
        const image = await app.evaluate(async ({ BrowserWindow }) => {
          const owner = BrowserWindow.getAllWindows().find((w) =>
            w.webContents.getURL().includes('#/local/')
          );
          const view = owner?.contentView.children.find((v) =>
            v.webContents?.getURL().includes('design')
          );
          if (!view) throw Error('Missing canvas screenshot target');
          return (await view.webContents.capturePage()).toDataURL();
        });
        await writeFile(
          path.join(round, `${scene}-canvas.png`),
          Buffer.from(image.split(',')[1], 'base64')
        );
      }
      sample.exports = [];
      for (const format of ['png', 'jpeg']) {
        const output = path.join(round, `${scene}-${iteration}.${format}`);
        await app.evaluate(({ dialog }, selectedPath) => {
          globalThis.__mollyAcceptanceSaveDialog = dialog.showSaveDialog;
          dialog.showSaveDialog = async () => ({ canceled: false, filePath: selectedPath });
        }, output);
        try {
          await timed(format, async () => {
            await ipc('design.export', id, format, scene);
            const dimensions = await app.evaluate(
              ({ nativeImage }, imagePath) => nativeImage.createFromPath(imagePath).getSize(),
              output
            );
            assert.deepEqual(dimensions, intake.document.canvas);
          });
        } finally {
          await app.evaluate(({ dialog }) => {
            dialog.showSaveDialog = globalThis.__mollyAcceptanceSaveDialog;
            delete globalThis.__mollyAcceptanceSaveDialog;
          });
        }
        const bytes = await readFile(output);
        sample.exports.push({
          file: path.basename(output),
          bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        });
        sample[`${format}Memory`] = await harness.captureSnapshot();
      }
      assert.equal(await ipc('design.close', id), true);
      sample.closedMemory = await harness.capturePostGcSnapshot();
      sample.status = 'measured';
      await persist();
    }
    // Real filesystem export failure, after measurements so it cannot skew timings.
    const missingParent = path.join(round, `absent-${randomUUID()}`, 'failed.png');
    await app.evaluate(({ dialog }, output) => {
      globalThis.__mollyAcceptanceSaveDialog = dialog.showSaveDialog;
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: output });
    }, missingParent);
    try {
      await assert.rejects(ipc('design.export', id, 'png', scene), /ENOENT/);
      assert.deepEqual(await ipc('design.read', id), latest);
      report.samples.at(-1).exportWriteFailurePreservedSave = true;
    } finally {
      await app.evaluate(({ dialog }) => {
        dialog.showSaveDialog = globalThis.__mollyAcceptanceSaveDialog;
        delete globalThis.__mollyAcceptanceSaveDialog;
      });
    }
  }
  report.status = 'measured';
} catch (error) {
  failure = error;
  report.status = 'failed';
  report.error = String(error?.stack ?? error);
} finally {
  try {
    await harness.stopTrace(path.join(round, 'trace.zip'));
  } catch (error) {
    failure ??= error;
    report.status = 'failed';
    report.traceError = String(error);
  }
  harness.writeDiagnostics();
  try {
    await harness.close();
  } catch (error) {
    failure ??= error;
    report.status = 'failed';
    report.teardownError = String(error?.stack ?? error);
  }
  await persist();
  console.log(`Acceptance measurements: ${round}`);
}
if (failure) throw failure;
