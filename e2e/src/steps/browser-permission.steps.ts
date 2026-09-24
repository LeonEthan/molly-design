import { Then, When } from '@cucumber/cucumber';
import type { MollyWorld } from '../support/world.js';

When('Agent 请求浏览本机地址', async function (this: MollyWorld) {
  await this.browserPermissionPage!.requestPrivateNavigation();
});

When('用户拒绝该浏览请求', async function (this: MollyWorld) {
  await this.browserPermissionPage!.decide('Deny');
});

When('用户仅批准这次浏览请求', async function (this: MollyWorld) {
  await this.browserPermissionPage!.decide('Allow once');
});

Then('浏览工具返回用户拒绝且没有暴露页面', async function (this: MollyWorld) {
  await this.browserPermissionPage!.expectResult('denied');
});

Then('浏览工具拒绝本机地址且没有暴露页面', async function (this: MollyWorld) {
  await this.browserPermissionPage!.expectResult('blocked');
});
