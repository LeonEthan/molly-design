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
  this.activeAcpEvent = await this.sessionPage!.createHeldSession();
});

When('用户停止当前 Agent', async function (this: MollyWorld) {
  await this.sessionPage!.stopHeldSession(this.activeAcpEvent!);
});

Then('关闭 Session 后 Agent 进程被释放', async function (this: MollyWorld) {
  await this.sessionPage!.archiveAndDeleteSession(this.activeAcpEvent!);
  await this.harness!.capturePostGcSnapshot();
});

Given('已注册包含大型变更的合成项目', async function (this: MollyWorld) {
  this.reviewFixture = createSyntheticReviewRepository();
  const project = await this.reviewPage!.registerLocalProject(this.reviewFixture.rootPath);
  await this.workPage!.selectLocalProject(project.name);
});

When('用户创建 Session 并打开全部变更', async function (this: MollyWorld) {
  this.activeAcpEvent = await this.sessionPage!.createCompletedSession();
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
  await this.sessionPage!.archiveAndDeleteSession(this.activeAcpEvent!);
  await this.harness!.capturePostGcSnapshot();
});

Given('已添加干净的合成 Git 项目', async function (this: MollyWorld) {
  await this.workPage!.addLocalProject(
    this.workFixture!.projectRoot,
    this.workFixture!.projectName
  );
  await this.workPage!.selectAgent('Deterministic E2E Agent');
});

When('用户打开已有 worktree Session 并启动 Terminal', async function (this: MollyWorld) {
  const promptEnds = this.workFixture!.readAcpEvents().filter(
    (event) => event.event === 'prompt-end'
  ).length;
  await this.workPage!.startLegacyWorktreeSession(
    this.workFixture!,
    'Exercise legacy Work lifecycle [SCOUT:REPLY]'
  );
  const completed = await this.workFixture!.waitForAcpEvent('prompt-end', promptEnds + 1);
  this.activeAcpEvent = completed.at(-1)!;
  const terminalCommand = process.platform === 'win32'
    ? 'cmd.exe /d /c echo lody-terminal-rea^dy'
    : "printf 'lody-terminal-%s\\n' ready";
  await this.workPage!.openTerminalAndRun(terminalCommand, 'lody-terminal-ready');
  this.workResources = await this.workPage!.captureResources();
});

Then('永久删除后 Work 进程、终端和 worktree 被释放', async function (this: MollyWorld) {
  await this.workPage!.archiveAndDeletePermanently(this.workResources!);
  await this.workPage!.expectResourcesReleased(this.workResources!, [this.activeAcpEvent!.pid]);
  expect(this.workFixture!.readAcpEvents()).toContainEqual(
    expect.objectContaining({ event: 'prompt-end', stopReason: 'end_turn' })
  );
  await this.harness!.capturePostGcSnapshot();
});
