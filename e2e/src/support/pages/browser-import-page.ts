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

  async expectPermissionGuideBeforeRead(): Promise<void> {
    const dialog = this.page.getByRole('dialog').filter({ hasText: 'Import from your browser' });
    await expect(dialog.getByRole('button', { name: 'Websites' })).toBeVisible();
    const openSettings = dialog.getByRole('button', { name: 'Open Settings', exact: true });
    const unavailable = dialog.getByRole('button', { name: 'Import', exact: true });
    await expect(openSettings.or(unavailable)).toBeVisible();
    if (await openSettings.isVisible()) {
      await expect(
        dialog.getByRole('heading', { name: 'Bring your sign-ins with you' })
      ).toBeVisible();
      await expect(dialog.getByRole('combobox', { name: 'Profile' })).toHaveCount(0);
    } else {
      await expect(unavailable).toBeDisabled();
      await expect(dialog.getByRole('combobox', { name: 'Profile' })).toBeDisabled();
    }
  }

  async closeWithoutImporting(): Promise<void> {
    const dialog = this.page.getByRole('dialog').filter({ hasText: 'Import from your browser' });
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
  }
}
