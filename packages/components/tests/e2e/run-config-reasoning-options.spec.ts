import { expect, test } from '@playwright/test';

test('the Reasoning row lists levels as options that keep the menu open', async ({ page }) => {
  await page.goto('/iframe.html?id=sessions-desktoprunconfigmenu--provider-and-model&viewMode=story');

  const trigger = page.getByRole('button', { name: 'Provider and model' });
  await trigger.click();
  await page.getByRole('menuitem', { name: /^Reasoning/ }).hover();

  const submenu = page.getByRole('menu').nth(1);
  const medium = submenu.getByRole('menuitemradio', { name: 'Medium', exact: true });
  await expect(medium).toHaveAttribute('aria-checked', 'true');

  const ultra = submenu.getByRole('menuitemradio', { name: 'Ultra', exact: true });
  await ultra.click();
  // Root menu + Reasoning submenu both stay open after the pick.
  await expect(page.getByRole('menu')).toHaveCount(2);
  await expect(ultra).toHaveAttribute('aria-checked', 'true');

  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(trigger).toContainText('Ultra');
});
