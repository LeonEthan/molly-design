import { Given, Then, When } from '@cucumber/cucumber';
import type { MollyWorld } from '../support/world.js';

Given('桌面已进入本地 workspace', async function (this: MollyWorld) {
  await this.onboarding!.waitForLocalBootstrap();
  await this.onboarding!.skipConfigurationAndEnterProduct();
});

When('用户打开网站账号设置', async function (this: MollyWorld) {
  await this.browserImportPage!.openWebsiteAccounts();
});

Then('设置页只保留一行说明、导入、清除与按网站列出的状态', async function (this: MollyWorld) {
  await this.browserImportPage!.expectShortenedSettings();
});

When('用户打开从浏览器导入对话框', async function (this: MollyWorld) {
  await this.browserImportPage!.openImportDialog();
});

Then('对话框在读取配置前说明权限并提供设置入口', async function (this: MollyWorld) {
  await this.browserImportPage!.expectPermissionGuideBeforeRead();
});

When('用户取消导入', async function (this: MollyWorld) {
  await this.browserImportPage!.closeWithoutImporting();
});
