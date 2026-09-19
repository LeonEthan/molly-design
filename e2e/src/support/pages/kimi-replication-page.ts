import { expect, type Page } from '@playwright/test';
import type { ElectronHarness } from '../electron-harness.js';
import { OnboardingPage } from './onboarding-page.js';

/** Real Kimi acceptance only; no canned response, provider server or model stub. */
export class KimiReplicationPage {
  constructor(readonly harness: ElectronHarness) {}
  get page(): Page {
    if (!this.harness.page) throw Error('Desktop is not running');
    return this.harness.page;
  }
  private async selectRunConfigurationChoice(
    section: 'Model' | 'Reasoning',
    choice: string
  ): Promise<void> {
    const page = this.page;
    const runConfiguration = page.getByRole('button', {
      name: 'Run configuration',
      exact: true,
    });
    await expect
      .poll(
        async () => {
          await page.keyboard.press('Escape');
          await runConfiguration.click();
          await page.getByRole('menuitem', { name: new RegExp(`^${section} `) }).click();
          const option = page.getByRole('menuitemradio', { name: choice, exact: true });
          if (!(await option.isVisible())) return false;
          try {
            await option.click({ timeout: 5_000 });
          } catch (error) {
            if (error instanceof Error && /detached|Timeout/.test(error.message)) return false;
            throw error;
          }
          return (await option.getAttribute('aria-checked')) === 'true';
        },
        {
          message: `Select ${section.toLowerCase()} ${choice} after the runtime catalog settles`,
          timeout: 120_000,
        }
      )
      .toBe(true);
    await page.keyboard.press('Escape');
  }
  async configure(): Promise<void> {
    const page = this.page;
    await new OnboardingPage(page).waitForLocalBootstrap();
    await new OnboardingPage(page).skipConfigurationAndEnterProduct();
    await page.getByRole('button', { name: 'Go to Agent Settings', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Add provider', exact: true }).first()
    ).toBeVisible();
    await page.getByRole('button', { name: 'Add provider', exact: true }).first().click();
    await page.getByRole('option', { name: 'Kimi Code', exact: true }).click();
    await page.locator('#agent-config-name').fill('Golden Kimi');
    const download = page.getByRole('button', { name: 'Download agent', exact: true });
    // Provider creation uses the normal managed-runtime installation/probe lifecycle.
    if (await download.isVisible()) {
      await download.click();
      await expect(page.getByRole('button', { name: 'Downloading…', exact: true })).toBeHidden({
        timeout: 180_000,
      });
      await expect(download).toBeHidden({ timeout: 180_000 });
    }
    await expect(page.getByRole('button', { name: 'Create', exact: true })).toBeEnabled({
      timeout: 180_000,
    });
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByText('Go to Agent Settings', { exact: true })).toBeHidden({
      timeout: 120_000,
    });
    await expect(page.locator('#chat-prompt')).toBeEditable({ timeout: 120_000 });
    await this.selectRunConfigurationChoice('Model', 'K3');
    await this.selectRunConfigurationChoice('Reasoning', 'Thinking High');
    await expect(page.getByRole('button', { name: 'Run configuration', exact: true })).toHaveText(
      /K3\s*·?\s*Thinking High/
    );
  }
  async send(reference: string): Promise<string> {
    await this.page.locator('input[type=file]').setInputFiles(reference);
    await this.page.locator('#chat-prompt').fill('复刻这个设计');
    await this.page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(this.page).toHaveURL(/#\/local\/sessions\/[^/?#]+(?:\?.*)?$/, {
      timeout: 120_000,
    });
    return decodeURIComponent(this.page.url().split('/sessions/')[1]!.split('?')[0]!);
  }
  async ipc<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
    // Fixed public IPC methods; serialization here is JS source, never shell interpolation.
    return this.page.evaluate<T>(
      `window.ipc.invoke(${JSON.stringify(method)}, ...${JSON.stringify(args)})`
    );
  }
  async canvas(artworkId: string): Promise<Page> {
    let selected: Page | undefined;
    await expect
      .poll(
        async () => {
          const app = this.harness.app;
          if (!app) return false;
          const visible = await app.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows().flatMap((w) =>
              w.contentView.children.flatMap((v) =>
                'webContents' in v &&
                v.getVisible() &&
                v.getBounds().x + v.getBounds().width > 0 &&
                v.getBounds().y + v.getBounds().height > 0
                  ? [(v.webContents as Electron.WebContents).getURL()]
                  : []
              )
            )
          );
          const matches = app
            .context()
            .pages()
            .filter((p) => {
              if (p.isClosed() || !visible.includes(p.url())) return false;
              try {
                return new URL(p.url()).searchParams.get('ws') === artworkId;
              } catch {
                return false;
              }
            });
          selected = matches.length === 1 ? matches[0] : undefined;
          return (
            !!selected &&
            (await selected.evaluate('!!window.molly?.state && !window.molly.state().readonly'))
          );
        },
        { timeout: 60_000 }
      )
      .toBe(true);
    return selected!;
  }
  async export(artworkId: string, format: 'png' | 'jpeg', destination: string): Promise<void> {
    const app = this.harness.app;
    if (!app) throw Error('Desktop is not running');
    await app.evaluate(({ dialog }, file) => {
      const state = globalThis as typeof globalThis & {
        goldenSaveDialog?: typeof dialog.showSaveDialog;
      };
      state.goldenSaveDialog = dialog.showSaveDialog;
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, destination);
    try {
      await this.ipc('design.export', artworkId, format, 'Golden replication');
    } finally {
      await app.evaluate(({ dialog }) => {
        const state = globalThis as typeof globalThis & {
          goldenSaveDialog?: typeof dialog.showSaveDialog;
        };
        if (state.goldenSaveDialog) dialog.showSaveDialog = state.goldenSaveDialog;
        delete state.goldenSaveDialog;
      });
    }
  }
  async reopen(artworkId: string): Promise<void> {
    await this.harness.restart();
    await this.page.evaluate((id) => {
      window.location.hash = `/local/sessions/${encodeURIComponent(id)}`;
    }, artworkId);
    await expect(this.page).toHaveURL(/#\/local\/sessions\/[^/?#]+(?:\?.*)?$/, {
      timeout: 120_000,
    });
    await this.canvas(artworkId);
  }
}
