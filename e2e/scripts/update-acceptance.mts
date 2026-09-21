/**
 * Molly Design in-app update acceptance (Issue #32, testing decisions).
 *
 * Drives the two-version rig prepared by
 * apps/electron/scripts/verify-sparkle-update.mjs --prepare-only through a real
 * install-and-reopen update against an isolated, loopback-only Sparkle feed.
 *
 * Lanes (run separately; each is one immutable round):
 *   positive           A(0.1.0) creates artwork/attachment/settings/session,
 *                      proves the install gate refuses a running Agent, then
 *                      installs B(0.1.1) and verifies everything survives.
 *   bad-signature      an appcast signed by a rogue key must be rejected.
 *   download-failure   a missing enclosure must fail recoverably; retry works.
 *   tampered-plist     a bundle whose Info.plist points at a foreign feed must
 *                      disable its updater instead of following it.
 *
 * Evidence lands in e2e/artifacts/acceptance/update-<lane>-<ts>/ (ignored).
 * Nothing here touches the user's real profile: every launch gets its own
 * MOLLY_DATA_DIR, Electron user-data dir, CLI endpoint and onboarding state.
 */
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createIsolatedEnvironment } from '../src/support/electron-harness.js';
import { reserveTcpPort } from '../src/support/world-utils.js';
import { OnboardingPage } from '../src/support/pages/onboarding-page.js';
import { SessionPage } from '../src/support/pages/session-page.js';
import {
  WorkSessionFixture,
  type ScriptedRuntimeEvent,
} from '../src/support/fixtures/work-session-fixture.js';

const e2eDir = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = resolve(e2eDir, '..');
const launchJsonPath = join(
  repoRoot,
  'apps/electron/.sparkle-local/update-flow/launch.json'
);
type Rig = {
  feedUrl: string;
  oldApp: string;
  oldBinary: string;
  newApp: string;
  archiveDir: string;
  oldVersion: string;
  newVersion: string;
  publicEdKey: string;
};
const rig = JSON.parse(readFileSync(launchJsonPath, 'utf8')) as Rig;

const lane = process.argv[2] ?? 'positive';
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const evidenceDir = join(e2eDir, 'artifacts', 'acceptance', `update-${lane}-${stamp}`);
mkdirSync(evidenceDir, { recursive: true });

type Checkpoint = { name: string; ok: boolean; detail?: unknown };
const checkpoints: Checkpoint[] = [];
function record(name: string, ok: boolean, detail?: unknown): void {
  checkpoints.push({ name, ok, detail });
  console.log(`[${ok ? 'pass' : 'FAIL'}] ${name}${detail ? ` — ${JSON.stringify(detail)}` : ''}`);
  if (!ok) throw new Error(`checkpoint failed: ${name}`);
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

const MANIFEST_EXCLUDES = /(?:^|\/)(?:Cache|GPUCache|Code Cache|DawnGraphiteCache|DawnWebGPUCache|logs?|Crashpad)(?:\/|$)|\.log$|SingletonLock|lockfile/u;
function buildManifest(root: string): Record<string, { size: number; sha256: string }> {
  const manifest: Record<string, { size: number; sha256: string }> = {};
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const rel = relative(root, full);
      if (MANIFEST_EXCLUDES.test(rel)) continue;
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) manifest[rel] = { size: statSync(full).size, sha256: sha256File(full) };
    }
  };
  walk(root);
  return manifest;
}

async function startFeedServer(port: number): Promise<Server> {
  const server = createServer((request, response) => {
    const urlPath = decodeURIComponent((request.url ?? '/').split('?')[0] ?? '/');
    const filePath = join(rig.archiveDir, urlPath === '/' ? 'appcast.xml' : urlPath.slice(1));
    if (!filePath.startsWith(rig.archiveDir) || !existsSync(filePath)) {
      console.log(`[feed] 404 ${urlPath}`);
      response.writeHead(404);
      response.end('not found');
      return;
    }
    const body = readFileSync(filePath);
    console.log(`[feed] 200 ${urlPath} (${body.length}B)`);
    response.writeHead(200, {
      'Content-Type': filePath.endsWith('.xml') ? 'application/xml' : 'application/octet-stream',
      // Sparkle downloads through NSURLSession, whose shared cache lives in the
      // real ~/Library/Caches/dev.molly-design.app; a stale cached appcast or zip must
      // never satisfy a later lane (the rogue-signature lane reuses the URLs).
      'Cache-Control': 'no-store',
      'Content-Length': body.length,
    });
    response.end(body);
  });
  return await new Promise<Server>((resolveServer) => {
    server.listen(port, '127.0.0.1', () => resolveServer(server));
  });
}

