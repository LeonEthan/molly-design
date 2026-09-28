import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 900, height: 670 } });

test('left-opening run-config submenu remains hit-testable and selects with a pointer', async ({
  page,
}) => {
  await page.goto(
    '/iframe.html?id=sessions-desktoprunconfigmenu--left-opening-submenu&viewMode=story'
  );

  await page.getByRole('button', { name: 'Provider and model' }).click();
  const trigger = page.getByRole('menuitem', { name: /^Reasoning(?:\s|$)/ });
  await trigger.hover();

  const option = page.getByRole('menuitemradio', { name: 'High', exact: true });
  await expect(option).toHaveAttribute('aria-checked', 'false');
  const submenu = option.locator('xpath=ancestor::*[@role="menu"][1]');
  await expect(submenu).toHaveAttribute('data-side', 'left');

  // Leaving the menu must not be mistaken for arrival in this submenu.
  await page.mouse.move(10, 10);
  await expect(option).toBeHidden();

  await trigger.hover();
  await expect(option).toBeVisible();

  expect(
    await option.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const hit = document.elementFromPoint(
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2
      );
      return hit === element || element.contains(hit);
    })
  ).toBe(true);

  await option.click();
  await expect(option).toHaveAttribute('aria-checked', 'true');
});
