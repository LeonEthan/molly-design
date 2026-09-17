import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, cp, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { strict as assert } from 'node:assert';
import { expect } from '@playwright/test';
import { KimiReplicationPage } from '../src/support/pages/kimi-replication-page.ts';

export const REFERENCE_SHA256 = '3f155040ce8152cd3e5808d000cbedb482307c1c1c1f4df68b6f50ae82baaa89';
export const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));

export async function collectKimiResult(h, { directory, artworkId, dataRoot, report }) {
  const ui = new KimiReplicationPage(h);
  const workdir = join(dataRoot, 'chats', artworkId);
  const turns = await readdir(join(workdir, 'design-input'));
  const receipts = [];
  for (const turnId of turns) {
    try {
      receipts.push(await readJson(join(workdir, 'design-input', turnId, 'receipt.json')));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  report.receipts = receipts;
  assert.equal(
    receipts.length,
    1,
    'Golden case requires exactly the original turn, without follow-up hints'
  );
  const receipt = receipts[0];
  assert.equal(
    receipt.status,
    'committed',
    'The normal Agent outcome must commit the generated artwork'
  );
  const original = await ui.ipc('design.read', artworkId);
  const { width, height } = original.doc.canvas;
  assert.equal(width * 2000, height * 285, 'Canvas must preserve the reference aspect ratio');
  report.canvas = { width, height, comparisonWidth: 285, comparisonHeight: 2000 };
  report.elements = original.doc.elements.map((e) => ({
    id: e.id,
    kind: e.kind,
    bounds: e.bounds,
    text: e.kind === 'text' ? e.text : undefined,
    src: e.kind === 'image' ? e.src : undefined,
  }));
  assert.ok(
    report.elements.some((e) => e.kind === 'text'),
    'Editable standalone text is required'
  );
  assert.ok(
    report.elements.some((e) => e.kind === 'image'),
    'Product photography is required'
  );
  await writeFile(join(directory, 'canonical.json'), JSON.stringify(original, null, 2));
  await cp(join(workdir, 'design-input'), join(directory, 'turn-input'), {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  // Use this build's delivered authoring helper, including the old baseline format.
  const authoring = await import(
    pathToFileURL(join(workdir, '.claude/skills/graphic-design/scripts/lib/molly-authoring.mjs'))
      .href
  );
  const projection = authoring.collectAuthoring(join(workdir, 'design-current'));
  const imported = authoring.intakeAuthoring('design.yaml', projection);
  assert.equal(imported.status, 'ok');
  assert.deepEqual(imported.document, original.doc);
  for (const [digest, bytes] of imported.assets) assert.equal(sha(bytes), digest);
  await cp(join(workdir, 'design-current'), join(directory, 'saved-projection'), {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  const draft = authoring.collectAuthoring(workdir);
  await mkdir(join(directory, 'final-draft'));
  for (const [rel, bytes] of draft) {
    const destination = join(directory, 'final-draft', rel);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes, { flag: 'wx' });
  }
  report.deliveredAuthoringSha256 = sha(
    await readFile(join(workdir, '.claude/skills/graphic-design/scripts/lib/molly-authoring.mjs'))
  );
  report.exports = {};
  const exportAndRecord = async (label, format) => {
    const name = `${label}.${format}`;
    await ui.export(artworkId, format, join(directory, name));
    const bytes = await readFile(join(directory, name));
    const dimensions = await h.app.evaluate(
      ({ nativeImage }, encoded) =>
        nativeImage.createFromBuffer(Buffer.from(encoded, 'base64')).getSize(),
      bytes.toString('base64')
    );
    assert.deepEqual(dimensions, { width, height });
    report.exports[name] = { sha256: sha(bytes), bytes: bytes.length, ...dimensions };
    return sha(bytes);
  };
  for (const format of ['png', 'jpeg']) await exportAndRecord('golden', format);
  await ui.reopen(artworkId);
  assert.deepEqual((await ui.ipc('design.read', artworkId)).doc, original.doc);
  for (const format of ['png', 'jpeg']) {
    const digest = await exportAndRecord('reopened', format);
    assert.equal(
      digest,
      report.exports[`golden.${format}`].sha256,
      `${format} export changed on reopen`
    );
  }
  report.technical = 'passed';
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2));
  await writeComparison(directory);
  await verifyKimiEditing(h, {
    directory,
    artworkId,
    dataRoot,
    report,
    original,
    authoring,
    exportAndRecord,
  });
  await h.page.screenshot({ path: join(directory, 'desktop.png') });
  report.visual = {
    status: 'pending',
    criterion:
      'Human judges high visual consistency and editable reconstruction; no automatic similarity threshold',
  };
  report.overall = 'pending-human-review';
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2));
  return report;
}

export async function verifyKimiEditing(
  h,
  { directory, artworkId, dataRoot, report, original, authoring, exportAndRecord }
) {
  const ui = new KimiReplicationPage(h);
  const workdir = join(dataRoot, 'chats', artworkId);
  // Store the unedited golden in history before the native UI edit checks.
  const version = await ui.ipc('design.saveVersion', artworkId);
  report.goldenVersion = version;
  try {
    let canvas = await ui.canvas(artworkId);
    const snapshot = () => canvas.evaluate('JSON.parse(window.bento.visual.snapshot())');
    const textElements = original.doc.elements
      .filter(
        (e) => e.kind === 'text' && e.text.paragraphs.some((p) => p.runs.some((r) => r.text.trim()))
      )
      .sort((a, b) => a.bounds[1] - b.bounds[1]);
    const overlapsSameFrame = (candidate) =>
      original.doc.elements.some(
        (element) =>
          element.kind !== 'text' &&
          element.bounds.every((value, index) => value === candidate.bounds[index])
      );
    const heading =
      textElements.find(
        (element) =>
          element.bounds[2] >= 80 && element.bounds[3] >= 20 && !overlapsSameFrame(element)
      ) ?? textElements[0];
    const photo = original.doc.elements
      .filter((e) => e.kind === 'image')
      .sort((a, b) => a.bounds[1] - b.bounds[1])[0];
    assert.ok(heading && photo, 'Need both editable text and a photograph');
    const select = async (id) => {
      const selector = `[data-el-id=${JSON.stringify(id)}]`;
      const node = canvas.locator(selector).filter({ visible: true }).first();
      await node.click({ force: true });
      await expect
        .poll(async () => canvas.evaluate('window.molly.selection().map((entry) => entry.id)'))
        .toContain(id);
      return node;
    };
    const saved = async (expected) => {
      await expect(canvas.locator('#autosave-status')).toHaveAttribute('data-state', 'saved', {
        timeout: 60_000,
      });
      await expect
        .poll(async () => (await ui.ipc('design.read', artworkId)).doc, { timeout: 60_000 })
        .toEqual(expected);
      await ui.reopen(artworkId);
      canvas = await ui.canvas(artworkId);
      assert.deepEqual(await snapshot(), expected);
      const projected = authoring.intakeAuthoring(
        'design.yaml',
        authoring.collectAuthoring(join(workdir, 'design-current'))
      );
      assert.equal(projected.status, 'ok');
      assert.deepEqual(projected.document, expected);
    };
    const headingNode = await select(heading.id);
    const text = headingNode.locator('.bento-text-inner');
    await text.dispatchEvent('dblclick');
    await expect(text).toHaveAttribute('contenteditable', 'true');
    await text.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await text.pressSequentially('Golden edit check');
    await text.blur();
    await expect
      .poll(async () =>
        JSON.stringify((await snapshot()).elements.find((e) => e.id === heading.id)?.text)
      )
      .toContain('Golden edit check');
    let edited = await snapshot();
    await saved(edited);
    assert.notEqual(
      await exportAndRecord('edited-heading', 'png'),
      report.exports['golden.png'].sha256
    );
    await select(heading.id);
    const moveStart = (await snapshot()).elements.find((e) => e.id === heading.id)?.bounds[1];
    assert.notEqual(moveStart, undefined, 'Selected heading must have a position');
    // Selection controls belong to the current native canvas WebContents.
    const positionY = canvas.getByRole('spinbutton', { name: 'Position Y', exact: true });
    await expect(positionY).toBeVisible({ timeout: 30_000 });
    await positionY.fill(String(moveStart + 2));
    await positionY.blur();
    await expect
      .poll(async () => (await snapshot()).elements.find((e) => e.id === heading.id)?.bounds[1])
      .toBe(moveStart + 2);
    edited = await snapshot();
    await saved(edited);
    await exportAndRecord('edited-move', 'png');
    await select(photo.id);
    const crop = canvas.getByRole('button', { name: 'Crop', exact: true });
    await expect(crop).toBeVisible({ timeout: 30_000 });
    await crop.click();
    await canvas.getByRole('spinbutton', { name: 'Left', exact: true }).fill('0.12');
    await canvas.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect
      .poll(async () => (await snapshot()).elements.find((e) => e.id === photo.id)?.crop)
      .toEqual([0.12, 0, 0, 0]);
    edited = await snapshot();
    await saved(edited);
    await exportAndRecord('edited-crop', 'png');
    report.editing = {
      status: 'passed',
      headingId: heading.id,
      imageId: photo.id,
      method:
        'visible inline text plus selection-pill position and crop controls, autosave, close/reopen and YAML roundtrip',
    };
  } finally {
    const commitId = version.commitId;
    assert.ok(commitId, 'Saved golden version must carry a Git commitId');
    await ui.ipc('design.restoreVersion', artworkId, commitId);
    await ui.reopen(artworkId);
    assert.deepEqual((await ui.ipc('design.read', artworkId)).doc, original.doc);
  }
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2));
}