type IsolatedDirs = { dataDir: string; userDataDir: string };
function makeIsolatedDirs(label: string): IsolatedDirs {
  // macOS Unix sockets cap at ~104 chars; the daemon nests run/*.sock under the
  // data dir, so keep the base short (/tmp, not the deep per-user tmpdir).
  const root = mkdtempSync(join('/tmp', `gup-${label}-`));
  return { dataDir: join(root, 'data'), userDataDir: join(root, 'ud') };
}

/**
 * Copy the rig's pristine old app into a per-lane scratch location. Sparkle
 * installs by replacing the .app in place; lanes must never mutate the rig,
 * or the next lane (and any rerun) would start from an already-updated bundle.
 */
function prepareScratchApp(label: string): { scratchApp: string; scratchBinary: string } {
  const root = mkdtempSync(join('/tmp', `gapp-${label}-`));
  const scratchApp = join(root, 'Molly Design.app');
  const result = spawnSync('ditto', [rig.oldApp, scratchApp]);
  if (result.status !== 0) throw new Error(`failed to copy scratch app: ${result.stderr}`);
  return { scratchApp, scratchBinary: join(scratchApp, 'Contents', 'MacOS', 'Molly Design') };
}

// Sparkle persists check state in NSUserDefaults keyed by CFBundleIdentifier,
// and macOS resolves that domain through the passwd home, not $HOME or the
// Electron user-data dir. requireSparkle pins the bundle id to dev.molly-design.app,
// so these keys land in the real ~/Library/Preferences/dev.molly-design.app.plist no
// matter how the launch is isolated. They are created by the test app itself
// (no real Molly Design install exists); reset them before each lane so launch-time
// behavior is deterministic, and again at exit so no residue survives.
const SPARKLE_DEFAULTS_DOMAIN = 'dev.molly-design.app';
const SPARKLE_DEFAULTS_KEYS = [
  'SUEnableAutomaticChecks',
  'SUHasLaunchedBefore',
  'SULastCheckTime',
  'SUUpdateGroupIdentifier',
];
function resetSparkleDefaultsState(): void {
  for (const key of SPARKLE_DEFAULTS_KEYS) {
    spawnSync('defaults', ['delete', SPARKLE_DEFAULTS_DOMAIN, key]);
  }
}

async function launchMolly(
  binary: string,
  dirs: IsolatedDirs,
  options: { forceOnboarding: boolean; logName: string }
): Promise<{ app: ElectronApplication; page: Page; hostPort: number }> {
  const hostPort = await reserveTcpPort();
  const env = createIsolatedEnvironment({
    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8',
    MOLLY_DATA_DIR: dirs.dataDir,
    MOLLY_E2E: '1',
    MOLLY_E2E_LOCAL_CLI_HOST_PORT: String(hostPort),
    MOLLY_ELECTRON_DISABLE_SHELL_ENV: '1',
    MOLLY_ELECTRON_DISABLE_SYSTEM_PROXY_ENV: '1',
    ...(options.forceOnboarding ? { MOLLY_ELECTRON_FORCE_ONBOARDING: '1' } : {}),
    MOLLY_ELECTRON_USER_DATA_DIR: dirs.userDataDir,
    NODE_ENV: 'test',
    SPARKLE_APPCAST_URL: rig.feedUrl,
  });
  const app = await electron.launch({
    args: [`--user-data-dir=${dirs.userDataDir}`, '--lang=en-US'],
    cwd: dirname(binary),
    env,
    executablePath: binary,
    timeout: 60_000,
  });
  // The native bridge's NSLog lines (check results, install errors) reach
  // stderr; keep the full main-process output as lane evidence.
  const logStream = createWriteStream(join(evidenceDir, `${options.logName}.log`));
  app.process().stdout?.on('data', (chunk: Buffer) => logStream.write(chunk));
  app.process().stderr?.on('data', (chunk: Buffer) => logStream.write(chunk));
  const page = await app.firstWindow();
  return { app, page, hostPort };
}

async function enterProduct(page: Page): Promise<void> {
  const onboarding = new OnboardingPage(page);
  await onboarding.waitForLocalBootstrap();
  await onboarding.skipConfigurationAndEnterProduct();
}

/**
 * Run JavaScript inside the design canvas WebContentsView via the main process.
 * A session window can host several editor.html views (canonical editor,
 * read-only previews); only the canonical one reports `molly.state().ready`
 * while editable, so select by the product state API instead of DOM order.
 */
