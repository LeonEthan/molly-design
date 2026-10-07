#!/usr/bin/env node
// Explicitly invoked live-model design eval. Never part of deterministic CI.
import { register } from 'tsx/esm/api';
register();
const { ElectronHarness } = await import('../src/support/electron-harness.ts');
const { OnboardingPage } = await import('../src/support/pages/onboarding-page.ts');
const { readDesignEvalTurnIds, readDesignEvalTurn, requireCommittedDesignEvalTurn } =
  await import('../src/support/design-eval-receipts.ts');
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { expect } from '@playwright/test';
import { checkDesignGate, readCase } from './design-eval-gate.mjs';
import {
  prepareDesignEvalBrowser,
  validateBrowserSelection,
  verifyResearchBrowser,
} from './design-eval-browser.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const privateRoot = join(root, 'e2e/design-eval/private');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const { values } = parseArgs({
  options: {
    case: { type: 'string', multiple: true },
    label: { type: 'string' },
    runs: { type: 'string', default: '3' },
    concurrency: { type: 'string', default: '1' },
    'timeout-ms': { type: 'string', default: '2700000' },
    'first-turn-only': { type: 'boolean', default: false },
  },
});
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const runs = Number(values.runs);
const concurrency = Number(values.concurrency);
const timeout = Number(values['timeout-ms']);
if (
  !values.case?.length ||
  !/^[a-z0-9][a-z0-9.-]{0,79}$/.test(values.label ?? '') ||
  ![runs, concurrency, timeout].every(positive)
)
  throw Error(
    'usage: node e2e/scripts/run-design-eval.mjs --case <case.json> [--case ...] --label <version-label> [--runs 3] [--concurrency 1] [--timeout-ms 2700000] [--first-turn-only]'
  );

const cases = [];
for (const file of values.case) {
  const caseFile = resolve(file);
  const evalCase = await readCase(caseFile);
  const source = resolve(dirname(caseFile), evalCase.input.source);
  if (sha(await readFile(source)) !== evalCase.input.sha256)
    throw Error(`${evalCase.id}: case source does not match its recorded SHA-256`);
  const directory = join(privateRoot, 'runs', values.label, evalCase.id);
  await mkdir(directory, { recursive: true });
  cases.push({ evalCase, source, directory });
}
const connection = JSON.parse(await readFile(join(privateRoot, 'connection.json'), 'utf8'));
const browserSelection = validateBrowserSelection(connection.browser);

const sourceIdentity = {
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  dirty:
    execFileSync('git', ['status', '--porcelain', '--', ':!e2e/design-eval/private'], {
      cwd: root,
      encoding: 'utf8',
    }).trim() !== '',
  buildHashes: {},
};
for (const rel of [
  'apps/electron/out/main/index.js',
  'apps/electron/resources/cli/index.js',
  'apps/electron/resources/design/build.json',
])
  sourceIdentity.buildHashes[rel] = sha(await readFile(join(root, rel)));
const rendererEntry = 'apps/electron/out/renderer/index.html';
const rendererHtml = await readFile(join(root, rendererEntry));
sourceIdentity.buildHashes[rendererEntry] = sha(rendererHtml);
for (const asset of rendererHtml
  .toString()
  .matchAll(/(?:src|href)="\.\/assets\/([^"]+\.(?:js|css))"/g)) {
  const rel = `apps/electron/out/renderer/assets/${asset[1]}`;
  sourceIdentity.buildHashes[rel] = sha(await readFile(join(root, rel)));
}

const ipc = (page, method, ...args) =>
  page.evaluate(`window.ipc.invoke(${JSON.stringify(method)}, ...${JSON.stringify(args)})`);

async function configureConnections(page) {
  const { model, image } = connection;
  await ipc(page, 'modelConnections.save', {
    providerPresetId: 'openai-compatible',
    displayName: 'Design eval',
    baseUrl: model.baseUrl,
    enabled: true,
    apiKey: model.apiKey,
    customModels: [
      {
        modelId: model.modelId,
        name: model.modelId,
        input: ['text', 'image'],
        contextWindow: 400_000,
        maxTokens: 128_000,
        thinking: [...new Set(['off', model.reasoning])],
        toolCalls: true,
        usageInStreaming: true,
        maxTokensField: 'max_completion_tokens',
      },
    ],
  });
  await ipc(page, 'modelConnections.saveImage', {
    enabled: true,
    protocol: 'openai-images',
    baseUrl: image.baseUrl,
    model: image.model,
    apiKey: image.apiKey,
  });
}

