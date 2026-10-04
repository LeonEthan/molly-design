import { expect, type Page } from '@playwright/test';
import type { WorkSessionFixture } from '../fixtures/work-session-fixture.js';
import type { SessionPage } from './session-page.js';

export class BrowserNavigationPage {
  constructor(
    private readonly page: Page,
    private readonly session: SessionPage,
    private readonly fixture: WorkSessionFixture
  ) {}

  async requestLocalNavigation(): Promise<void> {
    await this.session.selectDeterministicModel();
    await this.page.locator('#chat-prompt').fill('Visit a local page [E2E:BROWSER:LOCAL]');
    await this.page.getByRole('button', { name: /^(Send|发送)$/u }).click();
    await expect(this.page).toHaveURL(/#\/local\/sessions\/[^/?#]+(?:\?.*)?$/u, {
      timeout: 60_000,
    });
    await this.fixture.waitForEvent('browser-tool-dispatched');
  }

  async expectLocalPageWithoutPrompt(): Promise<void> {
    const events = await this.fixture.waitForEvent('browser-tool-result');
    const result = events.at(-1);
    const outputPrefix = 'BROWSER_PROBE_RESULT=';
    const output = result?.resultText?.split('\n').find((line) => line.startsWith(outputPrefix));
    if (!output)
      throw new Error(`Browser probe returned no structured result: ${result?.resultText}`);
    const probe = JSON.parse(output.slice(outputPrefix.length));
    const expectedPage = {
      url: `http://127.0.0.1:${this.fixture.modelServerPort}/browser-fixture`,
      title: 'Synthetic local browser page',
    };
    expect(probe.navigation.isError).not.toBe(true);
    expect(probe.navigation.structuredContent).toEqual(expectedPage);
    expect(probe.snapshot.isError).not.toBe(true);
    expect(probe.snapshot.structuredContent).toMatchObject({ ...expectedPage, truncated: false });
    expect(probe.snapshot.structuredContent.snapshot).toContain(
      'Local navigation reached the native browser.'
    );
    await this.fixture.waitForEvent('browser-page-served');
    expect(this.fixture.readEvents().some((event) => event.event === 'browser-tool-missing')).toBe(
      false
    );
    await expect(
      this.page.getByText('Synthetic browser probe complete.', { exact: true })
    ).toBeVisible({ timeout: 60_000 });
    await expect(this.page.getByRole('button', { name: 'Deny', exact: true })).toHaveCount(0);
  }
}
