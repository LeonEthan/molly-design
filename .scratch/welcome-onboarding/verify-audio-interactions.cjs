const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '../..');
const req = createRequire(path.join(root, 'apps/electron/package.json'));
const { _electron } = req('playwright');
const executablePath = path.join(
  root,
  'apps/electron/dist/mac-arm64/Molly.app/Contents/MacOS/Molly'
);
const output = path.join(root, 'output/welcome-redesign-2026-09-24/verification');

async function reservePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function main() {
  const profile = await fs.mkdtemp('/tmp/molly-welcome-sound-');
  const port = await reservePort();
  const results = { surface: 'packaged-macos-arm64', states: [], pageErrors: [], passed: false };
  let app;
  try {
    app = await _electron.launch({
      executablePath,
      args: [`--user-data-dir=${path.join(profile, 'electron-user-data')}`],
      env: {
        ...process.env,
        MOLLY_DATA_DIR: path.join(profile, 'lody-data'),
        MOLLY_ELECTRON_USER_DATA_DIR: path.join(profile, 'electron-user-data'),
        MOLLY_ELECTRON_FORCE_ONBOARDING: '1',
        MOLLY_E2E: '1',
        MOLLY_E2E_LOCAL_CLI_HOST_PORT: String(port),
        MOLLY_ELECTRON_DISABLE_SHELL_ENV: '1',
        MOLLY_ELECTRON_DISABLE_SYSTEM_PROXY_ENV: '1',
      },
    });
    const page = await app.firstWindow();
    page.on('pageerror', (error) => results.pageErrors.push(error.message));
    await page.addInitScript(() => {
      const NativeAudio = window.Audio;
      window.__mollyQaBlockSound = true;
      window.Audio = function (...args) {
        const player = new NativeAudio(...args);
        window.__mollyQaPlayer = player;
        const nativePlay = player.play.bind(player);
        player.play = () =>
          window.__mollyQaBlockSound
            ? Promise.reject(new DOMException('QA blocked autoplay', 'NotAllowedError'))
            : nativePlay();
        return player;
      };
      window.Audio.prototype = NativeAudio.prototype;
    });
    await page.clock.install({ time: new Date('2026-09-24T00:00:00Z') });
    await page.clock.pauseAt(new Date('2026-09-24T00:00:01Z'));
    await page.evaluate(() => {
      localStorage.setItem('molly-language', JSON.stringify('en'));
      localStorage.setItem('molly-desktop-onboarding-phase', JSON.stringify('ceremony'));
    });
    await page.reload();

    const capture = async (label) => {
      const state = await page.evaluate((name) => {
        const player = window.__mollyQaPlayer;
        return {
          label: name,
          scene: document.querySelector('.molly-intro-count')?.textContent?.trim() ?? null,
          soundLabel:
            document.querySelector('.molly-intro-sound')?.getAttribute('aria-label') ?? null,
          paused: player?.paused ?? null,
          muted: player?.muted ?? null,
          currentTime: player?.currentTime ?? null,
          hasSource: Boolean(player?.getAttribute('src')),
        };
      }, label);
      results.states.push(state);
      console.log(JSON.stringify(state));
      return state;
    };

    await page.locator('.molly-intro-sound[aria-label="Enable sound"]').waitFor();
    let state = await capture('blocked-autoplay');
    assert(state.paused);
    await page.clock.runFor(2100);
    await page.locator('.molly-intro-segments button').first().click();
    state = await capture('unrelated-scene-selection');
    assert.equal(state.soundLabel, 'Enable sound');
    assert(state.paused);

    await page.evaluate(() => {
      window.__mollyQaBlockSound = false;
    });
    await page.locator('.molly-intro-sound').click();
    await page.waitForFunction(() => window.__mollyQaPlayer && !window.__mollyQaPlayer.paused);
    await page.locator('.molly-intro-sound[aria-label="Mute"]').waitFor();
    state = await capture('explicit-sound-recovery');
    assert(state.currentTime >= 2 && state.currentTime < 3);

    await page.locator('.molly-intro-sound').click();
    await page.locator('.molly-intro-sound[aria-label="Enable sound"]').waitFor();
    state = await capture('muted');
    assert(state.muted);
    await page.locator('.molly-intro-sound').click();
    await page.locator('.molly-intro-sound[aria-label="Mute"]').waitFor();
    state = await capture('unmuted');
    assert(!state.muted);
    assert(state.currentTime >= 2);

    await page.locator('.molly-intro-skip').click();
    await page.getByRole('heading', { name: 'Connect a model', exact: true }).waitFor();
    state = await capture('early-setup-exit');
    assert(state.paused);
    assert(!state.hasSource);
    assert.deepEqual(results.pageErrors, []);
    results.passed = true;
    console.log('PASS: packaged audio block, deliberate recovery, mute/unmute and early exit');
  } catch (error) {
    results.error = error.stack ?? String(error);
    throw error;
  } finally {
    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(
      path.join(output, 'audio-interactions-results.json'),
      JSON.stringify(results, null, 2)
    );
    if (app) await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
