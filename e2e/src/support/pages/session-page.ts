import { expect, type Page } from '@playwright/test';
import { type ScriptedRuntimeEvent, WorkSessionFixture } from '../fixtures/work-session-fixture.js';

const CONNECTION_NAME = 'Deterministic E2E Model';
const MODEL_NAME = 'E2E Deterministic';
const MODEL_OPTION_NAME = `${CONNECTION_NAME} · ${MODEL_NAME}`;
const HELD_RESPONSE = 'Synthetic response started.';

export class SessionPage {
  constructor(
    private readonly page: Page,
    private readonly fixture: WorkSessionFixture
  ) {}

  /**
   * Seeds the bundled engine's only external wire through the real settings IPC:
   * one OpenAI-compatible connection backed by the fixture's scripted server.
   * Saving does not probe the endpoint, so this stays fully deterministic.
   */
  async seedDeterministicModelConnection(): Promise<void> {
    const port = this.fixture.modelServerPort;
    if (typeof port !== 'number') throw new Error('Scripted model server is not running');
    const saved = await this.page.evaluate(async (input) => {
      if (!window.ipc) throw new Error('Electron IPC is unavailable');
      return (await window.ipc.invoke('modelConnections.save', input)) as { id?: string };
    }, {
      providerPresetId: 'openai-compatible',
      displayName: CONNECTION_NAME,
      baseUrl: `http://127.0.0.1:${port}/v1`,
      enabled: true,
      customModels: [
        {
          modelId: 'e2e-deterministic',
          name: MODEL_NAME,
          input: ['text'],
          contextWindow: 128_000,
          maxTokens: 4_096,
          thinking: ['off'],
          // The design session always registers host tools, and the engine
          // rejects catalog models that declare no tool-call support
          // (harness_model_tools_unsupported). The scripted server simply
          // never emits tool_calls, so no tool ever executes.
          toolCalls: true,
          usageInStreaming: false,
          maxTokensField: 'max_tokens',
        },
      ],
      apiKey: 'e2e-deterministic-key',
    });
    expect(saved?.id, 'The deterministic model connection was not saved').toEqual(
      expect.any(String)
    );
  }

  /** The draft composer lists the connection only after the daemon re-projects it. */
  async selectDeterministicModel(): Promise<void> {
    await this.page
      .getByRole('button', { name: /^(Run configuration|运行设置)$/u })
      .first()
      .click();
    const modelTrigger = this.page.getByRole('menuitem', { name: /^(Model|模型)/u });
    await expect(modelTrigger).toBeVisible({ timeout: 30_000 });
    await modelTrigger.hover();
    // The option's accessible name appends the raw model id on a second line.
    const option = this.page
      .getByRole('menuitemradio')
      .filter({ hasText: MODEL_OPTION_NAME });
    await expect(option).toBeVisible({ timeout: 60_000 });
    await option.click();
    await expect(option).toHaveAttribute('aria-checked', 'true');
    await this.page.keyboard.press('Escape');
  }

  async createHeldSession(
    prompt = 'Exercise deterministic lifecycle [SCOUT:HOLD]'
  ): Promise<ScriptedRuntimeEvent> {
    await this.selectDeterministicModel();
    await this.page.locator('#chat-prompt').fill(prompt);
    await this.page.getByRole('button', { name: /^(Send|发送)$/u }).click();
    await expect(this.page).toHaveURL(/#\/local\/sessions\/[^/?#]+(?:\?.*)?$/u, {
      timeout: 60_000,
    });
    await expect(this.page.getByText(HELD_RESPONSE, { exact: true })).toBeVisible({
      timeout: 60_000,
    });
    await expect(this.page.getByRole('button', { name: /^(Stop|停止)$/u })).toBeVisible();

