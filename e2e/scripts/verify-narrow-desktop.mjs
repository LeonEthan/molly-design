#!/usr/bin/env node
import { register } from 'tsx/esm/api';
register();
const { ElectronHarness } = await import('../src/support/electron-harness.ts');
const { OnboardingPage } = await import('../src/support/pages/onboarding-page.ts');
import { expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const directory = resolve('e2e/artifacts/acceptance/narrow-desktop', `run-${Date.now()}`);
await mkdir(directory, { recursive: true });
const harness = new ElectronHarness({
  rootDir: directory,
  scenarioDir: directory,
  stableId: 'narrow-desktop',
});
let page;
try {
  await harness.launch();
  page = harness.page;
  if (!page || !harness.app) throw Error('Desktop launch did not open a page');
  const onboarding = new OnboardingPage(page);
  await onboarding.waitForLocalBootstrap();
  await onboarding.skipConfigurationAndEnterProduct();
  await harness.app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) throw Error('Desktop window missing');
    const bounds = window.getBounds();
    window.setBounds({ ...bounds, width: 620, height: 780 });
  });
  const actualWidth = await harness.app.evaluate(
    ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getBounds().width
  );
  if (actualWidth !== 620) throw Error(`Narrow window was clamped to ${actualWidth}px`);
  const showSidebar = page.getByRole('button', { name: 'Show navigation sidebar' });
  await expect(showSidebar).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#chat-prompt')).toBeVisible();
  await showSidebar.click();
  const closeSidebar = page.getByRole('button', { name: 'Close sidebar' });
  await expect(closeSidebar).toBeVisible();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Filter sidebar' }).click();
  await expect(page.getByRole('menuitemradio', { name: 'Workspace', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitemradio', { name: 'Updated', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitemradio', { name: 'My Tasks', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitemradio', { name: 'All Tasks', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.screenshot({ path: join(directory, 'sidebar-open.png') });
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Archive', exact: true })).toBeVisible();
  await expect(page.getByText('My Tasks', { exact: true })).toHaveCount(0);
  await expect(page.getByText('All Tasks', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: join(directory, 'archive.png') });
  await closeSidebar.click();
  await expect(showSidebar).toBeVisible();
  await expect(closeSidebar).toBeHidden();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeHidden();
  await page.screenshot({ path: join(directory, 'sidebar-closed.png') });
  console.log(`Narrow desktop passed; screenshots: ${directory}`);
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: join(directory, 'failure.png') }).catch(() => {});
    console.error(`Desktop URL: ${page.url()}`);
    console.error(
      `Visible buttons: ${JSON.stringify(await page.locator('button:visible').allTextContents())}`
    );
  }
  throw error;
} finally {
  await harness.close();
}
