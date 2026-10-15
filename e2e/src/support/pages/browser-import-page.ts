import { expect, type Page } from '@playwright/test';

export class BrowserImportPage {
  constructor(private readonly page: Page) {}

  async openWebsiteAccounts(): Promise<void> {
    await this.page
      .getByRole('button', { name: /^(Settings|设置)$/u })
      .first()
      .click();
    await this.page.getByRole('button', { name: 'Website accounts' }).click();
    await expect(this.page.getByRole('button', { name: 'Import from browser…' })).toBeVisible({
      timeout: 60_000,
    });
  }

  async expectShortenedSettings(): Promise<void> {
    const importButton = this.page.getByRole('button', { name: 'Import from browser…' });
    await expect(this.page.getByRole('button', { name: 'Clear website data' })).toBeVisible();
    const surface = importButton.locator('xpath=ancestor::div[contains(@class,"space-y-5")][1]');
    await expect(surface.locator('> p')).toHaveCount(1);
    await expect(surface.getByText(/cookies currently|do not confirm sign-in/u)).toHaveCount(0);
  }

  async openImportDialog(): Promise<void> {
    await this.page.getByRole('button', { name: 'Import from browser…' }).click();
    await expect(
      this.page.getByRole('dialog').filter({ hasText: 'Import from your browser' })
    ).toBeVisible();
  }

  async expectProfilePickerWithoutExplanatoryCopy(): Promise<void> {
    const dialog = this.page.getByRole('dialog').filter({ hasText: 'Import from your browser' });
    await expect(dialog.getByRole('heading', { name: 'Import from your browser' })).toBeVisible();
    await expect(dialog.getByRole('combobox', { name: 'Profile' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Websites' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Import', exact: true })).toBeVisible();
    const explanatoryCopy = dialog
      .getByRole('paragraph')
      .filter({ hasNotText: /^$/u })
      .and(dialog.locator('xpath=.//p[not(ancestor-or-self::*[@role="alert"])]'));
    await expect(explanatoryCopy).toHaveCount(0);
  }

  async closeWithoutImporting(): Promise<void> {
    const dialog = this.page.getByRole('dialog').filter({ hasText: 'Import from your browser' });
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
  }
}