async function canvasEval<T>(
  app: ElectronApplication,
  js: string,
  options: { editable?: boolean } = {}
): Promise<T> {
  return (await app.evaluate(
    async ({ BrowserWindow, WebContentsView }, { source, needEditable }) => {
      const win = BrowserWindow.getAllWindows().find((candidate) =>
        candidate.webContents.getURL().includes('#/local/sessions/')
      );
      if (!win) throw new Error('main session window not found');
      const views = win.contentView.children.filter(
        (child): child is InstanceType<typeof WebContentsView> =>
          child instanceof WebContentsView && child.webContents.getURL().includes('editor.html')
      );
      const probes: Array<{ url: string; state: unknown }> = [];
      type CanvasProbe = { ready?: boolean; readonly?: boolean } | null;
      for (const view of views) {
        let state: CanvasProbe = null;
        try {
          state = (await view.webContents.executeJavaScript(
            'window.molly?.state?.() ?? null'
          )) as CanvasProbe;
        } catch {
          // View still navigating; treat as not ready.
        }
        probes.push({ url: view.webContents.getURL(), state });
        if (state?.ready === true && (!needEditable || state.readonly === false)) {
          return await view.webContents.executeJavaScript(source);
        }
      }
      throw new Error(`canonical canvas view not ready: ${JSON.stringify(probes)}`);
    },
    { source: js, needEditable: options.editable === true }
  )) as T;
}

async function waitCanvasReady(
  app: ElectronApplication,
  options: { editable?: boolean } = {}
): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          return await canvasEval<boolean>(
            app,
            `Boolean(window.bento?.doc && document.querySelector('[data-c2a-kind="text"]'))`,
            options
          );
        } catch {
          return false;
        }
      },
      { timeout: 60_000, intervals: [250, 500, 1000] }
    )
    .toBe(true);
}

async function canvasSnapshot(app: ElectronApplication): Promise<string> {
  return await canvasEval<string>(app, `window.bento.visual.snapshot()`, { editable: true });
}

type UpdaterState = {
  phase: string;
  currentVersion: string;
  availableVersion?: string;
  downloadedVersion?: string;
  disabledReason?: string;
  error?: string;
};
async function updaterState(page: Page): Promise<UpdaterState> {
  return (await page.evaluate(async () => await window.ipc.invoke('updater.getState'))) as UpdaterState;
}

async function openAbout(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog').filter({
    has: page.getByRole('navigation', { name: /^(Settings|设置)$/u }),
  });
  await expect(settings).toBeVisible();
  await settings.getByRole('button', { name: /^(About|关于)$/u, exact: true }).click();
  // With automatic checks enabled the package may already have downloaded the
  // update before the panel opens, so either action button may be showing.
  // When the updater is disabled the action button is hidden; the version row
  // is enough proof the About pane is open.
  await expect(
    settings
      .getByRole('button', { name: /^(Check for Updates|检查更新|Update & Restart|更新并重启)$/u })
      .first()
      .or(settings.getByText(/^(Version|版本)/u).first())
  ).toBeVisible({ timeout: 30_000 });
}

/** Click "Check for Updates" only when the phase still offers that button. */
async function clickCheckForUpdates(page: Page): Promise<void> {
  const phase = (await updaterState(page)).phase;
  if (phase === 'downloaded') return;
  await page.getByRole('button', { name: /^(Check for Updates|检查更新)$/u }).click();
}

async function closeSettings(page: Page): Promise<void> {
  const settings = page.getByRole('dialog').filter({
    has: page.getByRole('navigation', { name: /^(Settings|设置)$/u }),
  });
  // Escape may first close an inner popover (e.g. the theme PreviewSelect);
  // press until the dialog itself is gone.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.keyboard.press('Escape');
    try {
      await expect(settings).toBeHidden({ timeout: 2_000 });
      return;
    } catch {
      // popover consumed the escape; press again
    }
  }
  await expect(settings).toBeHidden({ timeout: 5_000 });
}

async function safeClose(app?: ElectronApplication): Promise<void> {
  if (!app) return;
  try {
    if (app.process().exitCode === null) await app.close();
  } catch {
    // Already exited or disconnected (Sparkle-driven quit/relaunch).
  }
}

async function waitForPhase(page: Page, phases: string[], timeoutMs = 120_000): Promise<UpdaterState> {
  let state: UpdaterState | undefined;
  try {
    await expect
      .poll(
        async () => {
          state = await updaterState(page);
          return phases.includes(state.phase);
        },
        { timeout: timeoutMs, intervals: [250, 500, 1000, 2000] }
      )
      .toBe(true);
  } catch (error) {
    throw new Error(
      `updater phase never reached [${phases.join(', ')}]; last state: ${JSON.stringify(state)}`,
      { cause: error }
    );
  }
  return state!;
}

async function screenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(evidenceDir, `${name}.png`) });
}

function plistValue(appPath: string, key: string): string {
  return execFileSync(
    '/usr/bin/plutil',
    ['-extract', key, 'raw', '-o', '-', join(appPath, 'Contents', 'Info.plist')],
    { encoding: 'utf8' }
  ).trim();
}

async function sendInSession(page: Page, text: string): Promise<void> {
  // The session-route composer has no #chat-prompt id; it is the visible textarea.
  const box = page.locator('textarea:visible').last();
  await box.click();
  await box.fill(text);
  await page.getByRole('button', { name: /^(Send|发送)$/u }).click();
}