    const started = await this.fixture.waitForEvent('request-start');
    const waiting = [...started].reverse().find((event) => event.mode === 'hold');
    expect(waiting, 'The scripted model server did not observe the held prompt').toBeDefined();
    expect(waiting?.requestId).toEqual(expect.any(String));
    return waiting!;
  }

  async createCompletedSession(
    prompt = 'Exercise deterministic reply [SCOUT:REPLY]'
  ): Promise<ScriptedRuntimeEvent> {
    const replyCompletes = () =>
      this.fixture
        .readEvents()
        .filter((event) => event.event === 'request-complete' && event.mode === 'reply');
    const priorCount = replyCompletes().length;
    await this.selectDeterministicModel();
    await this.page.locator('#chat-prompt').fill(prompt);
    await this.page.getByRole('button', { name: /^(Send|发送)$/u }).click();
    await expect(this.page).toHaveURL(/#\/local\/sessions\/[^/?#]+(?:\?.*)?$/u, {
      timeout: 60_000,
    });
    await expect(this.page.getByText(/Synthetic response complete\./u).first()).toBeVisible({
      timeout: 60_000,
    });
    await expect
      .poll(() => replyCompletes().length, { timeout: 30_000, intervals: [50, 100, 250, 500] })
      .toBeGreaterThanOrEqual(priorCount + 1);
    return replyCompletes().at(-1)!;
  }

  async stopHeldSession(waiting: ScriptedRuntimeEvent): Promise<void> {
    await this.page.getByRole('button', { name: /^(Stop|停止)$/u }).click();
    // Stopping the turn aborts the engine's fetch; the scripted server observes
    // the socket close as the honest teardown signal.
    await this.waitForRequestEvent('request-cancelled', waiting);
    await expect(this.page.getByRole('button', { name: /^(Stop|停止)$/u })).toBeHidden({
      timeout: 30_000,
    });
  }

  async archiveSessionAndWaitForRuntimeExit(): Promise<void> {
    await this.page
      .getByRole('button', { name: /^(More actions|更多操作)$/u })
      .last()
      .click();
    await this.page.getByRole('menuitem', { name: /^(Archive session|归档会话)$/u }).click();
    await expect(this.page).toHaveURL(/#\/local\/chat(?:\?.*)?$/u, { timeout: 30_000 });
  }

  async archiveAndDeleteSession(): Promise<void> {
    const match = /#\/local\/sessions\/([^?]+)/u.exec(this.page.url());
    if (!match?.[1]) throw new Error(`Expected a Session route, received ${this.page.url()}`);
    const sessionId = decodeURIComponent(match[1]);
    await this.archiveSessionAndWaitForRuntimeExit();
    await this.page.evaluate((id) => {
      window.location.hash = `/local/sessions/${encodeURIComponent(id)}`;
    }, sessionId);
    const actions = this.page.getByRole('button', { name: /^(More actions|更多操作)$/u }).last();
    await expect(actions).toBeVisible({ timeout: 30_000 });
    await actions.click();
    await this.page.getByRole('menuitem', { name: /^(Delete permanently|永久删除)$/u }).click();
    const dialog = this.page.getByRole('dialog', {
      name: /^(Delete permanently\?|确认永久删除？)$/u,
    });
    await dialog.getByRole('button', { name: /^(Delete permanently|永久删除)$/u }).click();
    await expect(this.page).toHaveURL(/#\/local\/chat(?:\?.*)?$/u, { timeout: 30_000 });
    await expect(this.page.locator('#chat-prompt')).toBeEditable({ timeout: 30_000 });
  }

  private async waitForRequestEvent(
    event: string,
    request: ScriptedRuntimeEvent
  ): Promise<ScriptedRuntimeEvent> {
    let match: ScriptedRuntimeEvent | undefined;
    await expect
      .poll(
        () => {
          match = this.fixture
            .readEvents()
            .find((entry) => entry.event === event && entry.requestId === request.requestId);
          return match !== undefined;
        },
        { timeout: 30_000, intervals: [50, 100, 250, 500] }
      )
      .toBe(true);
    return match!;
  }
}

export { CONNECTION_NAME as SCRIPTED_MODEL_CONNECTION_NAME };
