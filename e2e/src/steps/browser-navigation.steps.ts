import { Then, When } from '@cucumber/cucumber';
import type { MollyWorld } from '../support/world.js';

When('Agent 请求浏览本机合成页面', async function (this: MollyWorld) {
  await this.browserNavigationPage!.requestLocalNavigation();
});

Then('浏览工具返回本机页面与快照且没有权限提示', async function (this: MollyWorld) {
  await this.browserNavigationPage!.expectLocalPageWithoutPrompt();
});

Then('Browser 面板在面板关闭时自动展开且页面没有被重新加载', async function (this: MollyWorld) {
  await this.browserNavigationPage!.expectBrowserPanelRevealedWithoutReload();
});