async function followUpAndWaitEnd(
  page: Page,
  fixture: WorkSessionFixture,
  text: string
): Promise<void> {
  const priorCount = fixture
    .readEvents()
    .filter((event) => event.event === 'request-complete' && event.mode === 'reply').length;
  await sendInSession(page, text);
  await fixture.waitForEvent('request-complete', priorCount + 1);
}

/** The attachment name may live in text, title, alt or aria-label (thumbnail chips). */
async function domMentions(page: Page, name: string): Promise<boolean> {
  return await page.evaluate((needle) => {
    const attrText = [...document.querySelectorAll('[title], [alt], [aria-label]')]
      .flatMap((element) => [
        element.getAttribute('title') ?? '',
        element.getAttribute('alt') ?? '',
        element.getAttribute('aria-label') ?? '',
      ])
      .join(' ');
    return (document.body.textContent ?? '').includes(needle) || attrText.includes(needle);
  }, name);
}

async function holdInSession(
  page: Page,
  fixture: WorkSessionFixture,
  text: string
): Promise<ScriptedRuntimeEvent> {
  await sendInSession(page, text);
  await expect(page.getByRole('button', { name: /^(Stop|停止)$/u })).toBeVisible({
    timeout: 60_000,
  });
  const events = await fixture.waitForEvent('request-start');
  const waiting = [...events].reverse().find((event) => event.mode === 'hold');
  if (!waiting) throw new Error('scripted model server did not observe the held follow-up');
  return waiting;
}

async function releaseHeldSession(
  page: Page,
  fixture: WorkSessionFixture,
  waiting: ScriptedRuntimeEvent
): Promise<void> {
  await page.getByRole('button', { name: /^(Stop|停止)$/u }).click();
  // Stopping the turn aborts the engine's fetch; the scripted server observes
  // the response stream closing as the honest teardown signal.
  await expect
    .poll(
      () =>
        fixture
          .readEvents()
          .some(
            (entry) => entry.event === 'request-cancelled' && entry.requestId === waiting.requestId
          ),
      { timeout: 30_000, intervals: [50, 100, 250, 500] }
    )
    .toBe(true);
  await expect(page.getByRole('button', { name: /^(Stop|停止)$/u })).toBeHidden({
    timeout: 30_000,
  });
}

