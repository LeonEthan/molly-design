import type * as acp from '@agentclientprotocol/sdk';
import { RequestError } from '@agentclientprotocol/sdk';
import type {
  AgentSession,
  AgentSessionEvent,
  ExtensionUIContext,
} from '@earendil-works/pi-coding-agent';
import { createExtensionUI } from './extension-ui';
import { describeToolCall } from './tool-presentation';
import { acpPromptToPiMessage } from './translate/prompt';
import { formatToolContent } from './translate/tool-content';
import { z } from 'zod';
import {
  HARNESS_QUESTION_DISMISS_METHOD,
  HarnessQuestionIdentitySchema,
} from '@molly/shared/embedded-harness';
import type { PiAcpHost } from './host';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { PiAcpUsage } from './usage';

export type AdapterPeer = Pick<acp.AgentSideConnection, 'sessionUpdate'> &
  Partial<Pick<acp.AgentSideConnection, 'request' | 'extMethod' | 'extNotification'>>;

export class PiAcpSession {
  private readonly lifetime = new AbortController();
  private readonly dialogs = new Map<
    string,
    {
      controller: AbortController;
      retired: Promise<void>;
      finish(error?: Error): void;
    }
  >();
  private readonly unsubscribe: () => void;
  private run?: {
    controller: AbortController;
    started: boolean;
    settled: boolean;
    stopReason?: string;
    finalAssistant?: AssistantMessage;
    tools: Set<string>;
    finished: Promise<void>;
    finish(): void;
  };
  private emits: Promise<void> = Promise.resolve();
  private deliveryFailed = false;
  private extensionFailed = false;
  private shutdownFailed = false;
  private streamedText = false;
  private closed = false;
  private disposing?: Promise<void>;
  private readonly uiBridge;
  private readonly usage: PiAcpUsage;

