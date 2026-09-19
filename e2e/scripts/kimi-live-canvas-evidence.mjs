import { writeFile, stat } from 'node:fs/promises';
import { watch } from 'node:fs';
import { buildPreviewPayload } from '../../apps/cli/src/design/render-preview.ts';
import { join } from 'node:path';
import { sha } from './kimi-replication-evidence.mjs';

/** Observation only: never writes authoring files, pauses tools or directs the Agent. */
export function observeLiveCanvas(h, directory, artworkId, report, dataRoot) {
  const frames = [];
  const seen = new Set();
  let pending = Promise.resolve();
  let running = false;
  let stopped = false;
  const sourceStates = new Map();
  const workdir = join(dataRoot, 'chats', artworkId);
  let sourcePending = Promise.resolve();
  let sourceDirty = false;
  let sourceRunning = false;
  const readSource = async () => {
    sourceDirty = true;
    if (sourceRunning) return sourcePending;
    sourceRunning = true;
    try {
      while (sourceDirty) {
        if (stopped) break;
        sourceDirty = false;
        const built = await buildPreviewPayload(workdir, {});
        if (built.status !== 'ok' || sourceStates.has(built.sourceIdentity)) continue;
        const times = await Promise.all(
          built.dependencies.map((file) => stat(join(workdir, file)))
        );
        sourceStates.set(built.sourceIdentity, {
          readyAt: Math.max(...times.map((s) => s.mtimeMs)),
          observedAt: Date.now(),
        });
      }
    } catch {
      /* A later file event reconciles an unfinished write. */
    } finally {
      sourceRunning = false;
    }
  };
  const watcher = watch(workdir, { recursive: true }, (_event, file) => {
    if (file === 'design.yaml' || file?.startsWith('media/')) sourcePending = readSource();
  });
  watcher.on('error', (error) => {
    report.liveCanvas.sourceObservationError = String(error);
  });
  sourcePending = readSource();
  report.liveCanvas = { status: 'observing', frames };
  const observe = async () => {
    if (running || stopped) return;
    running = true;
    try {
      const candidates = await h.app.evaluate(async ({ BrowserWindow }, id) => {
        const results = [];
        for (const owner of BrowserWindow.getAllWindows()) {
          for (const view of [...owner.contentView.children].reverse()) {
            if (!('webContents' in view) || !view.getVisible()) continue;
            const bounds = view.getBounds();
            if (bounds.x + bounds.width <= 0 || bounds.y + bounds.height <= 0) continue;
            const wc = view.webContents;
            if (wc.isDestroyed()) continue;
            const url = new URL(wc.getURL());
            if (url.searchParams.get('ws') !== id) continue;
            const before = await wc.executeJavaScript(`JSON.stringify({
              state: window.molly?.state(), doc: window.bento?.visual?.snapshot(),
              viewport: window.bento?.viewport?.() })`);
            const parsed = JSON.parse(before);
            if (!parsed.state?.readonly || !parsed.doc) break;
            const doc = JSON.parse(parsed.doc);
            if (!doc.elements?.length) break;
            const png = (await wc.capturePage()).toPNG().toString('base64');
            const after = await wc.executeJavaScript('window.bento?.visual?.snapshot()');
            if (after === parsed.doc) results.push({ ...parsed, png });
            break;
          }
        }
        return results;
      }, artworkId);
      for (const candidate of candidates) {
        const digest = sha(candidate.doc);
        if (seen.has(digest)) continue;
        seen.add(digest);
        const file = `live-frame-${String(frames.length + 1).padStart(3, '0')}`;
        await writeFile(join(directory, `${file}.png`), Buffer.from(candidate.png, 'base64'));
        await writeFile(join(directory, `${file}.json`), candidate.doc);
        const source = sourceStates.get(candidate.state.revisionId);
        frames.push({
          file,
          digest,
          observedAt: new Date().toISOString(),
          revisionId: candidate.state.revisionId,
          viewport: candidate.viewport,
          ...(source
            ? {
                sourceReadyAt: new Date(source.readyAt).toISOString(),
                visibleLatencyMs: Date.now() - source.readyAt,
              }
            : {}),
        });
      }
    } catch (error) {
      // Navigation/replacement races are evidence gaps, never a reason to alter the run.
      report.liveCanvas.lastObservationError = String(error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => {
    if (!running) pending = observe();
  }, 250);
  return async () => {
    stopped = true;
    clearInterval(timer);
    watcher.close();
    await Promise.all([pending, sourcePending]);
    report.liveCanvas.status = frames.length ? 'intermediate-observed' : 'unproven';
    const warm = frames
      .slice(1)
      .map((frame) => frame.visibleLatencyMs)
      .filter(Number.isFinite);
    report.liveCanvas.latency = {
      targetMs: 2000,
      coldMs: frames[0]?.visibleLatencyMs,
      warmSamplesMs: warm,
      status: warm.length ? (Math.max(...warm) <= 2000 ? 'passed' : 'failed') : 'unproven',
      method:
        'Latest validated dependency mtime to visible native capture; observation/capture overhead included',
    };
  };
}