async function positiveLane(): Promise<void> {
  const fixture = await WorkSessionFixture.create();
  const attachmentName = 'update-acceptance-reference.png';
  const dirs = makeIsolatedDirs('positive');
  resetSparkleDefaultsState();
  const { scratchApp, scratchBinary } = prepareScratchApp('positive');
  const { app, page } = await launchMolly(scratchBinary, dirs, {
    forceOnboarding: true,
    logName: 'app-old',
  });
  let sessionId = '';
  try {
    await enterProduct(page);
    record('bootstrap-onboarding', true);

    const session = new SessionPage(page, fixture);
    await fixture.startModelServer();
    await session.seedDeterministicModelConnection();
    record('scripted-model-configured', true);

    await openAbout(page);
    const initial = await updaterState(page);
    record('old-version-is-0.1.0', initial.currentVersion === rig.oldVersion, initial);
    await screenshot(page, '01-about-before');
    await closeSettings(page);

    // Design session: quick scripted reply so the canvas becomes editable.
    await session.createCompletedSession(`Update acceptance poster [SCOUT:REPLY]`);
    const match = /#\/local\/sessions\/([^?]+)/u.exec(page.url());
    sessionId = decodeURIComponent(match?.[1] ?? '');
    if (!sessionId) throw new Error('session id missing after creation');
    record('design-session-created', true, { sessionId });

    await waitCanvasReady(app, { editable: true });
    await canvasEval(app, `document.querySelector('[data-c2a-kind="text"]').click()`, {
      editable: true,
    });
    await expect
      .poll(async () => (await canvasSnapshot(app)).includes('"text"'), { timeout: 15_000 })
      .toBe(true);
    await canvasEval(app, `document.querySelector('[data-c2a-kind="shape"]').click()`, {
      editable: true,
    });
    await expect
      .poll(async () => (await canvasSnapshot(app)).includes('"shape"'), { timeout: 15_000 })
      .toBe(true);
    const preSnapshot = await canvasSnapshot(app);
    writeFileSync(join(evidenceDir, 'canvas-snapshot-pre.json'), preSnapshot);
    record('canvas-edits-visible', preSnapshot.includes('"text"') && preSnapshot.includes('"shape"'));

    // Reference attachment through the synthetic paste seam. PNG routes through
    // the image path (thumbnail chip, name may not be text), so assert via the
    // DOM's text/title/alt surface and confirm the name after sending.
    const posterMedia = join(e2eDir, 'fixtures', 'design', 'poster', 'media');
    const mediaFile = readdirSync(posterMedia)[0];
    const pngB64 = readFileSync(join(posterMedia, mediaFile)).toString('base64');
    const composerBox = page.locator('textarea:visible').last();
    await composerBox.click();
    await page.evaluate(async ([b64, name]) => {
      const bytes = Uint8Array.from(atob(b64 as string), (c) => c.charCodeAt(0));
      const file = new File([bytes], name as string, { type: 'image/png' });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      const event = new ClipboardEvent('paste', {
        clipboardData: dataTransfer,
        bubbles: true,
        cancelable: true,
      });
      const textareas = [...document.querySelectorAll('textarea')].filter(
        (candidate) => candidate.offsetParent !== null
      );
      const target = textareas.at(-1);
      if (!target) throw new Error('session composer textarea not found');
      target.dispatchEvent(event);
    }, [pngB64, attachmentName]);
    await expect.poll(async () => await domMentions(page, attachmentName), { timeout: 15_000 }).toBe(true);
    await followUpAndWaitEnd(page, fixture, `Reference attached [SCOUT:REPLY]`);
    await expect
      .poll(async () => await domMentions(page, attachmentName), {
        timeout: 60_000,
        intervals: [500, 1000, 2000],
      })
      .toBe(true);
    // The transcript renders an image thumbnail, not necessarily the name as
    // text; the durable signal is the stored attachment on disk.
    const fixtureSha = createHash('sha256')
      .update(readFileSync(join(posterMedia, mediaFile)))
      .digest('hex');
    const findAttachmentOnDisk = (): { path: string; sha256: string } | undefined => {
      const matches: { path: string; sha256: string }[] = [];
      const walk = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (entry.isFile()) {
            const sha = sha256File(full);
            if (sha === fixtureSha || entry.name.includes('update-acceptance-reference'))
              matches.push({ path: full, sha256: sha });
          }
        }
      };
      walk(dirs.dataDir);
      // The fixture image is also bundled as a skill example; the pasted
      // attachment is the copy that keeps the pasted file's name.
      return (
        matches.find((found) => found.path.includes('update-acceptance-reference')) ?? matches[0]
      );
    };
    const storedAttachment = findAttachmentOnDisk();
    record('attachment-sent', Boolean(storedAttachment), {
      attachmentName,
      source: mediaFile,
      stored: storedAttachment,
    });

    // Theme: switch to Dark via the PreviewSelect (trigger shows the current
    // theme label, options open in a popover) and confirm it applies.
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = page.getByRole('dialog').filter({
      has: page.getByRole('navigation', { name: /^(Settings|设置)$/u }),
    });
    await settings.getByRole('button', { name: /^(Appearance|外观)$/u, exact: true }).click();
    await settings
      .getByRole('button', { name: /^(System|系统|Light|浅色)$/u })
      .first()
      .click();
    await page.getByText(/^(Dark|深色)$/u, { exact: true }).last().click();
    await expect
      .poll(async () => await page.evaluate(() => document.documentElement.classList.contains('dark')), { timeout: 10_000 })
      .toBe(true);
    await closeSettings(page);
    record('theme-dark-applied', true);

    // Update check against the loopback feed.
    await openAbout(page);
    await clickCheckForUpdates(page);
    const downloaded = await waitForPhase(page, ['downloaded']);
    record(
      'update-downloaded',
      downloaded.downloadedVersion === rig.newVersion,
      { downloadedVersion: downloaded.downloadedVersion }
    );
    await screenshot(page, '02-update-downloaded');
    await closeSettings(page);

    // Install gate: a running Agent must block installation with an explicit
    // error. The detailed reason rides in updater state; the panel shows a
    // generic label with the detail as its tooltip.
    const waiting = await holdInSession(page, fixture, `Hold execution during update [SCOUT:HOLD]`);
    await openAbout(page);
    await page.getByRole('button', { name: /^(Update & Restart|更新并重启)$/u }).click();
    await expect
      .poll(async () => (await updaterState(page)).error ?? '', { timeout: 30_000 })
      .toContain('Wait for Agent execution');
    const gated = await updaterState(page);
    record('install-gate-blocks-running-agent', gated.currentVersion === rig.oldVersion, {
      error: gated.error,
    });
    await screenshot(page, '03-install-gated');
    await closeSettings(page);
    await releaseHeldSession(page, fixture, waiting);

    // Last-minute edit: the install preparation must flush it.
    await waitCanvasReady(app, { editable: true });
    const beforeLastEdit = await canvasSnapshot(app);
    await canvasEval(app, `document.querySelector('[data-c2a-kind="shape"]').click()`, {
      editable: true,
    });
    await expect
      .poll(async () => {
        const snap = await canvasSnapshot(app);
        return snap.length > beforeLastEdit.length;
      }, { timeout: 15_000 })
      .toBe(true);
    const finalPreSnapshot = await canvasSnapshot(app);
    writeFileSync(join(evidenceDir, 'canvas-snapshot-final-pre.json'), finalPreSnapshot);
    record('last-minute-edit-present', true);

    // Data manifest before install preparation flushes (attachments/settings/session
    // metadata are stable across the flush; the artwork doc is asserted via canvas).
    const manifestPre = {
      data: buildManifest(dirs.dataDir),
      userData: buildManifest(dirs.userDataDir),
    };
    writeFileSync(join(evidenceDir, 'manifest-pre-install.json'), JSON.stringify(manifestPre, null, 2));

    // Install: the app quits, Sparkle replaces the bundle and relaunches it.
    let hasExited = false;
    app.process().once('exit', (code) => {
      hasExited = true;
      // Capture exit code via closure if later assertions need it.
      void (code ?? 0);
    });
    await openAbout(page);
    await page.getByRole('button', { name: /^(Update & Restart|更新并重启)$/u }).click();
    await expect
      .poll(async () => hasExited, { timeout: 60_000 })
      .toBe(true);
    record('old-app-quit-for-install', true);

    // Sparkle replaces the bundle at the same path; wait for the flip.
    await expect
      .poll(() => {
        try {
          return plistValue(scratchApp, 'CFBundleShortVersionString');
        } catch {
          return 'missing';
        }
      }, { timeout: 120_000, intervals: [500, 1000, 2000] })
      .toBe(rig.newVersion);
    const installedPlist = {
      version: plistValue(scratchApp, 'CFBundleShortVersionString'),
      bundleId: plistValue(scratchApp, 'CFBundleIdentifier'),
      feed: plistValue(scratchApp, 'SUFeedURL'),
    };
    const markerPresent = existsSync(
      join(scratchApp, 'Contents', 'Resources', 'update-verification-marker.txt')
    );
    record('bundle-replaced-from-zip', installedPlist.version === rig.newVersion && markerPresent, {
      ...installedPlist,
      markerPresent,
    });

    // Sparkle may relaunch the new bundle outside our isolated environment; stop it.
    const stray = spawnSync('pgrep', ['-f', `${scratchApp}/Contents/MacOS/Molly Design`], { encoding: 'utf8' });
    const strayPids = (stray.stdout ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
    if (strayPids.length > 0) {
      spawnSync('kill', strayPids);
      await new Promise((resolveWait) => setTimeout(resolveWait, 1500));
      spawnSync('kill', ['-9', ...strayPids]);
    }
    record('stray-relaunch-contained', true, { strayPids });

    const signCheck = spawnSync('codesign', ['--verify', '--deep', '--strict', scratchApp], { encoding: 'utf8' });
    record('installed-bundle-signature-valid', signCheck.status === 0, { stderr: signCheck.stderr });

    // Reopen the updated app on the same data and verify everything survived.
    const relaunch = await launchMolly(scratchBinary, dirs, {
      forceOnboarding: false,
      logName: 'app-updated',
    });
    const appB = relaunch.app;
    const pageB = relaunch.page;
    try {
      // The restored route may be the session itself or the landing composer;
      // either way the renderer bridge must be up before we navigate.
      await expect
        .poll(
          async () =>
            await pageB.evaluate(
              () => (window as unknown as { __MOLLY_ELECTRON__?: boolean }).__MOLLY_ELECTRON__ === true
            ),
          { timeout: 120_000, intervals: [500, 1000, 2000] }
        )
        .toBe(true);
      await pageB.evaluate((id) => {
        window.location.hash = `#/local/sessions/${encodeURIComponent(id)}`;
      }, sessionId);
      await expect(pageB).toHaveURL(/#\/local\/sessions\//u, { timeout: 30_000 });
      await waitCanvasReady(appB, { editable: true });
      const postSnapshot = await canvasSnapshot(appB);
      writeFileSync(join(evidenceDir, 'canvas-snapshot-post.json'), postSnapshot);
      // Compare element identity, not raw JSON bytes (view state may legitimately shift).
      const elementIds = (snapshot: string): string[] => {
        try {
          const parsed = JSON.parse(snapshot) as { elements?: Array<{ id?: string }> };
          return (parsed.elements ?? []).map((element) => element.id ?? '').sort();
        } catch {
          return [];
        }
      };
      const preIds = elementIds(finalPreSnapshot);
      const postIds = elementIds(postSnapshot);
      const sameElements =
        preIds.length > 0 && preIds.length === postIds.length &&
        preIds.every((id, index) => id === postIds[index]);
      record(
        'artwork-survives-update',
        postSnapshot.includes('"text"') && postSnapshot.includes('"shape"') && sameElements,
        { preElements: preIds.length, postElements: postIds.length }
      );
      await expect
        .poll(async () => await domMentions(pageB, attachmentName), { timeout: 30_000 })
        .toBe(true);
      record('attachment-survives-update', true, { attachmentName });
      const darkAfter = await pageB.evaluate(() => document.documentElement.classList.contains('dark'));
      record('theme-survives-update', darkAfter === true, { darkAfter });

      await openAbout(pageB);
      const after = await updaterState(pageB);
      record('new-version-is-0.1.1', after.currentVersion === rig.newVersion, after);
      await screenshot(pageB, '04-about-after-update');
      await closeSettings(pageB);

      // Export through the real path with a stubbed native save dialog.
      const exportPath = join(evidenceDir, `molly-${rig.newVersion}-export.png`);
      await appB.evaluate(({ dialog }, target) => {
        // @ts-expect-error intentional test stub on the shared Electron module object
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
      }, exportPath);
      await pageB.getByRole('button', { name: 'PNG', exact: true }).click();
      await expect.poll(() => existsSync(exportPath), { timeout: 30_000 }).toBe(true);
      const png = readFileSync(exportPath);
      const isPng = png.length > 24 && png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      const width = isPng ? png.readUInt32BE(16) : 0;
      const height = isPng ? png.readUInt32BE(20) : 0;
      record('export-png-after-update', isPng && width > 0 && height > 0, { width, height });
      await screenshot(pageB, '05-session-after-update');

      await appB.close();
      const manifestPost = {
        data: buildManifest(dirs.dataDir),
        userData: buildManifest(dirs.userDataDir),
      };
      writeFileSync(join(evidenceDir, 'manifest-post-update.json'), JSON.stringify(manifestPost, null, 2));
      const attachmentDiffs = Object.keys(manifestPre.data)
        .filter((key) => key.includes('attachment'))
        .filter((key) => manifestPre.data[key]?.sha256 !== manifestPost.data[key]?.sha256);
      // The exact stored path discovered before the update must also hold the
      // same bytes afterwards (its key may not contain "attachment").
      const storedRel = storedAttachment ? relative(dirs.dataDir, storedAttachment.path) : '';
      const storedShaAfter = storedRel ? manifestPost.data[storedRel]?.sha256 : undefined;
      record(
        'attachment-bytes-unchanged',
        attachmentDiffs.length === 0 && storedShaAfter === fixtureSha,
        { attachmentDiffs, storedRel, storedShaAfter }
      );
    } finally {
      await safeClose(appB);
    }
  } finally {
    await safeClose(app);
    if (existsSync(fixture.eventLogPath))
      copyFileSync(fixture.eventLogPath, join(evidenceDir, 'scripted-runtime-events.jsonl'));
    fixture.dispose();
  }
}

