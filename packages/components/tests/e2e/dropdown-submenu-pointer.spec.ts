import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 900, height: 670 } });

test('left-opening Agent submenu remains hit-testable and selects with a pointer', async ({
  page,
}) => {
  await page.goto(
    '/iframe.html?id=sessions-desktoprunconfigmenu--left-opening-agent-menu&viewMode=story'
  );

  await page.getByRole('button', { name: 'Run configuration' }).click();
  await page.getByRole('menuitem', { name: /^Agent(?:\s|$)/ }).hover();

  const option = page.getByRole('menuitemradio', { name: 'Grok', exact: true });
  await expect(option).toHaveAttribute('aria-checked', 'false');
  const submenu = option.locator('xpath=ancestor::*[@role="menu"][1]');
  await expect(submenu).toHaveAttribute('data-side', 'left');

  // Moving to a sibling trigger must still close this submenu and open the sibling.
  await page.getByRole('menuitem', { name: /^Model(?:\s|$)/ }).hover();
  await expect(option).toBeHidden();
  await expect(page.getByRole('menuitemradio', { name: /^5\.4 / })).toBeVisible();

  // Leaving the menu must not be mistaken for arrival in this submenu.
  await page.getByRole('menuitem', { name: /^Agent(?:\s|$)/ }).hover();
  await expect(option).toBeVisible();
  await page.mouse.move(10, 10);
  await expect(option).toBeHidden();

  await page.getByRole('menuitem', { name: /^Agent(?:\s|$)/ }).hover();
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
