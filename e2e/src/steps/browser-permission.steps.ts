import { Then, When } from '@cucumber/cucumber';
import type { MollyWorld } from '../support/world.js';

When('Agent 请求浏览本机地址', async function (this: MollyWorld) {
  await this.browserPermissionPage!.requestPrivateNavigation();
});

Then('浏览工具拒绝本机地址且没有暴露页面', async function (this: MollyWorld) {
  await this.browserPermissionPage!.expectBlockedWithoutPrompt();
});
