import { expect, test } from '@playwright/test';

test('provider skip remains an honest path into Molly', async ({ page }) => {
  test.setTimeout(60_000);
  const response = await page.goto(
    '/iframe.html?id=onboarding-completionjourney--provider-skip&viewMode=story'
  );
  expect(response?.ok()).toBeTruthy();

  await expect(page.getByRole('heading', { name: 'Connect a model' })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Skip for now' }).click();

  await expect(page.getByRole('heading', { name: 'Explore Molly' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enter Molly' })).toBeEnabled();
  await page.getByRole('button', { name: 'Enter Molly' }).click();

  await expect(page.getByTestId('onboarding-complete')).toBeVisible();
});

test('a retained old setup is retired and cannot be retried', async ({ page }) => {
  test.setTimeout(60_000);
  const response = await page.goto(
    '/iframe.html?id=onboarding-completionjourney--retired-setup&viewMode=story'
  );
  expect(response?.ok()).toBeTruthy();

  await expect(page.getByRole('heading', { name: 'Choose the built-in Molly' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('cell', { name: 'Previous Codex setup' })).toBeVisible();
  await expect(page.getByText('Retired · read-only')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Enter Molly' })).toBeEnabled();
});
