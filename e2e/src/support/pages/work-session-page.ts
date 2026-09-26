import { existsSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';

export type WorkSessionResources = {
  sessionId: string;
  projectRoot: string;
};

export class WorkSessionPage {
  private projectRoot = '';

  constructor(private readonly page: Page) {}

  async addLocalProject(
    rootPath: string,
    projectName: string,
    machineName?: string
  ): Promise<void> {
    this.projectRoot = rootPath;
    await this.page.getByRole('button', { name: /^(Select a project|选择项目)$/u }).click();
    await this.page.getByRole('menuitem', { name: /^(Add a folder|添加文件夹)$/u }).click();

    const dialog = this.page.getByRole('dialog', { name: /^(Add a folder|添加文件夹)$/u });
    await expect(dialog).toBeVisible();
    const editPath = dialog.getByTitle(/^(Edit path|编辑路径)$/u);
    if (!(await editPath.isVisible())) {
      const machine = machineName
        ? dialog.getByText(machineName, { exact: true })
        : dialog.getByText(/^(Your machine|你的机器)$/u);
      await machine.click();
    }
    await expect(editPath).toBeVisible();
    await editPath.click();
    const pathInput = dialog.getByPlaceholder(/^(Type an absolute path|输入绝对路径)$/u);
    await pathInput.fill(rootPath);
    await pathInput.press('Enter');

    await expect(dialog.getByText(projectName, { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: /^(Add|添加)$/u }).click();
    await expect(dialog).toBeHidden();
    await expect(this.page.getByRole('button', { name: projectName, exact: true })).toBeVisible();
  }

  async selectLocalProject(projectName: string): Promise<void> {
    const selected = this.page.getByRole('button', { name: projectName, exact: true });
    if (await selected.isVisible()) return;
    await this.page.getByRole('button', { name: /^(Select a project|选择项目)$/u }).click();
    await this.page.getByPlaceholder(/^(Search projects|搜索项目)$/u).fill(projectName);
    await this.page.getByRole('menuitem', { name: projectName, exact: true }).click();
    await expect(selected).toBeVisible();
  }

  async startSession(prompt: string): Promise<string> {
    await this.page.locator('#chat-prompt').fill(prompt);
    await this.page.getByRole('button', { name: /^(Send|发送)$/u }).click();
    await expect(this.page).toHaveURL(/#\/local\/sessions\/[^?]+(?:\?.*)?$/u, { timeout: 60_000 });
    const match = /#\/local\/sessions\/([^?]+)/u.exec(this.page.url());
    if (!match?.[1]) throw new Error(`Unable to read Session id from ${this.page.url()}`);
    return decodeURIComponent(match[1]);
  }

  async captureResources(): Promise<WorkSessionResources> {
    const sessionId = this.currentSessionId();
    return {
      sessionId,
      projectRoot: this.projectRoot,
    };
  }

  async archiveAndDeletePermanently(resources: WorkSessionResources): Promise<void> {
    expect(this.currentSessionId()).toBe(resources.sessionId);
    await this.page
      .getByRole('button', { name: /^(More actions|更多操作)$/u })
      .last()
      .click();
    await this.page.getByRole('menuitem', { name: /^(Archive session|归档会话)$/u }).click();
    await expect(this.page).toHaveURL(/#\/local\/chat(?:\?.*)?$/u, { timeout: 30_000 });

    await this.page.evaluate((sessionId) => {
      window.location.hash = `/local/sessions/${encodeURIComponent(sessionId)}`;
    }, resources.sessionId);
    await expect(this.page).toHaveURL(
      new RegExp(`#\\/local\\/sessions\\/${resources.sessionId}(?:\\?.*)?$`, 'u')
    );
    await this.page
      .getByRole('button', { name: /^(More actions|更多操作)$/u })
      .last()
      .click();
    await this.page.getByRole('menuitem', { name: /^(Delete permanently|永久删除)$/u }).click();
    const dialog = this.page.getByRole('dialog', {
      name: /^(Delete permanently\?|确认永久删除？)$/u,
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /^(Delete permanently|永久删除)$/u }).click();
    await expect(this.page).toHaveURL(/#\/local\/chat(?:\?.*)?$/u, { timeout: 30_000 });
  }

  async expectResourcesReleased(resources: WorkSessionResources): Promise<void> {
    // Permanent delete releases Session resources but must never delete the
    // user's project directory.
    expect(existsSync(resources.projectRoot)).toBe(true);
  }

  private currentSessionId(): string {
    const match = /#\/local\/sessions\/([^?]+)/u.exec(this.page.url());
    if (!match?.[1]) throw new Error(`Expected a Session route, received ${this.page.url()}`);
    return decodeURIComponent(match[1]);
  }
}