async function expectRejection(laneName: string): Promise<void> {
  const dirs = makeIsolatedDirs(laneName);
  resetSparkleDefaultsState();
  const { scratchBinary } = prepareScratchApp(laneName);
  const { app, page } = await launchMolly(scratchBinary, dirs, {
    forceOnboarding: true,
    logName: `app-${laneName}`,
  });
  try {
    await enterProduct(page);
    await openAbout(page);
    await clickCheckForUpdates(page);
    const state = await waitForPhase(page, ['error'], 180_000);
    record(`${laneName}-rejected-with-error`, Boolean(state.error), { error: state.error });
    record(`${laneName}-app-remains-old`, state.currentVersion === rig.oldVersion);
    await screenshot(page, `${laneName}-rejected`);
    await closeSettings(page);
    await expect(page.locator('#chat-prompt')).toBeEditable();
    record(`${laneName}-app-remains-functional`, true);
  } finally {
    await safeClose(app);
  }
}

async function badSignatureLane(): Promise<void> {
  // Re-sign the same enclosure with a rogue key; Sparkle must refuse the update.
  const rogueDir = join(rig.archiveDir, '..', 'feed-rogue');
  cpSync(rig.archiveDir, rogueDir, { recursive: true });
  const rogueKey = join(rogueDir, 'rogue-ed-key');
  const sparkleBin = join(
    repoRoot,
    'apps/electron/node_modules/electron-sparkle-updater/native/vendor/bin'
  );
  execFileSync(join(sparkleBin, 'generate_keys'), ['--account', 'molly-sparkle-rogue'], { stdio: 'ignore' });
  execFileSync(join(sparkleBin, 'generate_keys'), ['--account', 'molly-sparkle-rogue', '-x', rogueKey]);
  execFileSync(
    'pnpm',
    [
      'exec',
      'electron-sparkle-updater',
      'generate-appcast',
      rogueDir,
      '--ed-key-file',
      rogueKey,
      '--download-url-prefix',
      `http://127.0.0.1:${new URL(rig.feedUrl).port}/`,
    ],
    { cwd: join(repoRoot, 'apps/electron'), stdio: 'inherit' }
  );
  const goodAppcast = readFileSync(join(rig.archiveDir, 'appcast.xml'));
  copyFileSync(join(rogueDir, 'appcast.xml'), join(rig.archiveDir, 'appcast.xml'));
  try {
    await expectRejection('bad-signature');
  } finally {
    writeFileSync(join(rig.archiveDir, 'appcast.xml'), goodAppcast);
  }
}

