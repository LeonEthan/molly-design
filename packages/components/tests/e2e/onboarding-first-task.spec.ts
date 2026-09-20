import { expect, test } from '@playwright/test';

test('requires explicit model and thinking choices, and skips without starting', async ({
  page,
}) => {
  const response = await page.goto(
    '/iframe.html?id=onboarding-firsttaskscreen--explicit-model-selection&viewMode=story'
  );
  expect(response?.ok()).toBeTruthy();

  await expect(page.getByRole('heading', { name: 'Continue to Molly' })).toBeVisible();
  const provider = page.getByRole('combobox', { name: 'Agent' });
  await expect(provider).toContainText('Molly');

  await provider.click();
  await expect(page.getByRole('option', { name: 'Retired Kimi CLI' })).toHaveCount(0);
  await page.getByRole('option', { name: 'Molly', exact: true }).click();
  await page.getByRole('combobox', { name: 'Connection and model' }).click();
  await page.getByRole('option', { name: 'Synthetic Kimi · k3-256k' }).click();
  await expect(page.getByRole('button', { name: 'Enter Molly', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Thinking level' }).click();
  await page.getByRole('option', { name: 'High', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start design session' })).toBeVisible();

  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page.getByTestId('first-task-skipped')).toBeAttached();
});
