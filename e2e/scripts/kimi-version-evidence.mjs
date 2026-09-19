import { strict as assert } from 'node:assert';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { KimiReplicationPage } from '../src/support/pages/kimi-replication-page.ts';
import { sha } from './kimi-replication-evidence.mjs';

export async function verifyKimiVersions(h, { directory, artworkId, dataRoot, report, timeout }) {
  const ui = new KimiReplicationPage(h);
  const v1 = report.goldenVersion;
  const v2 = report.editedVersion;
  assert.ok(v1 && v2, 'Both original and edited versions must exist');
  const choose = async (version) => {
    await ui.page.getByRole('button', { name: 'Version history', exact: true }).click();
    await ui.page.getByRole('menuitem', { name: new RegExp(`^V${version.number} ·`) }).click();
    await expect
      .poll(async () => (await ui.ipc('design.state', artworkId)).baseVersionId)
      .toBe(version.commitId);
    return ui.canvas(artworkId);
  };
  const editHeading = async (value) => {
    const canvas = await ui.canvas(artworkId);
    const node = canvas
      .locator(`[data-el-id=${JSON.stringify(report.editing.headingId)}]`)
      .filter({ visible: true })
      .first();
    await node.click({ force: true });
    const text = node.locator('.bento-text-inner');
    await text.dispatchEvent('dblclick');
    await expect(text).toHaveAttribute('contenteditable', 'true');
    await text.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await text.pressSequentially(value);
    await text.blur();
    await expect(canvas.locator('#autosave-status')).toHaveAttribute('data-state', 'saved');
    await expect
      .poll(async () => JSON.stringify((await ui.ipc('design.read', artworkId)).doc))
      .toContain(value);
    return canvas;
  };
  await choose(v1);
  let canvas = await editHeading('GOLDEN-HUMAN');
  const human = await ui.ipc('design.read', artworkId);
  await canvas.getByRole('button', { name: 'Reference selected elements', exact: true }).click();
  const prompt = ui.page.locator('[data-molly-composer-input]');
  await expect(prompt).toHaveValue(/@Selected elements/);
  await prompt.focus();
  await prompt.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
  await prompt.pressSequentially(' 仅在我引用的标题现有文字末尾追加「 · Agent」，保留其他内容。');
  await ui.page.screenshot({ path: join(directory, 'human-followup-before-send.png') });
  await ui.page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(ui.page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible({
    timeout: 120_000,
  });
  await expect(ui.page.getByRole('button', { name: 'Save version', exact: true })).toBeDisabled();
  await expect(ui.page.getByRole('button', { name: 'Stop', exact: true })).toBeHidden({ timeout });
  canvas = await ui.canvas(artworkId);
  const continued = await ui.ipc('design.read', artworkId);
  const headingText = (doc) =>
    doc.elements
      .find((e) => e.id === report.editing.headingId)
      .text.paragraphs.flatMap((p) => p.runs.map((r) => r.text))
      .join('');
  assert.equal(headingText(continued.doc), 'GOLDEN-HUMAN · Agent');
  const otherElements = (doc) => doc.elements.filter((e) => e.id !== report.editing.headingId);
  assert.deepEqual(otherElements(continued.doc), otherElements(human.doc));
  const withoutHeadingText = (doc) => ({
    ...doc,
    elements: doc.elements.map((element) => {
      if (element.id !== report.editing.headingId) return element;
      const { text: _text, ...rest } = element;
      return rest;
    }),
  });
  assert.deepEqual(withoutHeadingText(continued.doc), withoutHeadingText(human.doc));
  assert.deepEqual(continued.assets, human.assets);
  assert.deepEqual(continued.doc.canvas, human.doc.canvas);
  assert.equal((await ui.ipc('design.state', artworkId)).baseVersionId, v1.commitId);
  await ui.page.getByRole('button', { name: 'Save version', exact: true }).click();
  await expect.poll(async () => (await ui.ipc('design.state', artworkId)).changed).toBe(false);
  const v3 = (await ui.ipc('design.versions', artworkId)).at(-1);
  assert.equal(v3.baseVersionId, v1.commitId);
  assert.notEqual(v3.commitId, v2.commitId);
  await ui.page.screenshot({ path: join(directory, 'branched-v3.png') });
  await editHeading('PROTECT-UNVERSIONED');
  const unversioned = await ui.ipc('design.read', artworkId);
  await choose(v2);
  const versions = await ui.ipc('design.versions', artworkId);
  const protection = versions.at(-1);
  assert.equal(protection.kind, 'before-restore');
  assert.equal(protection.baseVersionId, v3.commitId);
  await ui.reopen(artworkId);
  assert.equal((await ui.ipc('design.state', artworkId)).baseVersionId, v2.commitId);
  assert.deepEqual(await ui.ipc('design.versions', artworkId), versions);
  await choose(protection);
  assert.deepEqual((await ui.ipc('design.read', artworkId)).doc, unversioned.doc);
  await choose(v1);
  for (const format of ['png', 'jpeg']) {
    const file = join(directory, `restored-v1.${format}`);
    await ui.export(artworkId, format, file);
    assert.equal(sha(await readFile(file)), report.exports[`golden.${format}`].sha256);
  }
  const inputs = join(dataRoot, 'chats', artworkId, 'design-input');
  const receipts = [];
  for (const turn of await readdir(inputs)) {
    try {
      receipts.push(JSON.parse(await readFile(join(inputs, turn, 'receipt.json'), 'utf8')));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  assert.equal(receipts.length, 2, 'Exactly two explicitly prescribed real Agent dispatches');
  assert.ok(receipts.every((r) => r.status === 'committed'));
  report.versionFlow = { status: 'passed', v1, v2, v3, protection, receipts };
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2));
}
