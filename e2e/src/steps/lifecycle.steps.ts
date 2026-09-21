import { Given, Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import type { MollyWorld } from '../support/world.js';
import {
  createSyntheticReviewRepository,
  PRIMARY_REVIEW_DIFF_PATH,
  SECONDARY_REVIEW_DIFF_PATH,
} from '../support/fixtures/synthetic-review-repository.js';

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

Given('已注册包含大型变更的合成项目', async function (this: MollyWorld) {
  this.reviewFixture = createSyntheticReviewRepository();
  const project = await this.reviewPage!.registerLocalProject(this.reviewFixture.rootPath);
  await this.workPage!.selectLocalProject(project.name);
});

When('用户创建 Session 并打开全部变更', async function (this: MollyWorld) {
  this.activeRuntimeEvent = await this.sessionPage!.createCompletedSession();
  await this.reviewPage!.openChangesPanel(this.reviewFixture!.changedPaths);
});

When('用户切换大型 diff 并隐藏再恢复 Review', async function (this: MollyWorld) {
  await this.reviewPage!.openChangedFile(
    PRIMARY_REVIEW_DIFF_PATH,
    this.reviewFixture!.changedPaths
  );
  await this.reviewPage!.hide();
  await this.reviewPage!.show();
  await this.reviewPage!.openChangedFile(
    SECONDARY_REVIEW_DIFF_PATH,
    this.reviewFixture!.changedPaths
  );
});

Then('关闭 Review 和 Session 后相关视图被释放', async function (this: MollyWorld) {
  await this.reviewPage!.closeDiffViewer();
  await this.reviewPage!.closeChangesPanel();
  await this.sessionPage!.archiveAndDeleteSession();
  await this.harness!.capturePostGcSnapshot();
});

Given('已添加干净的合成 Git 项目', async function (this: MollyWorld) {
  await this.workPage!.addLocalProject(
    this.workFixture!.projectRoot,
    this.workFixture!.projectName
  );
});

When('用户在 Session 中完成回复并启动 Terminal', async function (this: MollyWorld) {
  this.activeRuntimeEvent = await this.sessionPage!.createCompletedSession(
    'Exercise work lifecycle [SCOUT:REPLY]'
  );
  const terminalCommand = process.platform === 'win32'
    ? 'cmd.exe /d /c echo lody-terminal-rea^dy'
    : "printf 'lody-terminal-%s\\n' ready";
  await this.workPage!.openTerminalAndRun(terminalCommand, 'lody-terminal-ready');
  this.workResources = await this.workPage!.captureResources();
});

Then('永久删除后终端被释放且项目目录保留', async function (this: MollyWorld) {
  await this.workPage!.archiveAndDeletePermanently(this.workResources!);
  await this.workPage!.expectResourcesReleased(this.workResources!);
  expect(this.workFixture!.readEvents()).toContainEqual(
    expect.objectContaining({ event: 'request-complete', mode: 'reply' })
  );
  await this.harness!.capturePostGcSnapshot();
});
