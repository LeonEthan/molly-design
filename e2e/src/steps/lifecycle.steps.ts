import { Given, Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import type { MollyWorld } from '../support/world.js';

Given('已配置确定性 Agent 的隔离桌面', async function (this: MollyWorld) {
  await this.configureScriptedAgent();
});

When('用户创建一个持续运行的 Session', async function (this: MollyWorld) {
  this.activeRuntimeEvent = await this.sessionPage!.createHeldSession();
});

When('用户停止当前 Agent', async function (this: MollyWorld) {
  await this.sessionPage!.stopHeldSession(this.activeRuntimeEvent!);
});

Then('关闭 Session 后 Agent 进程被释放', async function (this: MollyWorld) {
  await this.sessionPage!.archiveAndDeleteSession();
  await this.harness!.capturePostGcSnapshot();
});

Given('已添加干净的合成 Git 项目', async function (this: MollyWorld) {
  await this.workPage!.addLocalProject(
    this.workFixture!.projectRoot,
    this.workFixture!.projectName
  );
});

When('用户在 Session 中完成回复', async function (this: MollyWorld) {
  this.activeRuntimeEvent = await this.sessionPage!.createCompletedSession(
    'Exercise work lifecycle [SCOUT:REPLY]'
  );
  this.workResources = await this.workPage!.captureResources();
});

Then('永久删除后 Session 资源被释放且项目目录保留', async function (this: MollyWorld) {
  await this.workPage!.archiveAndDeletePermanently(this.workResources!);
  await this.workPage!.expectResourcesReleased(this.workResources!);
  expect(this.workFixture!.readEvents()).toContainEqual(
    expect.objectContaining({ event: 'request-complete', mode: 'reply' })
  );
  await this.harness!.capturePostGcSnapshot();
});
