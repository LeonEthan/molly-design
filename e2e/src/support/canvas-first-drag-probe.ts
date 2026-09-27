import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ElectronHarness } from './electron-harness.js';
import { OnboardingPage } from './pages/onboarding-page.js';
import { canvasFirstDragProbe } from './fixtures/canvas-first-drag.js';

interface ProbeResult {
  cases: Array<{
    name: string;
    unchanged: boolean;
    moved?: boolean;
    expectedMove?: boolean;
    committed?: boolean;
    selected?: boolean;
    startSaving?: boolean;
    input?: { saving: boolean };
  }>;
  errors: string[];
  saved: { ok: boolean };
  settledSave: { ok: boolean };
  finalSave: { ok: boolean };
  snapshot: unknown;
  history: { beforeUndo: unknown; afterUndoable: unknown; undone: unknown; redone: unknown };
  readonly: {
    beforeReadonly: unknown;
    afterReadonly: unknown;
    readonlyCommand: { ok: boolean };
    readonlyButtons: boolean;
  };
}

const root = fileURLToPath(new URL('../../../', import.meta.url));
const artifacts = join(root, 'e2e/artifacts/canvas-first-drag');
await mkdir(artifacts, { recursive: true });
const directory = await mkdtemp(join(artifacts, 'run-'));
const harness = new ElectronHarness({
  rootDir: directory,
  scenarioDir: directory,
  stableId: 'ISSUE-21',
});
const report: {
  checkout: string;
  build: Record<string, string>;
  result?: unknown;
  error?: string;
} = {
  checkout: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  build: {},
};
try {
  assert.ok(
    !process.env.MOLLY_E2E_INSTALLED_EXECUTABLE && !process.env.LODY_E2E_INSTALLED_EXECUTABLE,
    'This probe requires the local desktop build'
  );
  for (const path of [
    'apps/electron/out/main/index.js',
    'apps/electron/resources/design/editor.html',
  ])
    report.build[path] = createHash('sha256')
      .update(await readFile(join(root, path)))
      .digest('hex');
  await harness.launch();
  const page = harness.page!;
  await new OnboardingPage(page).waitForLocalBootstrap();
  const artworkId = randomUUID();
  await page.evaluate(async (sessionId) => {
    await window.ipc!.invoke('design.create', {
      association: {
        sessionId,
        name: 'First drag regression',
        userId: 'probe',
        machineId: 'probe',
        createdAt: '2026-09-27T00:00:00.000Z',
      },
      width: 800,
      height: 600,
    });
    await window.ipc!.invoke(
      'design.attach',
      sessionId,
      { x: 0, y: 0, width: 800, height: 600 },
      sessionId
    );
  }, artworkId);
  await harness.app!.evaluate(({ webContents }) => {
    Object.assign(globalThis, { __canvasFirstDragWebContents: webContents });
  });
  const result = await harness.app!.evaluate<ProbeResult>(`(async () => {
    const webContents = globalThis.__canvasFirstDragWebContents;
    const artworkId = ${JSON.stringify(artworkId)};
    ${canvasFirstDragProbe}
  })()`);
  report.result = result;
  for (const entry of result.cases) {
    assert.equal(entry.unchanged, true, `${entry.name}: stationary elements changed`);
    if ('moved' in entry) {
      assert.equal(
        entry.moved,
        entry.expectedMove,
        `${entry.name}: unexpected element displacement`
      );
      assert.equal(entry.committed, true, `${entry.name}: release lost the preview displacement`);
    }
    if (entry.startSaving)
      assert.equal(entry.input?.saving, true, 'Gesture missed the saving state');
    if ('selected' in entry)
      assert.equal(entry.selected, true, `${entry.name}: selection did not change`);
  }
  assert.deepEqual(result.errors, [], 'Canvas raised an uncaught error');
  assert.equal(result.saved.ok, true, 'Overlapping save failed');
  assert.equal(result.settledSave.ok, true, 'Save after the overlapping gesture failed');
  assert.equal(result.finalSave.ok, true, 'Final save failed');
  assert.deepEqual(
    result.history.undone,
    result.history.beforeUndo,
    'Undo did not restore the prior document'
  );
  assert.deepEqual(
    result.history.redone,
    result.history.afterUndoable,
    'Redo did not restore the drag'
  );
  assert.deepEqual(
    result.readonly.afterReadonly,
    result.readonly.beforeReadonly,
    'Readonly command changed the document'
  );
  assert.equal(result.readonly.readonlyCommand.ok, false, 'Readonly accepted a semantic mutation');
  assert.equal(result.readonly.readonlyButtons, true, 'Readonly left mutation controls enabled');
  await harness.restart();
  await new OnboardingPage(harness.page!).waitForLocalBootstrap();
  await harness.page!.evaluate(async (id) => {
    await window.ipc!.invoke('design.attach', id, { x: 0, y: 0, width: 800, height: 600 }, id);
  }, artworkId);
  const reopened = await harness.app!.evaluate(async ({ webContents }, id) => {
    const canvas = webContents
      .getAllWebContents()
      .find(
        (contents) =>
          contents.getURL().startsWith('molly-design://') &&
          new URL(contents.getURL()).searchParams.get('ws') === id
      );
    if (!canvas) throw Error('Reopened canvas missing');
    return canvas.executeJavaScript('window.molly.snapshot()');
  }, artworkId);
  assert.deepEqual(reopened, result.snapshot, 'Reopening lost the saved drag');
} catch (cause) {
  report.error = cause instanceof Error ? cause.stack : String(cause);
  process.exitCode = 1;
  console.error(report.error);
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
  } catch (cause) {
    report.error = `${report.error ?? ''}\nEvidence capture: ${String(cause)}`;
  }
  try {
    await harness.close();
  } catch (cause) {
    report.error = `${report.error ?? ''}\nTeardown: ${String(cause)}`;
  }
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
process.exitCode = report.error ? 1 : 0;
console.log(
  `${report.error ? 'FAIL' : 'PASS'}: canvas first-drag regression; evidence ${directory}`
);
