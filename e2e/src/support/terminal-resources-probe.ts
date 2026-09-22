import { readFileSync, mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ElectronHarness } from './electron-harness.js';

// Exercise the installed browser bundle and public open/dispose lifecycle in real
// Electron. Track active registrations, not GC timing, RSS thresholds or mocks.
const require = createRequire(
  fileURLToPath(new URL('../../../packages/components/package.json', import.meta.url))
);
const bundle = readFileSync(require.resolve('@xterm/xterm'), 'utf8');
const dir = mkdtempSync(resolve(tmpdir(), 'molly-terminal-listeners-'));
const harness = new ElectronHarness({
  rootDir: dir,
  scenarioDir: dir,
  stableId: 'TERMINAL-LISTENERS',
});
try {
  await harness.launch();
  const result = await harness.app!.evaluate(async ({ BrowserWindow }, library) => {
    const probe = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    try {
      await probe.loadURL('about:blank');
      await probe.webContents.executeJavaScript(library);
      return await probe.webContents.executeJavaScript(`(() => {
        const retained = new Map();
        const add = EventTarget.prototype.addEventListener;
        const remove = EventTarget.prototype.removeEventListener;
        const media = window.matchMedia.bind(window);
        const lists = new Set();
        window.matchMedia = (...args) => { const list = media(...args); lists.add(list); return list; };
        const track = (target, type, listener, adding) => {
          if (target !== window && !lists.has(target)) return;
          let entries = retained.get(target); if (!entries) retained.set(target, entries = new Map());
          let listeners = entries.get(type); if (!listeners) entries.set(type, listeners = new Set());
          if (adding) listeners.add(listener); else listeners.delete(listener);
        };
        EventTarget.prototype.addEventListener = function(type, listener, options) { track(this, type, listener, true); return add.call(this, type, listener, options); };
        EventTarget.prototype.removeEventListener = function(type, listener, options) { track(this, type, listener, false); return remove.call(this, type, listener, options); };
        const legacyAdd = MediaQueryList.prototype.addListener;
        const legacyRemove = MediaQueryList.prototype.removeListener;
        MediaQueryList.prototype.addListener = function(listener) { track(this, 'change', listener, true); return legacyAdd.call(this, listener); };
        MediaQueryList.prototype.removeListener = function(listener) { track(this, 'change', listener, false); return legacyRemove.call(this, listener); };
        const rounds = [];
        for (let i = 0; i < 3; i++) {
          const host = document.body.appendChild(document.createElement('div'));
          const terminal = new window.Terminal(); terminal.open(host); terminal.dispose(); host.remove();
          const counts = { resize: 0, change: 0 };
          for (const entries of retained.values()) for (const [type, listeners] of entries) counts[type] = (counts[type] || 0) + listeners.size;
          rounds.push(counts);
        }
        return rounds;
      })()`);
    } finally {
      probe.destroy();
    }
  }, bundle);
  console.log(JSON.stringify(result));
  assert.deepEqual(result, [
    { resize: 0, change: 0 },
    { resize: 0, change: 0 },
    { resize: 0, change: 0 },
  ]);
} finally {
  await harness.close();
}
