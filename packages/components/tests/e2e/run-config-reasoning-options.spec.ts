import { expect, test } from '@playwright/test';

test('confirming a Reasoning option dismisses the picker', async ({ page }) => {
  await page.goto(
    '/iframe.html?id=sessions-desktoprunconfigmenu--provider-and-model&viewMode=story'
  );

  const trigger = page.getByRole('button', { name: 'Provider and model' });
  await trigger.click();
  await page.getByRole('menuitem', { name: /^Reasoning/ }).hover();

  const submenu = page.getByRole('menu').nth(1);
  const medium = submenu.getByRole('menuitemradio', { name: 'Medium', exact: true });
  await expect(medium).toHaveAttribute('aria-checked', 'true');

  const ultra = submenu.getByRole('menuitemradio', { name: 'Ultra', exact: true });
  await ultra.click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(trigger).toContainText('Ultra');

  await trigger.click();
  await page.getByRole('menuitem', { name: /^Reasoning/ }).hover();
  await expect(ultra).toHaveAttribute('aria-checked', 'true');

  await ultra.focus();
  await ultra.press('Enter');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(trigger).toContainText('Ultra');
});
