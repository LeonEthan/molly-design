import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ElectronHarness } from './electron-harness.js';
import { OnboardingPage } from './pages/onboarding-page.js';

// Exercise the real IPC/worker/Bento close path without a model or credentials.
// Count the specific retained resource after a full heap snapshot, not an RSS
// threshold or a weak-reference collection race.
const shellSize = statSync(
  new URL('../../../apps/electron/resources/design/editor.html', import.meta.url)
).size;
const directory = mkdtempSync(join(tmpdir(), 'molly-canvas-resources-'));
const harness = new ElectronHarness({
  rootDir: directory,
  scenarioDir: directory,
  stableId: 'CANVAS-RESOURCES',
});
try {
  await harness.launch();
  const page = harness.page!;
  await new OnboardingPage(page).waitForLocalBootstrap();
  const ids = [randomUUID(), randomUUID()];
  for (const id of ids) await page.evaluate(async (sessionId) => {
    if (!window.ipc) throw new Error('Desktop IPC unavailable');
    await window.ipc.invoke('design.create', {
      association: {
        sessionId,
        name: 'Resource probe',
        userId: 'probe',
        machineId: 'probe',
        createdAt: '2026-09-21T00:00:00.000Z',
      },
      width: 800,
      height: 600,
    });
  }, id);
  const attach = async (artworkId: string, canvasHostId = artworkId) =>
    page.evaluate(async ({ sessionId, hostId }) => {
      if (!window.ipc) throw new Error('Desktop IPC unavailable');
      await window.ipc.invoke(
        'design.attach',
        sessionId,
        { x: 0, y: 0, width: 800, height: 600 },
        hostId
      );
    }, { sessionId: artworkId, hostId: canvasHostId });
  const close = async (sessionId: string) => page.evaluate(async (id) => {
    if (!(await window.ipc?.invoke('design.close', id))) throw new Error('Canvas close refused');
  }, sessionId);
  const inspect = async (artworkId: string, retiredUrl?: string, writeCookie = false, nativeId?: number) =>
    harness.app!.evaluate(async ({ webContents }, { sessionId, oldUrl, mark, contentsId }) => {
      const canvas = webContents.getAllWebContents().find((contents) => {
        const url = contents.getURL();
        return (contentsId === undefined || contents.id === contentsId) &&
          url.startsWith('molly-design://') && new URL(url).searchParams.get('ws') === sessionId;
      });
      if (!canvas) throw new Error('Attached canvas missing');
      const state = globalThis as typeof globalThis & { __canvasProbeSessions?: Electron.Session[] };
      const sessions = state.__canvasProbeSessions ??= [];
      if (!sessions.includes(canvas.session)) sessions.push(canvas.session);
      const cookies = await canvas.session.cookies.get({ name: 'canvas-resource-probe' });
      if (mark) await canvas.session.cookies.set({
        url: 'https://canvas-probe.invalid', name: 'canvas-resource-probe', value: sessionId,
      }); // Cookie API only; no network request.
      const document = await canvas.executeJavaScript(`(async () => {
        const payload = await (await fetch(location.origin + '/ws/' + ${JSON.stringify(sessionId)})).json();
        const previous = localStorage.getItem('canvas-resource-probe');
        localStorage.setItem('canvas-resource-probe', ${JSON.stringify(sessionId)});
        return { artworkId: payload.association.sessionId, previous };
      })()`);
      const oldStatus = oldUrl
        ? await canvas.session.fetch(oldUrl).then((response) => response.status).catch(() => 0)
        : undefined;
      return {
        partition: sessions.indexOf(canvas.session), contentsId: canvas.id, url: canvas.getURL(),
        cookies: cookies.map((cookie) => cookie.value), storagePath: canvas.session.storagePath,
        document, oldStatus,
      };
    }, { sessionId: artworkId, oldUrl: retiredUrl, mark: writeCookie, contentsId: nativeId });
  const partitions = new Set<number>();
  const origins = new Set<string>();
  let previousUrl: string | undefined;
  for (let iteration = 0; iteration < 3; iteration++) {
    const id = ids[iteration % ids.length]!;
    await attach(id);
    const current = await inspect(id, previousUrl, true);
    partitions.add(current.partition);
    origins.add(new URL(current.url).hostname);
    assert.equal(current.storagePath, null);
    assert.deepEqual(current.cookies, [], 'Recycled partition retained old cookies');
    assert.equal(current.document.artworkId, id);
    assert.equal(current.document.previous, null);
    if (previousUrl) assert.notEqual(current.oldStatus, 200, 'Retired origin is still readable');
    previousUrl = current.url;
    await close(id);
  }
  assert.equal(partitions.size, 1, 'Serial canvas closes must recycle the isolated session');
  assert.equal(origins.size, 3, 'Each lease needs a fresh origin');

  // Different artworks and two instances of the same artwork remain isolated.
  await attach(ids[0]!);
  const first = await inspect(ids[0]!, previousUrl, true);
  await attach(ids[1]!);
  const sibling = await inspect(ids[1]!, first.url);
  assert.notEqual(first.partition, sibling.partition);
  assert.deepEqual(sibling.cookies, []);
  assert.notEqual(sibling.oldStatus, 200);
  await attach(ids[0]!, randomUUID());
  const simultaneousSessions = await harness.app!.evaluate(({ webContents }) =>
    new Set(webContents.getAllWebContents()
      .filter((contents) => contents.getURL().startsWith('molly-design://'))
      .map((contents) => contents.session)).size
  );
  assert.equal(simultaneousSessions, 3);
  await page.evaluate(async (id) => { await window.ipc?.invoke('design.hide', id, id); }, ids[0]!);
  await attach(ids[0]!);
  assert.equal((await inspect(ids[0]!, undefined, false, first.contentsId)).contentsId, first.contentsId, 'Hiding must retain the editor');
  await close(ids[1]!);
  assert.deepEqual((await inspect(ids[0]!, undefined, false, first.contentsId)).cookies, [ids[0]], 'Sibling cleanup touched a live partition');
  await close(ids[0]!);
  const paths = await harness.captureHeapSnapshots(join(directory, 'heap'));
  const heap = JSON.parse(readFileSync(paths.main, 'utf8')) as {
    snapshot: { meta: { node_fields: string[]; node_types: Array<string[] | string> } };
    nodes: number[];
    strings: string[];
  };
  const fields = heap.snapshot.meta.node_fields;
  for (const field of ['type', 'name', 'self_size']) assert.ok(fields.includes(field));
  const types = heap.snapshot.meta.node_types[fields.indexOf('type')] as string[];
  assert.ok(Array.isArray(types) && types.includes('native'));
  let retainedShellBuffers = 0;
  for (let offset = 0; offset < heap.nodes.length; offset += fields.length) {
    if (
      types[heap.nodes[offset + fields.indexOf('type')]!] === 'native' &&
      heap.strings[heap.nodes[offset + fields.indexOf('name')]!] === 'system / JSArrayBufferData' &&
      heap.nodes[offset + fields.indexOf('self_size')] === shellSize
    )
      retainedShellBuffers++;
  }
  console.log(JSON.stringify({ serialPartitions: partitions.size, simultaneousSessions, retainedShellBuffers, evidence: paths.main }));
  assert.equal(
    retainedShellBuffers,
    0,
    'Closed canvas session handlers retain editor shell buffers'
  );
} finally {
  await harness.close();
}