async function downloadFailureLane(): Promise<void> {
  const zipPath = join(rig.archiveDir, `MollyDesign-${rig.newVersion}-arm64.zip`);
  const hidden = `${zipPath}.bak`;
  renameSync(zipPath, hidden);
  const dirs = makeIsolatedDirs('download-failure');
  resetSparkleDefaultsState();
  const { scratchBinary } = prepareScratchApp('download-failure');
  const { app, page } = await launchMolly(scratchBinary, dirs, {
    forceOnboarding: true,
    logName: 'app-download-failure',
  });
  try {
    await enterProduct(page);
    await openAbout(page);
    await clickCheckForUpdates(page);
    const failed = await waitForPhase(page, ['error'], 180_000);
    record('download-failure-reported', Boolean(failed.error), { error: failed.error });
    await screenshot(page, 'download-failure');

    renameSync(hidden, zipPath);
    await clickCheckForUpdates(page);
    const recovered = await waitForPhase(page, ['downloaded'], 180_000);
    record(
      'download-retry-recovers',
      recovered.downloadedVersion === rig.newVersion,
      { downloadedVersion: recovered.downloadedVersion }
    );
    await screenshot(page, 'download-failure-recovered');
  } finally {
    if (existsSync(hidden)) renameSync(hidden, zipPath);
    await safeClose(app);
  }
}

