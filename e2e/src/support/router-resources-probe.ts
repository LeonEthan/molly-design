import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ElectronHarness } from './electron-harness.js';
import { OnboardingPage } from './pages/onboarding-page.js';

type ProbeRouter = {
  state: { location: { state: { __TSR_key?: string } } };
  subscribe(event: 'onRendered', callback: () => void): () => void;
  navigate(options: { to: string; replace: boolean }): Promise<unknown>;
  history: { go(delta: number): void };
};
type ProbeWindow = Window & { __TSR_ROUTER__: ProbeRouter };

// Native history owns eviction. No model, session documents, GC heuristic or
// time threshold is needed to reproduce retained scroll-restoration entries.
const directory = mkdtempSync(join(tmpdir(), 'molly-router-resources-'));
const harness = new ElectronHarness({
  rootDir: directory,
  scenarioDir: directory,
  stableId: 'ROUTER-RESOURCES',
});
try {
  await harness.launch();
  const page = harness.page!;
  const onboarding = new OnboardingPage(page);
  await onboarding.waitForLocalBootstrap();
  await onboarding.skipConfigurationAndEnterProduct();
  const installTarget = () => {
    const target = document.createElement('div');
    target.id = 'resource-scroll-target';
    target.setAttribute('data-scroll-restoration-id', 'resource-probe');
    target.style.cssText = 'position:fixed;right:0;bottom:0;height:100px;width:100px;overflow:auto';
    const child = document.createElement('div');
    child.style.height = '2000px';
    target.append(child);
    document.body.append(target);
  };
  await page.evaluate(installTarget);
  // Installed before the reload's renderer boot, so its restoration sees the
  // same synthetic scroll target. Only this owned test page is affected.
  await page.addInitScript(
    `document.addEventListener('DOMContentLoaded', ${installTarget.toString()})`
  );
  const result = await page.evaluate(async () => {
    const router = (window as unknown as ProbeWindow).__TSR_ROUTER__;
    const navigation = (
      window as unknown as Window & { navigation: { entries(): Array<{ id: string }> } }
    ).navigation;
    const target = document.getElementById('resource-scroll-target')!;
    const actions = {
      rendered() {
        return new Promise<void>((resolve) => {
          const off = router.subscribe('onRendered', () => {
            off();
            resolve();
          });
        });
      },
      async navigate(to: '/local/chat' | '/local/archive', replace = false) {
        const done = this.rendered();
        await router.navigate({ to, replace });
        await done;
      },
      async traverse(delta: number) {
        const done = this.rendered();
        router.history.go(delta);
        await done;
      },
      snapshot() {
        window.dispatchEvent(new PageTransitionEvent('pagehide'));
        return JSON.parse(sessionStorage.getItem('tsr-scroll-restoration-v1_3') || '{}') as Record<
          string,
          Record<string, { scrollY: number }>
        >;
      },
      scroll(top: number) {
        target.scrollTop = top;
        target.dispatchEvent(new Event('scroll'));
      },
    };
    for (let i = 0; i < 120; i++) {
      actions.scroll(i + 10);
      await actions.navigate(i % 2 === 0 ? '/local/archive' : '/local/chat');
    }
    const cache = actions.snapshot();
    const historyEntries = navigation.entries().length;
    const currentKey = router.state.location.state.__TSR_key!;
    actions.scroll(321);
    await actions.navigate('/local/archive');
    const forwardKey = router.state.location.state.__TSR_key!;
    actions.scroll(654);
    await actions.traverse(-1);
    const backPosition = target.scrollTop;
    await actions.traverse(1);
    const forwardPosition = target.scrollTop;
    await actions.traverse(-1);
    // Replace must retire only the replaced entry, after the old restoration
    // handler can carry element positions. Push then removes the forward branch.
    await actions.navigate('/local/archive', true);
    const replacedRetired = !(currentKey in actions.snapshot());
    await actions.navigate('/local/chat');
    const branchedRetired = !(forwardKey in actions.snapshot());
    actions.scroll(777);
    const persisted = actions.snapshot();
    return {
      historyEntries,
      scrollEntries: Object.keys(cache).length,
      backPosition,
      forwardPosition,
      replacedRetired,
      branchedRetired,
      finalEntries: Object.keys(persisted).length,
      reloadKey: router.state.location.state.__TSR_key!,
    };
  });
  writeFileSync(join(directory, 'before-reload.json'), JSON.stringify(result, null, 2));
  assert.ok(
    result.scrollEntries <= result.historyEntries,
    `scroll cache ${result.scrollEntries} exceeds history ${result.historyEntries}`
  );
  assert.equal(result.backPosition, 321);
  assert.equal(result.forwardPosition, 654);
  assert.equal(result.replacedRetired, true);
  assert.equal(result.branchedRetired, true);
  await page.reload();
  await page.waitForFunction(
    () => document.getElementById('resource-scroll-target')?.scrollTop === 777
  );
  const reloaded = await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
    return {
      key: (window as unknown as ProbeWindow).__TSR_ROUTER__.state.location.state.__TSR_key,
      entries: Object.keys(
        JSON.parse(sessionStorage.getItem('tsr-scroll-restoration-v1_3') || '{}')
      ).length,
      position: document.getElementById('resource-scroll-target')!.scrollTop,
    };
  });
  assert.equal(reloaded.key, result.reloadKey);
  assert.ok(reloaded.entries <= result.historyEntries);
  writeFileSync(join(directory, 'result.json'), JSON.stringify({ result, reloaded }, null, 2));
  console.log(JSON.stringify({ directory, result, reloaded }));
} finally {
  harness.writeDiagnostics();
  await harness.close();
}
