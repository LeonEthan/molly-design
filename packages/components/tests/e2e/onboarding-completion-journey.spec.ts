import { expect, test } from '@playwright/test';

test('provider skip completes onboarding without model readiness', async ({ page }) => {
  test.setTimeout(60_000);
  const response = await page.goto(
    '/iframe.html?id=onboarding-completionjourney--provider-skip&viewMode=story'
  );
  expect(response?.ok()).toBeTruthy();

  await expect(page.getByRole('heading', { name: 'Connect your models' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('button', { name: 'Finish' })).toBeDisabled();
  await page.getByRole('button', { name: 'Skip for now' }).click();

  await expect(page.getByTestId('onboarding-complete')).toBeVisible();
});

test('next completes onboarding once both models are ready', async ({ page }) => {
  test.setTimeout(60_000);
  const response = await page.goto(
    '/iframe.html?id=onboarding-completionjourney--provider-next&viewMode=story'
  );
  expect(response?.ok()).toBeTruthy();

  await expect(page.getByRole('heading', { name: 'Connect your models' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('button', { name: /Language model/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Image model/ })).toBeVisible();
  const browserRow = page.getByRole('button', { name: /Browser sign-ins/ });
  await expect(browserRow).toContainText('Optional');
  await browserRow.click();
  await expect(page.getByRole('region', { name: 'Browser sign-ins' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Finish' })).toBeEnabled();
  await page.getByRole('button', { name: 'Browser import' }).click();
  await expect(page.getByRole('region', { name: 'Browser sign-ins' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Finish' })).toBeEnabled();
  await page.getByRole('button', { name: 'Finish' }).click();

  await expect(page.getByTestId('onboarding-complete')).toBeVisible();
});