export async function writeComparison(directory) {
  const reference = (await readFile(join(directory, 'reference.jpg'))).toString('base64');
  const output = (await readFile(join(directory, 'golden.png'))).toString('base64');
  const boundaries = [0, 216, 435, 715, 1015, 1446, 1662, 2000];
  const pair = (top, height) =>
    `<div class="pair">${[
      ['Reference', reference, 'jpeg'],
      ['Molly export', output, 'png'],
    ]
      .map(
        ([name, bytes, type]) =>
          `<figure><figcaption>${name} · y=${top}–${top + height}</figcaption><div style="height:${height}px"><img src="data:image/${type};base64,${bytes}" style="top:-${top}px" /></div></figure>`
      )
      .join('')}</div>`;
  await writeFile(
    join(directory, 'comparison.html'),
    `<!doctype html><meta charset="utf-8"><title>Golden replication comparison</title><style>body{font:14px system-ui;background:#eee;padding:24px}.pair{display:flex;gap:24px;margin:24px 0}figure{margin:0}figcaption{margin-bottom:8px}figure div{position:relative;overflow:hidden;width:285px;background:white}img{position:absolute;width:285px;height:2000px;left:0}h1{font-size:24px}</style><h1>Reference and actual Molly export</h1><p>Reference coordinates: 285 × 2000. Uniform display scaling only; native export dimensions are recorded in report.json. No warping, section alignment or score-based pass.</p>${pair(0, 2000)}<h2>Fixed corresponding regions</h2>${boundaries
      .slice(0, -1)
      .map((top, i) => pair(top, boundaries[i + 1] - top))
      .join('')}`
  );
}