async function tamperedPlistLane(): Promise<void> {
  const dirs = makeIsolatedDirs('tampered-plist');
  resetSparkleDefaultsState();
  const { scratchApp: tamperedApp, scratchBinary: tamperedBinary } = prepareScratchApp('tampered');
  execFileSync('/usr/bin/plutil', [
    '-replace',
    'SUFeedURL',
    '-string',
    'https://example.invalid/foreign-appcast.xml',
    join(tamperedApp, 'Contents', 'Info.plist'),
  ]);
  execFileSync('codesign', ['--force', '--sign', '-', tamperedApp]);
  const { app, page } = await launchMolly(tamperedBinary, dirs, {
    forceOnboarding: true,
    logName: 'app-tampered-plist',
  });
  try {
    await enterProduct(page);
    const state = await updaterState(page);
    record(
      'foreign-feed-disables-updater',
      state.phase === 'disabled' && state.disabledReason === 'molly_update_configuration_unavailable',
      state
    );
    await openAbout(page);
    const settings = page.getByRole('dialog').filter({
      has: page.getByRole('navigation', { name: /^(Settings|设置)$/u }),
    });
    // When disabled the action button is hidden and a muted status line is shown.
    // The exact label depends on the i18n fallback; assert structural absence of
    // the action button plus presence of a status description instead.
    await expect(
      settings
        .getByRole('button', { name: /^(Check for Updates|检查更新|Update & Restart|更新并重启)$/u })
        .first()
    ).toBeHidden({ timeout: 5_000 });
    await expect(settings.locator('span.text-muted-foreground').first()).toBeVisible();
    await screenshot(page, 'tampered-plist-disabled');
    await closeSettings(page);
    await expect(page.locator('#chat-prompt')).toBeEditable();
    record('tampered-app-remains-functional', true);
  } finally {
    await safeClose(app);
  }
}

const feedPort = Number(new URL(rig.feedUrl).port);
copyFileSync(launchJsonPath, join(evidenceDir, 'launch.json'));
copyFileSync(join(rig.archiveDir, 'appcast.xml'), join(evidenceDir, 'appcast.xml'));

const server = await startFeedServer(feedPort);
console.log(`[feed] serving ${rig.feedUrl} from ${rig.archiveDir}`);
console.log(`[evidence] ${evidenceDir}`);

try {
  if (lane === 'positive') await positiveLane();
  else if (lane === 'bad-signature') await badSignatureLane();
  else if (lane === 'download-failure') await downloadFailureLane();
  else if (lane === 'tampered-plist') await tamperedPlistLane();
  else throw new Error(`unknown lane: ${lane}`);
} finally {
  server.close();
  resetSparkleDefaultsState();
  writeFileSync(
    join(evidenceDir, 'report.json'),
    JSON.stringify({ lane, rig, checkpoints }, null, 2)
  );
}
console.log(`[done] ${lane}: ${checkpoints.filter((c) => c.ok).length}/${checkpoints.length} checkpoints passed`);