async function selectRunConfiguration(page, row, choice) {
  const trigger = page.getByRole('button', { name: 'Provider and model', exact: true });
  await expect
    .poll(
      async () => {
        await page.keyboard.press('Escape');
        await trigger.click();
        await page.getByRole('menuitem', { name: new RegExp(`^${row}`) }).click();
        const option = page.getByRole('menuitemradio', { name: choice });
        if (!(await option.first().isVisible())) return false;
        if ((await option.first().getAttribute('aria-checked')) === 'true') return true;
        await option
          .first()
          .click({ timeout: 5_000 })
          .catch(() => {});
        return false;
      },
      { message: `Select ${row} ${choice}`, timeout: 120_000 }
    )
    .toBe(true);
  await page.keyboard.press('Escape');
}

const stopButton = (page) => page.getByRole('button', { name: 'Stop', exact: true });

async function send(page, prompt, attachment) {
  if (attachment) await page.locator('input[type=file]').setInputFiles(attachment);
  await page.locator('textarea[data-slot="mention-input"]').fill(prompt);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(stopButton(page)).toBeVisible({ timeout: 120_000 });
}

async function receipts(workdir) {
  const input = join(workdir, 'design-input');
  const found = [];
  for (const turn of await readdir(input)) {
    try {
      found.push(JSON.parse(await readFile(join(input, turn, 'receipt.json'), 'utf8')));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return found;
}

async function exportPng(h, artworkId, destination) {
  await h.app.evaluate(({ dialog }, file) => {
    globalThis.designEvalSaveDialog = dialog.showSaveDialog;
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, destination);
  try {
    await ipc(h.page, 'design.export', artworkId, 'png', 'Design eval');
  } finally {
    await h.app.evaluate(({ dialog }) => {
      dialog.showSaveDialog = globalThis.designEvalSaveDialog;
      delete globalThis.designEvalSaveDialog;
    });
  }
}

async function nextRunDirectory(caseDirectory) {
  for (let index = 1; ; index += 1) {
    const directory = join(caseDirectory, `run-${index}`);
    try {
      await mkdir(directory); // exclusive; a retained run is never overwritten
      return directory;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
}

let browserPreparation = Promise.resolve();

async function runOnce({ evalCase, source, directory: caseDirectory }) {
  const directory = await nextRunDirectory(caseDirectory);
  const name = `${evalCase.id}/${directory.split('/').at(-1)}`;
  const inputFile = `input${extname(source)}`;
  const followUps = values['first-turn-only'] ? [] : (evalCase.followUps ?? []);
  const report = {
    case: evalCase.id,
    label: values.label,
    source: sourceIdentity,
    model: { modelId: connection.model.modelId, reasoning: connection.model.reasoning },
    imageModel: connection.image.model,
    prompt: evalCase.prompt,
    followUps,
    caseSnapshot: {
      ...evalCase,
      input: { ...evalCase.input, source: inputFile },
      followUps,
    },
    startedAt: new Date().toISOString(),
    turns: [],
    gate: { status: 'pending' },
    ownerReview: 'pending',
    browser: { status: 'pending', source: browserSelection },
  };
  const persist = () => writeFile(join(directory, 'run.json'), JSON.stringify(report, null, 2));
  const h = new ElectronHarness({
    rootDir: directory,
    scenarioDir: directory,
    stableId: 'design-eval',
  });
  let dataRoot;
  try {
    const sourceBytes = await readFile(source);
    if (sha(sourceBytes) !== evalCase.input.sha256)
      throw Error(`${evalCase.id}: case source changed before this attempt`);
    const attachment = join(directory, inputFile);
    await writeFile(attachment, sourceBytes);
    await persist();
    await h.launch();
    const page = h.page;
    const onboarding = new OnboardingPage(page);
    await onboarding.waitForLocalBootstrap();
    await onboarding.skipConfigurationAndEnterProduct();
    await configureConnections(page);
    await selectRunConfiguration(page, 'Model', connection.model.modelId);
    await selectRunConfiguration(page, 'Reasoning', new RegExp(connection.model.reasoning, 'i'));
    report.runConfiguration = await page
      .getByRole('button', { name: 'Provider and model', exact: true })
      .innerText();
    await persist();
    console.log(`${name} configured: ${report.runConfiguration.replace(/\s+/g, ' ')}`);

    dataRoot = await h.app.evaluate(() => process.env.MOLLY_DATA_DIR);
    const preparation = browserPreparation.then(() =>
      prepareDesignEvalBrowser({
        invoke: (method, ...args) => ipc(page, method, ...args),
        selection: browserSelection,
        verify: (site) =>
          verifyResearchBrowser({
            h,
            invoke: (method, ...args) => ipc(page, method, ...args),
            site,
            directory,
          }),
      })
    );
    browserPreparation = preparation.catch(() => {});
    report.browser = await preparation;
    report.browser.verifiedAt = new Date().toISOString();
    await persist();
    console.log(`${name} browser imported and research page verified`);
    for (const [index, prompt] of [evalCase.prompt, ...report.followUps].entries()) {
      const previousTurnIds = report.artworkId
        ? await readDesignEvalTurnIds(join(dataRoot, 'chats', report.artworkId))
        : [];
      const startedAt = Date.now();
      await send(page, prompt, index === 0 ? attachment : undefined);
      if (index === 0) {
        await expect(page).toHaveURL(/#\/local\/sessions\/[^/?#]+(?:\?.*)?$/);
        report.artworkId = decodeURIComponent(page.url().split('/sessions/')[1].split(/[?#]/)[0]);
      }
      report.activeTurn = { index, startedAt: new Date(startedAt).toISOString() };
      await persist();
      console.log(`${name} turn ${index} running in ${report.artworkId}`);
      await expect(stopButton(page)).toBeHidden({ timeout });
      if (await page.getByText('Agent internal error', { exact: true }).count())
        throw Error(`agent_internal_error in turn ${index}`);
      const workdir = join(dataRoot, 'chats', report.artworkId);
      let turn;
      await expect
        .poll(
          async () => {
            turn = await readDesignEvalTurn(workdir, previousTurnIds);
            return !!turn;
          },
          { timeout: 60_000 }
        )
        .toBe(true);
      if (!turn) throw Error('Design turn receipt was not observed');
      report.receipts ??= [];
      report.receipts.push(turn.receipt);
      await persist();
      const receipt = requireCommittedDesignEvalTurn(turn, report.artworkId, prompt);
      const design = await ipc(page, 'design.read', report.artworkId);
      if (design.revisionId !== receipt.revisionId)
        throw Error('Current design revision does not match the committed turn receipt');
      delete report.activeTurn;
      report.turns.push({
        prompt,
        turnId: receipt.turnId,
        revisionId: receipt.revisionId,
        durationMs: Date.now() - startedAt,
      });
      await persist();
      console.log(
        `${name} turn ${index} committed after ${Math.round((Date.now() - startedAt) / 1000)}s`
      );
      const turnDirectory = index === 0 ? directory : join(directory, `follow-up-${index}`);
      await mkdir(turnDirectory, { recursive: true });
      await writeFile(join(turnDirectory, 'design.json'), JSON.stringify(design, null, 2));
      await exportPng(h, report.artworkId, join(turnDirectory, 'preview.png'));
      if (index === 0) report.gate = checkDesignGate(evalCase.gate, design.doc);
    }
    const workdir = join(dataRoot, 'chats', report.artworkId);
    report.receipts = await receipts(workdir);
    await cp(workdir, join(directory, 'workdir'), { recursive: true });
    await writeFile(join(directory, 'conversation.txt'), await page.locator('body').innerText());
    report.overall = 'completed';
  } catch (error) {
    report.overall = 'failed';
    if (report.browser.status === 'pending') report.browser.status = 'failed';
    report.error = String(error);
    process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString();
    if (h.page && !h.page.isClosed()) {
      await h.page.screenshot({ path: join(directory, 'last-desktop.png') }).catch(() => {});
      if (report.overall === 'failed')
        await writeFile(
          join(directory, 'conversation.txt'),
          await h.page.locator('body').innerText()
        ).catch(() => {});
      const backlog = await h.captureCliBacklog().catch(() => null);
      await writeFile(join(directory, 'cli-backlog.json'), JSON.stringify(backlog, null, 2));
    }
    if (dataRoot) {
      await cp(join(dataRoot, 'logs'), join(directory, 'logs'), { recursive: true }).catch(
        () => {}
      );
      await cp(join(dataRoot, 'harness/pi/sessions'), join(directory, 'pi-sessions'), {
        recursive: true,
      }).catch(() => {});
    }
    await h.close().catch((error) => {
      report.teardownError = String(error);
      process.exitCode = 1;
    });
    await persist();
    console.log(`${name} → ${report.overall}`);
  }
}

const jobs = cases.flatMap((entry) => Array.from({ length: runs }, () => entry));
const worker = async () => {
  for (let job = jobs.shift(); job; job = jobs.shift()) await runOnce(job);
};
await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
