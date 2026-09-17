/** Real, isolated desktop verification. Screenshots require an on-screen macOS session. */
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';
import { expect } from '@playwright/test';
import { ElectronHarness } from '../src/support/electron-harness.ts';
import { OnboardingPage } from '../src/support/pages/onboarding-page.ts';
import { collectAuthoring, intakeAuthoring } from '../../packages/design-authoring/src/index.ts';
import { designOperation } from '../../apps/cli/src/design/store.ts';

const directory = fileURLToPath(
  new URL(`../artifacts/selection-toolbar/${Date.now()}/`, import.meta.url)
);
await mkdir(directory, { recursive: true });
const harness = new ElectronHarness({
  rootDir: directory,
  scenarioDir: directory,
  stableId: 'selection-toolbar',
});
const report = {
  status: 'running',
  sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  buildHash: createHash('sha256')
    .update(await readFile(new URL('../../apps/electron/out/main/index.js', import.meta.url)))
    .digest('hex'),
  screenshots: [],
  checks: [],
  humanVisualVerdict: 'pending',
  directory,
};
console.log(directory);
const text = (value) => ({ paragraphs: [{ runs: [{ text: value }] }] });
const image = await readFile(
  new URL('../fixtures/design/poster/media/reference.png', import.meta.url)
);
const imageHash = createHash('sha256').update(image).digest('hex');
const font = await readFile(
  createRequire(new URL('../../packages/design-bento/package.json', import.meta.url)).resolve(
    '@fontsource/inter/files/inter-latin-400-normal.woff2'
  )
);
const fontHash = createHash('sha256').update(font).digest('hex');
const fixture = {
  schemaVersion: 4,
  fonts: [
    { family: 'Inter', src: `asset:${fontHash}` },
    { family: 'Inter Extended Fixture Family', src: `asset:${fontHash}` },
  ],
  canvas: { width: 1200, height: 900 },
  background: { type: 'solid', color: '#f4f1eb' },
  elements: [
    {
      id: 'text',
      kind: 'text',
      bounds: [85, 130, 440, 100],
      text: {
        ...text('Make room for ideas.'),
        fontFamily: 'Inter',
        fontSize: 36,
        color: '#223d38',
        bold: true,
      },
    },
    {
      id: 'shape',
      kind: 'shape',
      bounds: [730, 150, 280, 115],
      shapeName: 'rect',
      fill: { type: 'solid', color: '#829e8b' },
      border: { style: 'solid', color: '#223d38', width: 2 },
    },
    {
      id: 'image',
      kind: 'image',
      bounds: [85, 330, 290, 235],
      src: `asset:${imageHash}`,
      fit: 'cover',
    },
    {
      id: 'line',
      kind: 'line',
      bounds: [465, 340, 270, 80],
      viewBox: [270, 80],
      points: '0,40 270,40',
      border: { style: 'solid', width: 4, color: '#223d38' },
    },
    {
      id: 'icon',
      kind: 'icon',
      bounds: [860, 355, 100, 100],
      iconName: 'fas:star',
      fill: { type: 'solid', color: '#bf853a' },
    },
    {
      id: 'table',
      kind: 'table',
      bounds: [85, 650, 330, 150],
      table: {
        columnWidths: [0.5, 0.5],
        rowHeights: [0.5, 0.5],
        rows: [
          [{ text: text('Explore') }, { text: text('Create') }],
          [{ text: text('Review') }, { text: text('Refine') }],
        ],
      },
    },
    {
      id: 'chart',
      kind: 'chart',
      bounds: [640, 570, 400, 255],
      chart: {
        data: {
          cols: ['Category', 'Progress'],
          rows: [
            ['A', 4],
            ['B', 6],
            ['C', 5],
          ],
        },
        series: [{ type: 'bar', name: 'Progress', encode: { x: 'Category', y: 'Progress' } }],
      },
    },
    ...Array.from({ length: 3 }, (_, index) => ({
      id: `label-${index}`,
      kind: 'text',
      bounds: [465 + index * 160, 480, 140, 45],
      text: {
        ...text(['Explore', 'Create', 'Refine'][index]),
        fontFamily: 'Inter',
        fontSize: 18 + index * 2,
        color: ['#223d38', '#bf853a', '#657a71'][index],
      },
    })),
  ].map((element, zIndex) => ({ ...element, zIndex })),
};
let app, page;
let editor;
try {
  await harness.launch();
  ({ app, page } = harness);
  assert(app && page);
  const onboarding = new OnboardingPage(page);
  await onboarding.waitForLocalBootstrap();
  await onboarding.skipConfigurationAndEnterProduct();
  console.log('bootstrapped');
  const runtime = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setSize(1680, 1050);
    win.show();
    win.focus();
    return {
      dataRoot: process.env.MOLLY_DATA_DIR,
      windowSource: win.getMediaSourceId(),
      versions: process.versions,
      platform: process.platform,
    };
  });
  report.runtime = { versions: runtime.versions, platform: runtime.platform };
  report.fixture = fixture;
  const ipc = (channel, ...args) =>
    page.evaluate(({ channel: method, args: values }) => window.ipc.invoke(method, ...values), {
      channel,
      args,
    });
  const [platform, cli] = await Promise.all([
    ipc('localPlatform.getSnapshot'),
    ipc('cli.getState'),
  ]);
  const id = randomUUID();
  await designOperation(runtime.dataRoot, {
    operation: 'create',
    association: {
      sessionId: id,
      name: 'Selection toolbar · visual review',
      userId: platform.userId,
      machineId: cli.runtime.machineId,
      createdAt: '2026-09-17T00:00:00.000Z',
    },
    width: 1200,
    height: 900,
    copy: {
      doc: fixture,
      assets: {
        [fontHash]: `data:font/woff2;base64,${font.toString('base64')}`,
        [imageHash]: `data:image/png;base64,${image.toString('base64')}`,
      },
    },
  });
  await page.reload();
  await expect.poll(async () => (await ipc('design.pending')).length, { timeout: 30000 }).toBe(0);
  await page.evaluate((sessionId) => (location.hash = `/local/sessions/${sessionId}`), id);
  console.log('session', id);
  await page.getByRole('button', { name: /^(Current artwork|当前画布)$/u }).click();
  await expect(page.getByRole('button', { name: 'Artwork', exact: true })).toBeVisible({
    timeout: 30000,
  });
  editor = (script) =>
    app.evaluate(async ({ BrowserWindow }, source) => {
      const owner = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().includes('#/local/')
      );
      const view = owner?.contentView.children.find((v) =>
        v.webContents?.getURL().startsWith('molly-design://')
      );
      if (!view) throw Error('No native canvas');
      return view.webContents.executeJavaScript(source);
    }, script);
  await expect
    .poll(
      async () => {
        try {
          return await editor('window.molly?.state()?.ready');
        } catch {
          return false;
        }
      },
      { timeout: 30000 }
    )
    .toBe(true);
  await expect.poll(() => editor('window.molly.state().readonly'), { timeout: 30000 }).toBe(false);
  console.log(
    'canvas-ready',
    await editor(
      '({state:window.molly.state(),viewport:[innerWidth,innerHeight],stage:document.querySelector(".ed-stage-scale").getBoundingClientRect().toJSON()})'
    )
  );
  await editor('document.fonts.ready.then(() => true)');
  await editor(
    'Promise.all([...document.querySelectorAll(".ed-stage-scale img")].map(image => image.decode()))'
  );
  let canvasId = await app.evaluate(
    ({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].contentView.children.find((v) =>
        v.webContents?.getURL().startsWith('molly-design://')
      )?.webContents.id
  );
  // Input enters the actual native view through Electron; no direct store selection.
  const mouse = (type, x, y, extra = {}) =>
    app.evaluate(
      ({ webContents }, input) => {
        webContents.fromId(input.id).focus();
        webContents.fromId(input.id).sendInputEvent({
          type: input.type,
          x: input.x,
          y: input.y,
          button: 'left',
          clickCount: 1,
          ...input.extra,
        });
      },
      { id: canvasId, type, x: Math.round(x), y: Math.round(y), extra }
    );
  const select = async (elementId) => {
    const edge = await editor('innerWidth - 3');
    await mouse('mouseDown', edge, 5);
    await mouse('mouseUp', edge, 5);
    await editor('new Promise(resolve=>requestAnimationFrame(resolve))');
    await editor(
      `document.querySelector('.ed-stage-scale [data-el-id="${elementId}"]').scrollIntoView({block:'nearest',inline:'nearest'})`
    );
    const point = await editor(
      `(() => { const r = document.querySelector('.ed-stage-scale [data-el-id="${elementId}"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`
    );
    await mouse('mouseMove', point.x, point.y);
    await mouse('mouseDown', point.x, point.y);
    await mouse('mouseUp', point.x, point.y);
    await expect.poll(() => editor('window.molly.selection().map(e => e.id)')).toEqual([elementId]);
    await expect
      .poll(() => editor('!document.querySelector(".molly-selection-toolbar").hidden'))
      .toBe(true);
    await editor(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
    );
  };
  const click = async (name) => {
    await expect
      .poll(() =>
        editor(
          '!document.querySelector(".molly-selection-toolbar").hidden && document.querySelector(".molly-selection-toolbar").getAttribute("aria-busy")!=="true"'
        )
      )
      .toBe(true);
    await editor('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const point = await editor(
      `(() => { const node = [...document.querySelectorAll('[data-molly-toolbar] button')].find(n => n.getAttribute('aria-label') === ${JSON.stringify(name)}); if (!node) throw Error('Missing button: ' + ${JSON.stringify(name)}); const r = node.getBoundingClientRect(); return { x: r.x+r.width/2, y:r.y+r.height/2 }; })()`
    );
    await mouse('mouseMove', point.x, point.y);
    await mouse('mouseDown', point.x, point.y);
    await mouse('mouseUp', point.x, point.y);
  };
  const shot = async (name) => {
    await editor(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
    );
    const file = path.join(directory, `${name}.png`);
    const windowId = runtime.windowSource.split(':')[1];
    execFileSync('/usr/sbin/screencapture', ['-x', '-o', '-l', windowId, file]);
    const detail = await editor(
      `(() => { const bar = document.querySelector('.molly-selection-toolbar'); const r=bar.getBoundingClientRect(); return { selection:window.molly.selection(), hidden:bar.hidden, bar:{x:r.x,y:r.y,width:r.width,height:r.height}, viewport:{width:innerWidth,height:innerHeight}, dark:bar.dataset.dark }; })()`
    );
    const nativeBounds = await app.evaluate(({ webContents, BrowserWindow }, target) => {
      const owner = BrowserWindow.fromWebContents(webContents.fromId(target));
      const win = owner ?? BrowserWindow.getAllWindows()[0];
      return win.contentView.children.find((v) => v.webContents?.id === target)?.getBounds();
    }, canvasId);
    const visibleViews = await app.evaluate(async ({ BrowserWindow }) =>
      Promise.all(
        BrowserWindow.getAllWindows()[0]
          .contentView.children.filter((v) => v.webContents?.getURL().startsWith('molly-design://'))
          .map(async (v) => ({
            visible: v.getVisible(),
            state: await v.webContents.executeJavaScript('window.molly?.state()'),
            toolbarHidden: await v.webContents.executeJavaScript(
              'document.querySelector(".molly-selection-toolbar")?.hidden'
            ),
          }))
      )
    );
    const geometry = await editor(
      `({scale:document.querySelector('.ed-stage-scale').getBoundingClientRect().width/1200,stage:document.querySelector('.ed-stage-scale').getBoundingClientRect().toJSON(),selectedRects:window.molly.selection().map(e=>({id:e.id,rect:document.querySelector('.ed-stage-scale [data-el-id="'+CSS.escape(e.id)+'"]').getBoundingClientRect().toJSON()}))})`
    );
    report.screenshots.push({ name, file, nativeBounds, visibleViews, ...detail, ...geometry });
    console.log('shot', name);
    return detail;
  };
  const english = JSON.parse(
    await readFile(new URL('../../locales/en.json', import.meta.url), 'utf8')
  );
  const chinese = JSON.parse(
    await readFile(new URL('../../locales/zh_CN.json', import.meta.url), 'utf8')
  );
  const present = async (dark, locale = english) => {
    await page.evaluate((isDark) => {
      const value = isDark ? 'dark' : 'light';
      localStorage.setItem('vite-ui-theme', value);
      window.dispatchEvent(new StorageEvent('storage', { key: 'vite-ui-theme', newValue: value }));
    }, dark);
    await ipc('design.presentToolbar', id, id, {
      dark,
      actionsEnabled: true,
      labels: Object.fromEntries(
        Object.entries(locale)
          .filter(([key]) => key.startsWith('design.') && !key.endsWith('Prompt'))
          .slice(-90)
          .map(([key, value]) => [key.slice(7), value])
      ),
    });
    await expect
      .poll(() => editor('document.querySelector(".molly-selection-toolbar").dataset.dark'))
      .toBe(String(dark));
  };
  for (const dark of process.env.TOOLBAR_EXTENSIONS_ONLY ? [] : [false, true]) {
    await present(dark);
    for (const kind of ['text', 'shape', 'image', 'line', 'icon', 'table', 'chart']) {
      await select(kind);
      await shot(`${dark ? 'dark' : 'light'}-${kind}`);
    }
    for (const [kind, name, suffix] of [
      ['text', 'Text color', 'color'],
      ['text', 'Font', 'font'],
      ['image', 'Image fit', 'fit'],
      ['image', 'Crop', 'crop'],
      ['line', 'Arrowheads', 'arrows'],
    ]) {
      await select(kind);
      await click(name);
      await expect
        .poll(() => editor('!!document.querySelector(".molly-selection-popup")'))
        .toBe(true);
      await shot(`${dark ? 'dark' : 'light'}-${suffix}-popup`);
      assert.equal(await editor('!!document.querySelector(".molly-selection-popup")'), true);
      await editor(
        'document.querySelector(".molly-selection-popup").dispatchEvent(new KeyboardEvent("keydown", {key:"Escape",bubbles:true}))'
      );
    }
  }
  await present(false);
  const key = async (keyCode, modifiers = []) =>
    app.evaluate(
      ({ webContents }, input) => {
        const wc = webContents.fromId(input.id);
        wc.focus();
        wc.sendInputEvent({
          type: 'keyDown',
          keyCode: input.keyCode.length === 1 ? input.keyCode.toUpperCase() : input.keyCode,
          modifiers: input.modifiers,
        });
        wc.sendInputEvent({
          type: 'keyUp',
          keyCode: input.keyCode.length === 1 ? input.keyCode.toUpperCase() : input.keyCode,
          modifiers: input.modifiers,
        });
      },
      { id: canvasId, keyCode, modifiers }
    );
  const clickSelector = async (selector) => {
    const point = await editor(
      `(() => {const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`
    );
    await mouse('mouseMove', point.x, point.y);
    await mouse('mouseDown', point.x, point.y);
    await mouse('mouseUp', point.x, point.y);
    await editor('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  };
  const settle = () =>
    editor('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const snap = () => editor('JSON.parse(window.bento.visual.snapshot())');
  const addSelection = async (elementId) => {
    const point = await editor(
      `(() => {const r=document.querySelector('.ed-stage-scale [data-el-id="${elementId}"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`
    );
    await app.evaluate(
      ({ webContents }, target) =>
        webContents.fromId(target).sendInputEvent({ type: 'keyDown', keyCode: 'Shift' }),
      canvasId
    );
    await mouse('mouseDown', point.x, point.y, { modifiers: ['shift'] });
    await mouse('mouseUp', point.x, point.y, { modifiers: ['shift'] });
    await app.evaluate(
      ({ webContents }, target) =>
        webContents.fromId(target).sendInputEvent({ type: 'keyUp', keyCode: 'Shift' }),
      canvasId
    );
    await settle();
  };
  await select('text');
  await addSelection('label-0');
  await expect.poll(() => editor('window.molly.selection().length')).toBe(2);
  await shot('same-kind-multi');
  await addSelection('shape');
  await expect.poll(() => editor('window.molly.selection().length')).toBe(3);
  await shot('mixed-multi');
  await select('text');
  const stage = await editor(
    'document.querySelector(".ed-stage-scale").getBoundingClientRect().toJSON()'
  );
  await mouse('mouseDown', stage.left - 8, stage.top - 8);
  await mouse('mouseMove', stage.right + 8, stage.bottom + 8);
  await mouse('mouseUp', stage.right + 8, stage.bottom + 8);
  await expect.poll(() => editor('window.molly.selection().length')).toBe(10);
  await shot('over-eight');
  await select('label-0');
  await addSelection('label-1');
  await key('g', ['command']);
  await expect.poll(async () => (await snap()).elements.filter((e) => e.groupId).length).toBe(2);
  await shot('group-selection');
  await key('z', ['command']);
  await expect.poll(async () => (await snap()).elements.filter((e) => e.groupId).length).toBe(0);

  // Hold only this isolated view's toolbar request on an explicit test signal.
  const holdRequest = async () => {
    await editor(
      `(() => {const original=window.fetch;window.__toolbarSettled=false;window.fetch=(...args)=>{const result=original(...args);if(String(args[0]).endsWith('/toolbar')) result.finally(()=>window.__toolbarSettled=true);return result;};})()`
    );
    await app.evaluate(({ webContents }, target) => {
      const wc = webContents.fromId(target),
        url = new URL(wc.getURL()),
        origin = url.protocol + '//' + url.host;
      globalThis.__toolbarGate = { done: null, origin };
      wc.session.webRequest.onBeforeRequest((details, done) => {
        if (details.url.startsWith(origin + '/') && details.url.endsWith('/toolbar')) {
          globalThis.__toolbarGate.done = done;
          return;
        }
        done({
          cancel: !details.url.startsWith(origin + '/') && !/^(data|blob):/.test(details.url),
        });
      });
    }, canvasId);
  };
  const releaseRequest = async () => {
    await app.evaluate(({ webContents }, target) => {
      const gate = globalThis.__toolbarGate;
      gate.done({ cancel: false });
      webContents.fromId(target).session.webRequest.onBeforeRequest((details, done) =>
        done({
          cancel: !details.url.startsWith(gate.origin + '/') && !/^(data|blob):/.test(details.url),
        })
      );
      delete globalThis.__toolbarGate;
    }, canvasId);
    await expect.poll(() => editor('window.__toolbarSettled')).toBe(true);
  };
  // Real property edit, one undo, and persisted read-back.
  await select('text');
  const before = (await snap()).elements.find((e) => e.id === 'text').text;
  await holdRequest();
  await click('Bold');
  await expect.poll(() => app.evaluate(() => !!globalThis.__toolbarGate?.done)).toBe(true);
  await shot('command-busy');
  await releaseRequest();
  await expect
    .poll(async () => (await snap()).elements.find((e) => e.id === 'text').text.bold)
    .toBe(false);
  await shot('text-after-edit');
  await key('z', ['command']);
  await expect
    .poll(async () => (await snap()).elements.find((e) => e.id === 'text').text.bold)
    .toBe(before.bold);
  await shot('text-after-undo');
  await clickSelector('.molly-selection-toolbar input[aria-label="Font size"]');
  assert.equal(await editor('document.activeElement?.getAttribute("aria-label")'), 'Font size');
  await editor('document.activeElement.select()');
  await app.evaluate(
    ({ webContents }, target) => webContents.fromId(target).insertText('42'),
    canvasId
  );
  await key('Enter');
  await expect
    .poll(async () => (await snap()).elements.find((e) => e.id === 'text').text.fontSize)
    .toBe(42);
  await shot('text-size-after-edit');
  await mouse('mouseDown', await editor('innerWidth - 3'), 5);
  await mouse('mouseUp', await editor('innerWidth - 3'), 5);
  await key('z', ['command']);
  await expect
    .poll(async () => (await snap()).elements.find((e) => e.id === 'text').text.fontSize)
    .toBe(before.fontSize);
  await select('text');
  await shot('text-size-after-undo');
  const inlinePoint = await editor(
    `(()=>{const r=document.querySelector('.ed-stage-scale [data-el-id="text"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`
  );
  await mouse('mouseDown', inlinePoint.x, inlinePoint.y, { clickCount: 2 });
  await mouse('mouseUp', inlinePoint.x, inlinePoint.y, { clickCount: 2 });
  await expect
    .poll(() => editor('!!document.querySelector(".bento-editing [contenteditable=true]")'))
    .toBe(true);
  await app.evaluate(
    ({ webContents }, target) => webContents.fromId(target).insertText('Inline text verification'),
    canvasId
  );
  await click('Text color');
  assert.deepEqual(await editor('window.molly.selection().map(e=>e.id)'), ['text']);
  await expect
    .poll(async () => JSON.stringify((await snap()).elements.find((e) => e.id === 'text').text))
    .toContain('Inline text verification');
  await shot('inline-text-color-popup');
  await key('Escape');
  await mouse('mouseDown', await editor('innerWidth - 3'), 5);
  await mouse('mouseUp', await editor('innerWidth - 3'), 5);
  await expect
    .poll(async () => JSON.stringify((await snap()).elements.find((e) => e.id === 'text').text))
    .toContain('Inline text verification');
  await key('z', ['command']);
  await expect
    .poll(async () => (await snap()).elements.find((e) => e.id === 'text').text)
    .toEqual(before);
  await select('text');
  await ipc('design.save', id);
  assert.deepEqual(
    (await ipc('design.read', id)).doc.elements.find((e) => e.id === 'text').text,
    before
  );
  await holdRequest();
  await click('Bold');
  await expect.poll(() => app.evaluate(() => !!globalThis.__toolbarGate?.done)).toBe(true);
  await select('shape');
  await releaseRequest();
  assert.deepEqual((await snap()).elements.find((e) => e.id === 'text').text, before);
  await shot('stale-request-new-selection');
  // Invalid image actions surface an error without dispatching an Agent.
  await select('table');
  await click('Generate selected images');
  await expect.poll(() => editor('!!document.querySelector(".molly-selection-error")')).toBe(true);
  await shot('action-error');
  await select('text');
  await click('Reference selected elements');
  await expect
    .poll(() =>
      page.evaluate(() => ({
        focused:
          document.activeElement?.getAttribute('contenteditable') === 'true' ||
          document.activeElement?.tagName === 'TEXTAREA',
        mention: document.body.innerText.includes('@Selected elements (1)'),
      }))
    )
    .toEqual({ focused: true, mention: true });
  await shot('reference-composer');

  // Native drag: toolbar hidden in-flight and restored at the committed geometry.
  await select('shape');
  const center = await editor(
    `(()=>{const r=document.querySelector('.ed-stage-scale [data-el-id="shape"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`
  );
  await mouse('mouseDown', center.x, center.y);
  await mouse('mouseMove', center.x + 20, center.y + 20);
  await settle();
  assert.equal(await editor('document.querySelector(".molly-selection-toolbar").hidden'), true);
  await shot('drag-hidden');
  await mouse('mouseUp', center.x + 20, center.y + 20);
  await expect
    .poll(() => editor('!document.querySelector(".molly-selection-toolbar").hidden'))
    .toBe(true);
  await shot('drag-restored');
  await key('z', ['command']);

  // Zoom via existing controls; adjust the real split window to attain the target scale.
  const resizeCanvas = async (width) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const actual = await editor('innerWidth');
      if (Math.abs(actual - width) <= 1) break;
      await app.evaluate(({ BrowserWindow }, difference) => {
        const win = BrowserWindow.getAllWindows()[0];
        const b = win.getBounds();
        win.setSize(Math.round(b.width + difference * 2), b.height);
      }, width - actual);
      await expect.poll(() => editor('innerWidth')).not.toBe(actual);
    }
    await settle();
  };
  const scales = [];
  for (const [target, steps] of [
    [0.5, 0],
    [1, 2],
    [2, 5],
  ]) {
    await clickSelector('.ed-zoomlabel');
    await resizeCanvas(Math.round(64 + (1200 * target) / 1.25 ** steps));
    for (let index = 0; index < steps; index++)
      await clickSelector('.ed-zoombar button:last-child');
    const actual = await editor(
      'document.querySelector(".ed-stage-scale").getBoundingClientRect().width/1200'
    );
    assert(Math.abs(actual - target) < 0.005, `Actual zoom ${actual} != ${target}`);
    await select('text');
    const evidence = await shot(`zoom-${target * 100}`);
    scales.push({ target, actual, width: evidence.bar.width, height: evidence.bar.height });
  }
  assert(scales.every((s) => s.height === scales[0].height));
  report.checks.push({ scales });
  await select('icon');
  for (const [name, left, top] of [
    ['edge-bottom-right', 'innerWidth-r.width-16', 'innerHeight-r.height-16'],
    ['edge-bottom-left', '8', 'innerHeight-r.height-16'],
    ['edge-top-right', 'innerWidth-r.width-16', '8'],
    ['partially-offscreen', '-r.width/2', '8'],
  ]) {
    await editor(
      `(()=>{const r=document.querySelector('.ed-stage-scale [data-el-id="icon"]').getBoundingClientRect();document.querySelector('.ed-scroll').scrollBy(r.left-(${left}),r.top-(${top}))})()`
    );
    await settle();
    const evidence = await shot(name);
    assert.equal(evidence.hidden, false);
    assert(
      evidence.bar.x >= 0 &&
        evidence.bar.y >= 0 &&
        evidence.bar.x + evidence.bar.width <= evidence.viewport.width &&
        evidence.bar.y + evidence.bar.height <= evidence.viewport.height
    );
  }
  await select('text');
  await editor(
    `(()=>{const r=document.querySelector('.ed-stage-scale [data-el-id="text"]').getBoundingClientRect();document.querySelector('.ed-scroll').scrollBy(r.left-8,r.top-8)})()`
  );
  await settle();
  await shot('edge-top-left');
  await click('Text color');
  await shot('edge-color-popup');
  await key('Escape');
  await editor(
    `(()=>{const r=document.querySelector('.ed-stage-scale [data-el-id="text"]').getBoundingClientRect();document.querySelector('.ed-scroll').scrollBy(r.right+20,0)})()`
  );
  await settle();
  assert.equal(await editor('document.querySelector(".molly-selection-toolbar").hidden'), true);
  await shot('offscreen-hidden');
  await clickSelector('.ed-zoomlabel');
  await resizeCanvas(450);
  await select('text');
  await shot('narrow-text');
  await present(true);
  await shot('narrow-text-dark');
  await editor('document.querySelector(".molly-selection-toolbar button").focus()');
  for (let index = 0; index < 11; index++) await key('Tab');
  await settle();
  assert.equal(
    await editor(`(()=>{
    const bar=document.querySelector('.molly-selection-toolbar');
    const button=bar.querySelector('button:last-child');
    const r=button.getBoundingClientRect(); const b=bar.getBoundingClientRect();
    return document.activeElement===button && bar.scrollLeft>0 && r.right<=b.right;
  })()`),
    true
  );
  await shot('narrow-text-keyboard-end');
  await present(false, chinese);
  await select('image');
  await shot('narrow-image-zh');
  await resizeCanvas(814);
  await present(false);
  await select('text');
  await editor(
    'window.__restoreReadonly = window.molly.setReadonly; window.molly.setReadonly = (...args) => window.__restoreReadonly(true, args[1]); window.molly.setReadonly(true)'
  );
  await settle();
  assert.equal(await editor('document.querySelector(".molly-selection-toolbar").hidden'), true);
  await shot('readonly-hidden');
  assert.equal(
    (await editor('window.molly.applyCommands({verb:"text-style",bold:false})')).ok,
    false
  );
  await editor(
    'window.molly.setReadonly=window.__restoreReadonly; delete window.__restoreReadonly; window.molly.setReadonly(false)'
  );
  await select('text');
  const retained = await editor(
    '({selection:window.molly.selection(),zoom:document.querySelector(".ed-stage-scale").style.transform})'
  );
  await page.evaluate(() => (location.hash = '/local/chat'));
  await expect
    .poll(() =>
      app.evaluate(({ webContents }, target) => webContents.fromId(target) !== undefined, canvasId)
    )
    .toBe(true);
  await page.evaluate((sessionId) => (location.hash = `/local/sessions/${sessionId}`), id);
  await page.getByRole('button', { name: 'Current artwork', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Artwork', exact: true })).toBeVisible();
  await expect
    .poll(() => editor('!document.querySelector(".molly-selection-toolbar").hidden'))
    .toBe(true);
  assert.deepEqual(
    await editor(
      '({selection:window.molly.selection(),zoom:document.querySelector(".ed-stage-scale").style.transform})'
    ),
    retained
  );
  await shot('remount-retained');
  await page.getByText('Selection toolbar · visual review', { exact: true }).first().hover();
  await expect(page.getByRole('dialog')).toBeVisible();
  const visibleCanvas = () =>
    app.evaluate(
      ({ BrowserWindow }, target) =>
        BrowserWindow.getAllWindows()[0]
          .contentView.children.find((v) => v.webContents?.id === target)
          ?.getVisible(),
      canvasId
    );
  assert.equal(await visibleCanvas(), true);
  await shot('sidebar-hover-retained');
  await page.getByRole('button', { name: 'Version history', exact: true }).click();
  await expect.poll(visibleCanvas).toBe(false);
  await shot('external-menu');
  await page.keyboard.press('Escape');
  await expect
    .poll(() => editor('!document.querySelector(".molly-selection-toolbar").hidden'))
    .toBe(true);
  await ipc('design.saveVersion', id);
  await page.getByRole('button', { name: 'Version history', exact: true }).click();
  await page.getByRole('menuitem', { name: /^V1/ }).click();
  await expect(
    page.getByText('Read-only version. Edit from here to restore it as the current artwork.')
  ).toBeVisible();
  await shot('history-readonly');
  await page.getByRole('button', { name: 'Artwork', exact: true }).click();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await shot('source-preview');
  await page.getByRole('button', { name: 'Artwork', exact: true }).click();
  await select('text');
  await key('Escape');
  await settle();
  assert.equal(await editor('document.querySelector(".molly-selection-toolbar").hidden'), true);
  await shot('empty-selection');
  await ipc('design.save', id);
  const saved = await ipc('design.read', id);
  const intake = intakeAuthoring(
    'design.yaml',
    collectAuthoring(path.join(runtime.dataRoot, 'chats', id, 'design-current'))
  );
  assert.equal(intake.status, 'ok');
  assert.deepEqual(intake.document.elements, saved.doc.elements);
  const exportPng = async (name) => {
    const output = path.join(directory, name + '.png');
    await app.evaluate(({ dialog }, file) => {
      globalThis.__saveDialog = dialog.showSaveDialog;
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, output);
    try {
      await ipc('design.export', id, 'png', 'Toolbar fixture');
    } finally {
      await app.evaluate(({ dialog }) => {
        dialog.showSaveDialog = globalThis.__saveDialog;
        delete globalThis.__saveDialog;
      });
    }
    return readFile(output);
  };
  await select('text');
  const selectedExport = await exportPng('export-selected');
  await key('Escape');
  const emptyExport = await exportPng('export-empty');
  assert.deepEqual(selectedExport, emptyExport);
  await ipc('design.close', id);
  await page.reload();
  await expect
    .poll(
      async () => {
        try {
          return await editor('window.molly?.state()?.ready');
        } catch {
          return false;
        }
      },
      { timeout: 30000 }
    )
    .toBe(true);
  assert.deepEqual((await snap()).elements, saved.doc.elements);
  canvasId = await app.evaluate(
    ({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].contentView.children.find((v) =>
        v.webContents?.getURL().startsWith('molly-design://')
      )?.webContents.id
  );
  await select('text');
  await shot('saved-reopened');
  report.checks.push(
    'Native edit/undo, saved YAML round-trip, close/reopen and selection-independent PNG exports'
  );
  report.status = 'passed';
  report.checks.push('Seven actual selected element kinds and five popup kinds in both themes');
} catch (error) {
  report.status = 'failed';
  report.error = String(error);
  console.error(error);
  if (editor)
    console.error(
      'canvas-debug',
      await editor(
        '({state:window.molly.state(),selection:window.molly.selection(),elements:[...document.querySelectorAll("[data-el-id]")].map(n=>({id:n.dataset.elId,rect:n.getBoundingClientRect().toJSON()}))})'
      ).catch(String)
    );
  if (page) {
    await writeFile(
      path.join(directory, 'failure-dom.txt'),
      await page
        .locator('body')
        .innerText()
        .catch(() => '')
    );
    await page.screenshot({ path: path.join(directory, 'failure-shell.png') }).catch(() => {});
  }
  process.exitCode = 1;
} finally {
  await writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  await harness.close().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
