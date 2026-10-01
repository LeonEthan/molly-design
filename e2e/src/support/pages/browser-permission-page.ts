import { expect, type Page } from '@playwright/test';
import type { WorkSessionFixture } from '../fixtures/work-session-fixture.js';
import type { SessionPage } from './session-page.js';

/** Exercises the real Pi → MCP → desktop browser path without contacting a website. */
export class BrowserPermissionPage {
  constructor(
    private readonly page: Page,
    private readonly session: SessionPage,
    private readonly fixture: WorkSessionFixture
  ) {}

  async requestPrivateNavigation(): Promise<void> {
    await this.session.selectDeterministicModel();
    await this.page.locator('#chat-prompt').fill('Visit a local address [E2E:BROWSER:PRIVATE]');
    await this.page.getByRole('button', { name: /^(Send|发送)$/u }).click();
    await expect(this.page).toHaveURL(/#\/local\/sessions\/[^/?#]+(?:\?.*)?$/u, {
      timeout: 60_000,
    });
    await this.fixture.waitForEvent('browser-tool-dispatched');
  }

  /** Embedded Pi asks for no tool approval; the browser policy alone refuses loopback. */
  async expectBlockedWithoutPrompt(): Promise<void> {
    const events = await this.fixture.waitForEvent('browser-tool-result');
    const result = events.at(-1);
    expect(result?.blockedPrivateHost).toBe(true);
    expect(result?.resultText).not.toContain('<html');
    expect(this.fixture.readEvents().some((event) => event.event === 'browser-tool-missing')).toBe(
      false
    );
    await expect(
      this.page.getByText('Synthetic browser probe complete.', { exact: true })
    ).toBeVisible({ timeout: 60_000 });
    await expect(this.page.getByRole('button', { name: 'Deny', exact: true })).toHaveCount(0);
  }
}
