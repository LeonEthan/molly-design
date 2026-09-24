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
    await expect(this.page.getByRole('button', { name: 'Deny', exact: true })).toBeVisible({
      timeout: 60_000,
    });
    // A loopback target must never receive the task-wide website grant option.
    await expect(
      this.page.getByRole('button', { name: /^Allow browsing, clicks, input/u })
    ).toHaveCount(0);
  }

  async decide(option: 'Deny' | 'Allow once'): Promise<void> {
    await this.page.getByRole('button', { name: option, exact: true }).click();
  }

  async expectResult(expected: 'denied' | 'blocked'): Promise<void> {
    const events = await this.fixture.waitForEvent('browser-tool-result');
    const result = events.at(-1);
    expect(result?.deniedByUser).toBe(expected === 'denied');
    expect(result?.blockedPrivateHost).toBe(expected === 'blocked');
    expect(this.fixture.readEvents().some((event) => event.event === 'browser-tool-missing')).toBe(
      false
    );
    await expect(
      this.page.getByText('Synthetic browser probe complete.', { exact: true })
    ).toBeVisible({ timeout: 60_000 });
  }
}
