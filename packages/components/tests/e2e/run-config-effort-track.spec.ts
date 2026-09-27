import { expect, test } from '@playwright/test';

test('the effort track selects the stop under the pointer, including by drag', async ({ page }) => {
  await page.goto('/iframe.html?id=sessions-desktoprunconfigmenu--provider-and-model&viewMode=story');

  const trigger = page.getByRole('button', { name: 'Provider and model' });
  await trigger.click();
  await page.getByRole('menuitem', { name: /^Reasoning/ }).hover();
  const track = page.getByRole('slider', { name: 'Reasoning' });
  await expect(track).toHaveAttribute('aria-valuetext', 'Medium');

  const bounds = await track.boundingBox();
  if (!bounds) throw new Error('effort track has no layout box');
  const middle = bounds.y + bounds.height / 2;

  await page.mouse.click(bounds.x + bounds.width - 2, middle);
  await expect(track).toHaveAttribute('aria-valuetext', 'Ultra');

  await page.mouse.move(bounds.x + bounds.width - 2, middle);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 2, middle, { steps: 8 });
  await page.mouse.up();
  await expect(track).toHaveAttribute('aria-valuetext', 'Low');
  // Root menu + Reasoning submenu both stay open through the drag.
  await expect(page.getByRole('menu')).toHaveCount(2);

  await page.keyboard.press('Escape');
  await expect(trigger).toContainText('Low');
});
