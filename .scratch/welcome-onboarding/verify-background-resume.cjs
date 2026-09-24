const { createRequire } = require('node:module');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '../..');
const req = createRequire(path.join(root, 'apps/electron/package.json'));
const { _electron } = req('playwright');
const output = path.join(root, 'output/welcome-redesign-2026-09-24/verification');
const usePackaged = process.env.MOLLY_WELCOME_PACKAGED === '1';
const packagedExecutable = path.join(
  root,
  'apps/electron/dist/mac-arm64/Molly.app/Contents/MacOS/Molly'
);
const windowConfig = path.join(
  process.env.HOME,
  'Library/Preferences/molly-desktop-nodejs/window-state.json'
);

async function waitForAudioState(page, paused) {
  let timeout;
  try {
    await Promise.race([
      page.evaluate(
        (expectedPaused) =>
          new Promise((resolve) => {
            const player = window.__mollyWelcomeQaAudio;
            const check = () => {
              if (player.paused !== expectedPaused) return;
              player.removeEventListener('play', check);
              player.removeEventListener('pause', check);
              resolve();
            };
            player.addEventListener('play', check);
            player.addEventListener('pause', check);
            check();
          }),
        paused
      ),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Opening audio did not become ${paused ? 'paused' : 'playing'}`)),
          5000
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const savedBounds = await fs.readFile(windowConfig).catch(() => null);
  const profile = await fs.mkdtemp('/tmp/molly-welcome-background-');
  const results = {
    surface: usePackaged ? 'packaged-macos-arm64' : 'electron-development',
    samples: [],
    pageErrors: [],
    passed: false,
  };
  let app;
  try {
    app = await _electron.launch({
      executablePath: usePackaged ? packagedExecutable : req('electron'),
      args: usePackaged ? [] : [path.join(root, 'apps/electron')],
      env: {
        ...process.env,
        MOLLY_DATA_DIR: path.join(profile, 'lody-data'),
        MOLLY_ELECTRON_USER_DATA_DIR: path.join(profile, 'electron-user-data'),
        MOLLY_ELECTRON_FORCE_ONBOARDING: '1',
        MOLLY_ELECTRON_USE_BUNDLED_CLI: '1',
      },
    });
    const page = await app.firstWindow();
    page.on('pageerror', (error) => results.pageErrors.push(error.message));
    await page.addInitScript(() => {
      const NativeAudio = window.Audio;
      const ObservedAudio = function (...args) {
        const player = new NativeAudio(...args);
        window.__mollyWelcomeQaAudio = player;
        return player;
      };
      ObservedAudio.prototype = NativeAudio.prototype;
      window.Audio = ObservedAudio;
    });
    await page.clock.install({ time: new Date('2026-09-24T00:00:00Z') });
    await page.clock.pauseAt(new Date('2026-09-24T00:00:01Z'));
    await page.evaluate(() => {
      localStorage.setItem('molly-language', JSON.stringify('en'));
      localStorage.setItem('molly-desktop-onboarding-phase', JSON.stringify('ceremony'));
    });
    await page.reload();
    await app.evaluate(({ app: nativeApp, BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find(
        (candidate) => candidate.getTitle() === 'Molly'
      );
      window.setBounds({ width: 900, height: 670 });
      window.show();
      nativeApp.focus({ steal: true });
      window.focus();
    });
    await page.bringToFront();
    const focused = await app.evaluate(
      ({ BrowserWindow }) =>
        new Promise((resolve) => {
          const window = BrowserWindow.getAllWindows().find(
            (candidate) => candidate.getTitle() === 'Molly'
          );
          if (window.isFocused()) {
            resolve(true);
            return;
          }
          window.once('focus', () => resolve(true));
          setTimeout(() => resolve(window.isFocused()), 5000);
        })
    );
    results.launch = { nativeFocused: focused };
    assert(
      focused,
      'Native Molly window must be foreground before timing begins; unlock the Mac before real-surface QA'
    );
    await page.locator('.molly-intro-inspiration').waitFor();
    await page
      .waitForFunction(() => Boolean(window.__mollyWelcomeQaAudio) && document.hasFocus(), null, {
        timeout: 5000,
      })
      .catch(async (error) => {
        const renderer = await page.evaluate(() => ({
          scene: document.querySelector('.molly-intro-count')?.textContent?.trim() ?? null,
          focus: document.hasFocus(),
          visibility: document.visibilityState,
          audioCreated: Boolean(window.__mollyWelcomeQaAudio),
          ipcAvailable: Boolean(window.ipc),
        }));
        const native = await app.evaluate(({ BrowserWindow }) => {
          const window = BrowserWindow.getAllWindows().find(
            (candidate) => candidate.getTitle() === 'Molly'
          );
          return { focused: window.isFocused(), visible: window.isVisible() };
        });
        console.log(JSON.stringify({ label: 'opening-not-started', renderer, native }));
        throw error;
      });
    await page.evaluate(() => {
      window.__mollyWelcomeQaEvents = [];
      document.addEventListener('visibilitychange', () => {
        window.__mollyWelcomeQaEvents.push(`visibility:${document.visibilityState}`);
      });
      window.addEventListener('focus', () => window.__mollyWelcomeQaEvents.push('focus'));
      window.addEventListener('blur', () => window.__mollyWelcomeQaEvents.push('blur'));
    });

    const capture = async (label) => {
      const [renderer, native] = await Promise.all([
        page.evaluate(() => {
          const player = window.__mollyWelcomeQaAudio;
          return {
            scene: document.querySelector('.molly-intro-count')?.textContent?.trim() ?? null,
            focus: document.hasFocus(),
            visibility: document.visibilityState,
            soundLabel:
              document.querySelector('.molly-intro-sound')?.getAttribute('aria-label') ?? null,
            events: [...window.__mollyWelcomeQaEvents],
            audio: player
              ? {
                  paused: player.paused,
                  muted: player.muted,
                  ended: player.ended,
                  currentTime: Number(player.currentTime.toFixed(3)),
                  duration: Number.isFinite(player.duration)
                    ? Number(player.duration.toFixed(3))
                    : null,
                  hasSource: Boolean(player.getAttribute('src')),
                }
              : null,
          };
        }),
        app.evaluate(({ BrowserWindow }) => {
          const window = BrowserWindow.getAllWindows().find(
            (candidate) => candidate.getTitle() === 'Molly'
          );
          return {
            focused: window.isFocused(),
            minimized: window.isMinimized(),
            visible: window.isVisible(),
          };
        }),
      ]);
      const sample = { label, renderer, native };
      results.samples.push(sample);
      console.log(JSON.stringify(sample));
      return sample;
    };

    let initial = await capture('initial');
    if (initial.renderer.audio?.paused) {
      await page.locator('.molly-intro-sound').click();
      await page.waitForFunction(() => !window.__mollyWelcomeQaAudio?.paused);
      initial = await capture('explicit-audio-enable');
    }
    assert(initial.renderer.audio && !initial.renderer.audio.paused);
    assert.equal(initial.renderer.scene, '01 / 03');

    await page.clock.runFor(2400);
    const beforeMinimize = await capture('foreground-2400ms');
    assert.equal(beforeMinimize.renderer.scene, '01 / 03');
    await app.evaluate(
      ({ BrowserWindow }) =>
        new Promise((resolve) => {
          const window = BrowserWindow.getAllWindows().find(
            (candidate) => candidate.getTitle() === 'Molly'
          );
          window.once('minimize', resolve);
          window.minimize();
        })
    );
    await waitForAudioState(page, true).catch(async (error) => {
      await capture('minimized-without-audio-pause');
      throw error;
    });
    const minimized = await capture('minimized');
    assert(minimized.native.minimized);
    assert(minimized.renderer.audio.paused);
    await page.clock.runFor(10000);
    const minimizedLater = await capture('minimized-after-10000ms');
    assert.equal(minimizedLater.renderer.scene, '01 / 03');
    assert(minimizedLater.renderer.audio.paused);
    assert(
      Math.abs(minimizedLater.renderer.audio.currentTime - minimized.renderer.audio.currentTime) <
        0.2
    );

    await app.evaluate(
      ({ BrowserWindow }) =>
        new Promise((resolve) => {
          const window = BrowserWindow.getAllWindows().find(
            (candidate) => candidate.getTitle() === 'Molly'
          );
          window.once('restore', () => {
            window.focus();
            resolve();
          });
          window.restore();
        })
    );
    await waitForAudioState(page, false);
    const restored = await capture('restored');
    assert.equal(restored.renderer.scene, '01 / 03');
    assert(restored.renderer.audio.currentTime >= 2.2);
    await page.clock.runFor(450);
    assert.equal((await capture('remaining-450ms')).renderer.scene, '01 / 03');
    await page.clock.runFor(200);
    assert.equal((await capture('scene-two-after-remaining-time')).renderer.scene, '02 / 03');

    await page.locator('.molly-intro-segments button').first().click();
    assert.equal((await capture('manual-first-scene')).renderer.scene, '01 / 03');
    await app.evaluate(
      ({ BrowserWindow }) =>
        new Promise((resolve) => {
          const window = BrowserWindow.getAllWindows().find(
            (candidate) => candidate.getTitle() === 'Molly'
          );
          window.once('blur', resolve);
          window.blur();
        })
    );
    await waitForAudioState(page, true).catch(async (error) => {
      await capture('blurred-without-audio-pause');
      throw error;
    });
    const blurred = await capture('blurred');
    assert(!blurred.native.focused);
    assert(blurred.renderer.audio.paused);
    await page.clock.runFor(5000);
    const blurredLater = await capture('blurred-after-5000ms');
    assert.equal(blurredLater.renderer.scene, '01 / 03');
    assert(blurredLater.renderer.audio.paused);
    assert(
      Math.abs(blurredLater.renderer.audio.currentTime - blurred.renderer.audio.currentTime) < 0.2
    );

    await app.evaluate(
      ({ BrowserWindow }) =>
        new Promise((resolve) => {
          const window = BrowserWindow.getAllWindows().find(
            (candidate) => candidate.getTitle() === 'Molly'
          );
          window.once('focus', resolve);
          window.focus();
        })
    );
    await waitForAudioState(page, false);
    await page.clock.runFor(7000);
    const manualAfterReturn = await capture('manual-after-return-and-cue-expiry');
    assert.equal(manualAfterReturn.renderer.scene, '01 / 03');
    assert(manualAfterReturn.renderer.audio.paused);
    await page.locator('.molly-intro-skip').click();
    await page.getByRole('heading', { name: 'Connect a model', exact: true }).waitFor();
    const setup = await capture('setup-handoff');
    assert.equal(setup.renderer.scene, null);
    assert(setup.renderer.audio.paused);
    assert.equal(setup.renderer.audio.hasSource, false);
    assert.deepEqual(results.pageErrors, []);
    results.passed = true;
    console.log(
      'PASS: native minimize and blur pause, remaining-time resume, manual hold, audio expiry and setup handoff'
    );
  } catch (error) {
    results.error = error.stack ?? String(error);
    throw error;
  } finally {
    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(
      path.join(output, 'background-resume-results.json'),
      JSON.stringify(results, null, 2)
    );
    if (app) await app.close();
    if (savedBounds) await fs.writeFile(windowConfig, savedBounds);
    else await fs.rm(windowConfig, { force: true });
    await fs.rm(profile, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