  constructor(
    readonly piSession: AgentSession,
    private readonly conn: AdapterPeer,
    private readonly supportsForms: boolean,
    private readonly releaseWriter: () => Promise<void> = async () => {},
    private readonly host?: PiAcpHost
  ) {
    this.usage = new PiAcpUsage(piSession, conn);
    this.unsubscribe = piSession.subscribe((event) => this.handlePiEvent(event));
    this.uiBridge = createExtensionUI({
      currentSignal: () =>
        this.run?.controller.signal ?? (this.host ? undefined : this.lifetime.signal),
      open: async (question, signal) => {
        if (!this.supportsForms || !this.conn.request)
          throw new Error('pi_acp_form_ui_unavailable');
        const id = question.id!;
        const snapshot = this.host?.activeSnapshot;
        if (this.host && (!snapshot || !this.conn.extMethod))
          throw new Error('pi_acp_host_dialog_unavailable');
        const controller = new AbortController();
        let finish = (_error?: Error) => {};
        const retired = new Promise<void>((resolve, reject) => {
          finish = (error) => (error ? reject(error) : resolve());
        });
        void retired.catch(() => undefined);
        this.dialogs.set(id, { controller, retired, finish });
        const response = await this.conn.request(
          'elicitation/create',
          {
            mode: 'form',
            sessionId: this.sessionId,
            toolCallId: id,
            message: question.question,
            requestedSchema: {
              type: 'object',
              properties: {
                [id]: {
                  type: 'string',
                  title: question.header,
                  ...(question.options.length
                    ? { enum: question.options.map((option) => option.label) }
                    : {}),
                },
              },
              required: [id],
            },
            _meta: {
              lody: { elicitation: { version: 1, autoResolveAfterSeconds: null } },
              ...(snapshot
                ? {
                    mollyQuestion: HarnessQuestionIdentitySchema.parse({
                      version: 1,
                      questionId: id,
                      runId: snapshot.runId,
                      runtimeEpoch: snapshot.runtimeEpoch,
                    }),
                  }
                : {}),
            },
          },
          { cancellationSignal: AbortSignal.any([signal, controller.signal]) }
        );
        if (signal.aborted || response.action !== 'accept') return undefined;
        const value = z.record(z.string(), z.unknown()).optional().parse(response.content)?.[id];
        if (value !== undefined && typeof value !== 'string')
          throw new Error('pi_acp_invalid_dialog_answer');
        return value;
      },
      dismiss: async (id) => {
        const dialog = this.dialogs.get(id);
        dialog?.controller.abort();
        let deadline: ReturnType<typeof setTimeout> | undefined;
        try {
          const snapshot = this.host?.activeSnapshot;
          if (snapshot) {
            const response = await Promise.race([
              this.conn.extMethod!(HARNESS_QUESTION_DISMISS_METHOD, {
                sessionId: this.sessionId,
                request: {
                  version: 1,
                  questionId: id,
                  runId: snapshot.runId,
                  runtimeEpoch: snapshot.runtimeEpoch,
                },
              }),
              new Promise<never>((_resolve, reject) => {
                deadline = setTimeout(
                  () => reject(new Error('pi_acp_dialog_retirement_timeout')),
                  5000
                );
              }),
            ]);
            if (response.version !== 1 || response.dismissed !== true)
              throw new Error('pi_acp_host_dialog_retirement_failed');
          }
          dialog?.finish();
        } catch {
          this.extensionFailed = true;
          dialog?.finish(new Error('pi_acp_dialog_retirement_failed'));
          throw new Error('pi_acp_dialog_retirement_failed');
        } finally {
          clearTimeout(deadline);
          this.dialogs.delete(id);
        }
      },
      notify: (message) =>
        this.emit({
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: message },
        }),
    });
  }

  get sessionId(): string {
    return this.piSession.sessionManager.getSessionId();
  }

  get busy(): boolean {
    return this.run !== undefined || !this.piSession.isIdle;
  }

  get uiContext(): ExtensionUIContext {
    const ui = this.piSession.extensionRunner.getUIContext();
    return {
      ...ui,
      ...this.uiBridge.ui,
      editor: (title, prefill) =>
        this.uiBridge.ui.input(prefill ? `${title}\n\nCurrent text:\n${prefill}` : title),
      custom: async () => {
        throw new Error('pi_acp_custom_tui_unavailable');
      },
    };
  }

  failExtension(): void {
    this.extensionFailed = true;
    this.run?.controller.abort();
    void this.piSession.abort().catch(() => undefined);
  }

  failShutdown(): void {
    this.shutdownFailed = true;
  }

  async flush(): Promise<void> {
    await this.emits;
    if (this.deliveryFailed) throw new Error('pi_acp_delivery_failed');
    await this.usage.flush();
  }

  private emit(update: acp.SessionUpdate): void {
    this.emits = this.emits
      .then(async () => {
        if (this.closed) return;
        await this.conn.sessionUpdate({ sessionId: this.sessionId, update });
      })
      .catch(() => {
        this.deliveryFailed = true;
        this.run?.controller.abort();
        void this.piSession.abort().catch(() => undefined);
      });
  }

  private handlePiEvent(event: AgentSessionEvent): void {
    const activity = this.usage.activity(event);
    if (activity) this.emit(activity);
    if (event.type === 'agent_start' && this.run) {
      if (this.run.controller.signal.aborted || this.closed) {
        void this.piSession.abort().catch(() => undefined);
        throw new Error('pi_acp_prompt_cancelled');
      }
      this.run.started = true;
      this.run.settled = false;
      this.run.stopReason = undefined;
      this.run.finalAssistant = undefined;
    }
    if (event.type === 'agent_settled' && this.run) this.run.settled = true;
    if (event.type === 'message_start' && event.message.role === 'assistant')
      this.streamedText = false;
    if (event.type === 'message_update') {
      const delta = event.assistantMessageEvent;
      if (delta.type === 'text_delta' || delta.type === 'thinking_delta') {
        if (delta.type === 'text_delta') this.streamedText = true;
        this.emit({
          sessionUpdate:
            delta.type === 'text_delta' ? 'agent_message_chunk' : 'agent_thought_chunk',
          content: { type: 'text', text: delta.delta },
        });
      }
    }
    if (event.type === 'message_end' && event.message.role === 'assistant') {
      if (this.run) {
        this.run.stopReason = event.message.stopReason;
        this.run.finalAssistant = event.message;
      }
      if (!this.streamedText) {
        for (const block of event.message.content) {
          if (block.type === 'text')
            this.emit({ sessionUpdate: 'agent_message_chunk', content: block });
          if (block.type === 'thinking')
            this.emit({
              sessionUpdate: 'agent_thought_chunk',
              content: { type: 'text', text: block.thinking },
            });
        }
      }
    }
    if (event.type === 'tool_execution_start') {
      this.run?.tools.add(event.toolCallId);
      this.emit({
        sessionUpdate: 'tool_call',
        toolCallId: event.toolCallId,
        ...describeToolCall(event.toolName, event.args, this.piSession.sessionManager.getCwd()),
        status: 'in_progress',
      });
    }
    if (event.type === 'tool_execution_update' || event.type === 'tool_execution_end') {
      const finished = event.type === 'tool_execution_end';
      const result = finished ? event.result : event.partialResult;
      const isError = finished && event.isError;
      if (finished) this.run?.tools.delete(event.toolCallId);
      this.emit({
        sessionUpdate: 'tool_call_update',
        toolCallId: event.toolCallId,
        status: finished ? (isError ? 'failed' : 'completed') : 'in_progress',
        content: formatToolContent(event.toolName, result, isError),
        rawOutput: result,
      });
    }
  }

  async prompt(blocks: acp.ContentBlock[]): Promise<acp.PromptResponse> {
    if (this.closed || this.extensionFailed || this.deliveryFailed)
      throw new Error('pi_acp_session_unavailable');
    if (this.busy) throw RequestError.invalidRequest('A prompt is already running.');
    const { message, images } = acpPromptToPiMessage(blocks);
    if (images.length && !this.piSession.model?.input.includes('image'))
      throw RequestError.invalidParams('The selected model does not support images.');
    let finish = () => {};
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const run = {
      controller: new AbortController(),
      started: false,
      settled: false,
      tools: new Set<string>(),
      stopReason: undefined as string | undefined,
      finalAssistant: undefined as AssistantMessage | undefined,
      finished,
      finish,
    };
    this.run = run;
    let failed = false;
    try {
      try {
        await this.piSession.prompt(message, { images });
        await this.piSession.waitForIdle();
      } catch {
        failed = true;
        await this.piSession.abort();
      }
      await this.flush();
      if (this.extensionFailed) throw new Error('pi_acp_extension_failed');
      if (run.controller.signal.aborted || run.stopReason === 'aborted')
        return { stopReason: 'cancelled' };
      if (failed || run.stopReason === 'error') throw new Error('pi_acp_native_execution_failed');
      if (run.started && (!run.settled || run.tools.size))
        throw new Error('pi_acp_native_settlement_missing');
      if (run.started && run.stopReason !== 'stop' && run.stopReason !== 'length')
        throw new Error('pi_acp_native_response_incomplete');
      const stats = this.piSession.getSessionStats();
      const nativeEndEntryId = this.piSession.sessionManager
        .getEntries()
        .find((entry) => entry.type === 'message' && entry.message === run.finalAssistant)?.id;
      return {
        stopReason: run.stopReason === 'length' ? 'max_tokens' : 'end_turn',
        _meta: {
          piAcp: {
            execution: run.started ? 'inference' : 'handled',
            nativeEndEntryId,
            usage: {
              scope: 'native-session',
              tokens: stats.tokens,
              cost: stats.cost > 0 ? { amount: stats.cost, currency: 'USD' } : null,
            },
          },
        },
      };
    } finally {
      await this.finishRun(run);
    }
  }

  private async finishRun(run: NonNullable<PiAcpSession['run']>): Promise<void> {
    run.controller.abort();
    const dialogs = [...this.dialogs.values()];
    for (const dialog of dialogs) dialog.controller.abort();
    try {
      const retirements = await Promise.allSettled(dialogs.map((dialog) => dialog.retired));
      if (retirements.some((retirement) => retirement.status === 'rejected'))
        throw new Error('pi_acp_dialog_retirement_failed');
      await this.emits;
      if (this.extensionFailed) throw new Error('pi_acp_extension_failed');
    } finally {
      this.run = undefined;
      run.finish();
    }
  }

  async steer(blocks: acp.ContentBlock[], behavior: 'steer' | 'followUp'): Promise<string> {
    if (
      this.closed ||
      !this.run ||
      this.run.controller.signal.aborted ||
      this.extensionFailed ||
      this.deliveryFailed
    )
      throw RequestError.invalidRequest('No active prompt accepts queued input.');
    const { message, images } = acpPromptToPiMessage(blocks);
    if (images.length && !this.piSession.model?.input.includes('image'))
      throw RequestError.invalidParams('The selected model does not support images.');
    return behavior === 'steer'
      ? this.piSession.steer(message, images)
      : this.piSession.followUp(message, images);
  }

  async cancel(): Promise<void> {
    const run = this.run;
    run?.controller.abort();
    for (const dialog of this.dialogs.values()) dialog.controller.abort();
    this.piSession.clearQueue();
    await this.piSession.abort();
    this.piSession.clearQueue();
    await this.piSession.waitForIdle();
    await run?.finished;
    await this.emits;
  }

  retire(): void {
    this.closed = true;
    this.lifetime.abort();
    this.uiBridge.dispose();
    this.run?.controller.abort();
    for (const dialog of this.dialogs.values()) dialog.controller.abort();
    this.piSession.clearQueue();
  }

  dispose(): Promise<void> {
    this.disposing ??= this.shutdown();
    return this.disposing;
  }

  private async shutdown(): Promise<void> {
    this.retire();
    try {
      try {
        await this.cancel();
      } finally {
        await this.host?.waitForRun();
        await this.piSession.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
      }
    } finally {
      this.unsubscribe();
      try {
        this.piSession.dispose();
      } finally {
        await this.releaseWriter();
      }
    }
    if (this.shutdownFailed) throw new Error('pi_acp_cleanup_failed');
  }
}
