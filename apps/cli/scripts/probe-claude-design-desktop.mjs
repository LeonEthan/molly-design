/** Manual acceptance probe. Reuses the existing Electron harness; only provider wire is synthetic.
 * Build desktop first (or select an installed executable), then run with tsx and MOLLY_PROBE_CLAUDE. Not a registered regression journey. */
import { ElectronHarness } from '../../../e2e/src/support/electron-harness.ts';
import { OnboardingPage } from '../../../e2e/src/support/pages/onboarding-page.ts';
import { createRequire } from 'node:module';
const { expect } = createRequire(new URL('../../../e2e/package.json', import.meta.url))(
  '@playwright/test'
);
const resubmitMode = true;
const claude = (process.env.MOLLY_PROBE_CLAUDE ?? process.env.LODY_PROBE_CLAUDE);
if (!claude) throw Error('Set MOLLY_PROBE_CLAUDE to pinned native executable');
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, mkdtemp, writeFile, readFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { designOperation } from '../src/design/store.ts';
import { readDesignArtifactDigest } from '../src/design/artifact.ts';
const root = await mkdtemp(path.join(tmpdir(), 'molly-t17-desktop-'));
const scenarioDir = path.join(root, 'evidence');
await mkdir(scenarioDir);
const referenceBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
const referencePath = path.join(root, 'synthetic-reference.png');
await writeFile(referencePath, Buffer.from(referenceBase64, 'base64'));
let inputStep = 0;
let permissionRequested = false;
let referenceDelivered = false;
let skillDelivered = false;
let deliveredSkillPath;
let nativeToolNames = [];
let editCalls = 0;
let resubmitCalls = 0;
let artworkId;
let dataRoot;
let externalRevision;
let draft = '';
let sourceFiles = new Map();
let blocked = false;
const provider = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString();
  if (!raw) {
    res.end('{}');
    return;
  }
  const body = JSON.parse(raw);
  if (!Array.isArray(body.messages)) {
    res.end('{}');
    return;
  }
  const messages = JSON.stringify(body.messages);
  const resubmitting = messages.includes('SYNTHETIC_RESUBMIT');
  const editing = messages.includes('SYNTHETIC_EDIT');
  let content = [{ type: 'text', text: 'SYNTHETIC_INITIAL_FINISHED' }];
  const tool = (name, input, i) => ({
    type: 'tool_use',
    id: `toolu_${resubmitting ? 'resubmit' : 'edit'}_${resubmitting ? resubmitCalls : editCalls}_${i}`,
    name,
    input,
  });
  if (!resubmitting && !editing && messages.includes('Design authoring directory:')) {
    nativeToolNames = body.tools.map((entry) => entry.name);
    if (inputStep === 0) {
      referenceDelivered = body.messages.some(
        (message) =>
          Array.isArray(message.content) &&
          message.content.some(
            (part) => part.type === 'image' && part.source?.data === referenceBase64
          )
      );
      assert(referenceDelivered, 'reference image bytes must reach the native provider');
      const skillPath = messages.match(/Design format and optional helpers: (.+?SKILL\.md)/)?.[1];
      assert(skillPath, 'packaged skill location must reach the native prompt');
      deliveredSkillPath = skillPath;
      content = [
        { type: 'tool_use', id: 'toolu_inputs_0', name: 'Read', input: { file_path: skillPath } },
      ];
    } else {
      skillDelivered = body.messages.some(
        (message) =>
          Array.isArray(message.content) &&
          message.content.some(
            (part) =>
              part.type === 'tool_result' &&
              part.tool_use_id === 'toolu_inputs_0' &&
              JSON.stringify(part.content).includes('# Graphic Design')
          )
      );
      assert(skillDelivered, 'native Read must deliver materialized packaged skill bytes');
    }
    inputStep++;
  }
  if (resubmitting) {
    if (resubmitCalls === 0) {
      const current = await designOperation(dataRoot, { operation: 'read', sessionId: artworkId });
      const changed = await designOperation(dataRoot, {
        operation: 'save',
        sessionId: artworkId,
        baseRevisionId: current.revisionId,
        content: {
          doc: { ...current.doc, background: { type: 'solid', color: '#778899' } },
          assets: current.assets,
        },
      });
      externalRevision = changed.revisionId;
      content = ['design.pptd', 'pages/design.page'].map((f, i) =>
        tool('Read', { file_path: path.join(draft, 'design-current', f) }, i)
      );
    } else if (resubmitCalls === 1) content = [tool('mcp__molly__molly_resubmit_draft', {}, 0)];
    else content = [{ type: 'text', text: 'SYNTHETIC_RESUBMIT_FINISHED' }];
    resubmitCalls++;
  } else if (editing) {
    if (editCalls === 0) {
      // Extract the trusted frozen prompt path, never invent the artwork location.
      const texts = body.messages
        .flatMap((m) =>
          typeof m.content === 'string'
            ? [m.content]
            : Array.isArray(m.content)
              ? m.content.filter((c) => c.type === 'text').map((c) => c.text)
              : []
        )
        .join('\n');
      draft = texts.match(/Design authoring directory: (.+?)\. Write/)?.[1];
      assert(draft);
      content = ['design.pptd', 'pages/design.page'].map((f, i) =>
        tool('Read', { file_path: path.join(draft, 'design-current', f) }, i)
      );
      content.push(
        tool('Write', { file_path: path.join(draft, 'design.pptd'), content: 'ILLEGAL' }, 2)
      );
    } else if (editCalls === 1) {
      blocked = messages.includes('DESIGN_READ_REQUIRED');
      assert(blocked);
      for (const f of ['design.pptd', 'pages/design.page'])
        sourceFiles.set(f, await readFile(path.join(draft, 'design-current', f), 'utf8'));
      content = [...sourceFiles].map(([f, text], i) =>
        tool(
          'Write',
          { file_path: path.join(draft, f), content: text.replace(/#ffffff/i, '#8899AA') },
          i
        )
      );
    } else content = [{ type: 'text', text: 'SYNTHETIC_DESIGN_FINISHED' }];
    editCalls++;
  }
  console.log(
    'PROVIDER',
    editCalls,
    resubmitCalls,
    content.map((c) => c.name || c.text),
    body.tools?.map((t) => t.name).filter((n) => n.includes('molly'))
  );
  const stopReason = content[0].type === 'tool_use' ? 'tool_use' : 'end_turn';
  const msg = {
    id: `msg_${editCalls}_${resubmitCalls}`,
    type: 'message',
    role: 'assistant',
    model: body.model,
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
  };
  if (body.stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    const send = (type, data) =>
      res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    send('message_start', { message: { ...msg, content: [], stop_reason: null } });
    content.forEach((c, i) => {
      send('content_block_start', {
        index: i,
        content_block: c.type === 'tool_use' ? { ...c, input: {} } : { type: 'text', text: '' },
      });
      send('content_block_delta', {
        index: i,
        delta:
          c.type === 'tool_use'
            ? { type: 'input_json_delta', partial_json: JSON.stringify(c.input) }
            : { type: 'text_delta', text: c.text },
      });
      send('content_block_stop', { index: i });
    });
    send('message_delta', { delta: { stop_reason: stopReason }, usage: { output_tokens: 10 } });
    send('message_stop', {});
    res.end();
  } else {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(msg));
  }
});
provider.listen(0, '127.0.0.1');
await once(provider, 'listening');
const port = provider.address().port;
const h = new ElectronHarness({
  rootDir: root,
  scenarioDir,
  stableId: 'MOLLY-T17',
});
try {
  await h.launch();
  dataRoot = await h.app.evaluate(() => (process.env.MOLLY_DATA_DIR ?? process.env.LODY_DATA_DIR));
  assert(dataRoot);
  const page = h.page;
  await page.addLocatorHandler(
    page.getByRole('button', { name: 'Allow Once', exact: true }).first(),
    async () => {
      permissionRequested = true;
      await page.getByRole('button', { name: 'Allow Once', exact: true }).first().click();
    },
    { noWaitAfter: true }
  );
  const onboarding = new OnboardingPage(page);
  await onboarding.waitForLocalBootstrap();
  await onboarding.skipConfigurationAndEnterProduct();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Agents', exact: true }).click();
  await page
    .getByRole('button', { name: /^(Add provider|添加 Provider)$/ })
    .first()
    .click();
  await page.getByRole('option', { name: 'Claude', exact: true }).click();
  await page.locator('#agent-config-name').fill('Synthetic Claude');
  await page.locator('#builtin-runtime-path').fill(claude);
  await page.getByRole('button', { name: 'Environment variables', exact: true }).click();
  await page
    .locator('textarea')
    .last()
    .fill(
      `ANTHROPIC_API_KEY=synthetic-only\nANTHROPIC_BASE_URL=http://127.0.0.1:${port}\nCLAUDE_CONFIG_DIR=${root}/claude-config\nCLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`
    );
  await page.getByRole('button', { name: /^(Create|创建)$/ }).click();
  await expect(page.getByText('Synthetic Claude', { exact: true }).first()).toBeVisible({
    timeout: 60000,
  });
  await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  if (await page.getByRole('button', { name: 'Close', exact: true }).count())
    await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  await expect(page.getByRole('button', { name: 'Close', exact: true })).toHaveCount(0);
  await writeFile(
    path.join(scenarioDir, 'permission-controls.txt'),
    await page.locator('body').ariaSnapshot()
  );
  await page.getByRole('button', { name: 'Permission', exact: true }).click();
  await writeFile(
    path.join(scenarioDir, 'permission-menu.txt'),
    await page.locator('body').ariaSnapshot()
  );
  await page.getByRole('menuitem', { name: /^Manual/ }).click();
  await page.locator('input[type="file"]').setInputFiles(referencePath);
  await page.locator('#chat-prompt').fill('SYNTHETIC_INITIAL');
  await page.getByRole('button', { name: /^(Send|发送)$/ }).click();
  await expect(page.locator('p').filter({ hasText: 'SYNTHETIC_INITIAL_FINISHED' })).toBeVisible({
    timeout: 120000,
  });
  console.log(
    'SENT_IMAGES',
    await page
      .locator('img')
      .evaluateAll((images) =>
        images.map((img) => ({
          alt: img.alt,
          src: img.src,
          complete: img.complete,
          naturalWidth: img.naturalWidth,
        }))
      )
  );
  const sentReference = page.getByRole('img', { name: /synthetic-reference\.png$/ });
  await expect(sentReference).toBeVisible();
  await expect
    .poll(() => sentReference.evaluate((img) => img.complete && img.naturalWidth > 0))
    .toBe(true);
  console.log('SENT_REFERENCE_RENDERED');
  console.log('INITIAL', page.url());
  const id = page.url().match(/sessions\/([^/?#]+)/)?.[1];
  assert(id);
  artworkId = id;
  await expect
    .poll(
      async () =>
        h.app.evaluate(async ({ BrowserWindow }) => {
          const owner = BrowserWindow.getAllWindows().find((w) =>
            w.webContents.getURL().includes('#/local/')
          );
          const view = owner.contentView.children.find((v) =>
            v.webContents?.getURL().includes('design')
          );
          return view
            ? await view.webContents.executeJavaScript('window.molly?.state().readonly')
            : true;
        }),
      { timeout: 60000 }
    )
    .toBe(false);
  await h.app.evaluate(async ({ BrowserWindow }) => {
    const owner = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes('#/local/')
    );
    const views = owner.contentView.children;
    const view = views.find((v) => v.webContents?.getURL().includes('design'));
    if (!view) throw Error('No Bento view');
    await view.webContents.executeJavaScript(
      `document.querySelector('[data-c2a-kind="shape"]').click()`
    );
  });
  await page.evaluate(async (id) => window.ipc.invoke('design.save', id), id);
  const edited = await page.evaluate(async (id) => window.ipc.invoke('design.read', id), id);
  assert(edited.doc.elements.length > 0);
  console.log('SAVED', edited.revisionId);
  await page.getByRole('combobox').fill('SYNTHETIC_EDIT');
  await page.getByRole('button', { name: /^(Send|发送)$/ }).click();
  await expect(page.locator('p').filter({ hasText: 'SYNTHETIC_DESIGN_FINISHED' })).toBeVisible({
    timeout: 120000,
  });
  await expect
    .poll(
      async () => {
        const saved = await page.evaluate(async (id) => window.ipc.invoke('design.read', id), id);
        return saved.revisionId;
      },
      { timeout: 60000 }
    )
    .not.toBe(edited.revisionId);
  const final = await page.evaluate(async (id) => window.ipc.invoke('design.read', id), id);
  assert.equal(final.doc.elements.length, edited.doc.elements.length);
  assert(blocked);
  assert.equal(final.doc.background.color, '#8899AA');
  await expect
    .poll(
      async () =>
        h.app.evaluate(async ({ BrowserWindow }) => {
          const owner = BrowserWindow.getAllWindows().find((w) =>
            w.webContents.getURL().includes('#/local/')
          );
          const view = owner.contentView.children.find((v) =>
            v.webContents?.getURL().includes('design')
          );
          return view
            ? await view.webContents.executeJavaScript('window.molly?.state().readonly')
            : true;
        }),
      { timeout: 60000 }
    )
    .toBe(false);
  if (resubmitMode) {
    const originalDraft = await readDesignArtifactDigest(draft);
    assert.equal(originalDraft.status, 'present');
    await page.getByRole('combobox').fill('SYNTHETIC_RESUBMIT');
    await page.getByRole('button', { name: /^(Send|发送)$/ }).click();
    await expect(page.locator('p').filter({ hasText: 'SYNTHETIC_RESUBMIT_FINISHED' })).toBeVisible({
      timeout: 120000,
    });
    await expect
      .poll(
        async () => {
          const saved = await page.evaluate(async (id) => window.ipc.invoke('design.read', id), id);
          return saved.doc.background.color;
        },
        { timeout: 60000 }
      )
      .toBe('#8899AA');
    await expect
      .poll(
        async () =>
          h.app.evaluate(async ({ BrowserWindow }) => {
            const owner = BrowserWindow.getAllWindows().find((w) =>
              w.webContents.getURL().includes('#/local/')
            );
            const view = owner.contentView.children.find((v) =>
              v.webContents?.getURL().includes('design')
            );
            return view
              ? await view.webContents.executeJavaScript('window.molly?.state().readonly')
              : true;
          }),
        { timeout: 60000 }
      )
      .toBe(false);
    const retained = await page.evaluate(async (id) => window.ipc.invoke('design.read', id), id);
    assert.equal(retained.revisionId, final.revisionId);
    assert.notEqual(retained.revisionId, externalRevision);
    assert.deepEqual(await readDesignArtifactDigest(draft), originalDraft);
    assert.equal(retained.doc.elements.length, edited.doc.elements.length);
  }
  const canvasImage = await h.app.evaluate(async ({ BrowserWindow }) => {
    const owner = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes('#/local/')
    );
    const view = owner.contentView.children.find((v) => v.webContents?.getURL().includes('design'));
    return (await view.webContents.capturePage()).toDataURL();
  });
  await writeFile(
    path.join(scenarioDir, 'canvas.png'),
    Buffer.from(canvasImage.split(',')[1], 'base64')
  );

  await page.screenshot({ path: path.join(scenarioDir, 'committed.png') });
  assert(
    referenceDelivered && skillDelivered,
    'native reference and skill delivery must both complete'
  );
  await cp(path.join(dataRoot, 'logs'), path.join(scenarioDir, 'cli-logs'), { recursive: true });
  h.writeDiagnostics();
  console.log(
    JSON.stringify({
      status: 'passed',
      permissionRequested,
      referenceDelivered,
      skillDelivered,
      deliveredSkillPath,
      nativeToolNames,
      boundary:
        'Electron IPC/MessageHandler/Session actual Claude ACP runtime natural finalization',
      editCalls,
      resubmitCalls,
      externalRevision,
      blocked,
      finalRevision: final.revisionId,
      elementCount: final.doc.elements.length,
      root,
    })
  );
} catch (error) {
  console.error('PROBE ERROR', error);
  const ownData = await h.app
    ?.evaluate(({ app }) => app.getPath('userData'))
    .catch(() => undefined);
  if (ownData)
    await cp(
      path.join(path.dirname(ownData), 'lody-data', 'logs'),
      path.join(scenarioDir, 'cli-logs'),
      { recursive: true }
    ).catch(() => {});
  await writeFile(
    path.join(scenarioDir, 'cli-backlog.json'),
    JSON.stringify(await h.captureCliBacklog())
  );
  await writeFile(
    path.join(scenarioDir, 'body.txt'),
    (await h.page?.locator('body').innerText()) ?? ''
  );
  await writeFile(path.join(scenarioDir, 'logs.json'), JSON.stringify(h.logs));
  console.error('ARTIFACTS', root);
  throw error;
} finally {
  provider.close();
  await h.close();
}
