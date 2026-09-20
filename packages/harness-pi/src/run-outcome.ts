import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { HarnessRunOutcome } from '@molly/shared/embedded-harness';

/** Progress is not a commit receipt. One tracker belongs to one accepted user task. */
export class NativeRunOutcome {
  private settled = false;
  private ended = false;
  private cancelled = false;
  private stopReason: string | undefined;
  private readonly tools = new Set<string>();

  accept(event: AgentSessionEvent): void {
    switch (event.type) {
      case 'agent_start':
        this.settled = false;
        this.ended = false;
        this.stopReason = undefined;
        break;
      case 'tool_execution_start':
        this.tools.add(event.toolCallId);
        break;
      case 'tool_execution_end':
        this.tools.delete(event.toolCallId);
        break;
      case 'message_end':
        if (event.message.role === 'assistant') this.stopReason = event.message.stopReason;
        break;
      case 'agent_end':
        this.ended = !event.willRetry;
        break;
      case 'agent_settled':
        this.settled = true;
        break;
    }
  }

  cancel(): void {
    this.cancelled = true;
  }

  get isCancelled(): boolean {
    return this.cancelled;
  }

  finish(nativeEndEntryId: string | null): HarnessRunOutcome {
    if (this.cancelled || this.stopReason === 'aborted') return { status: 'cancelled' };
    if (this.stopReason === 'error') return { status: 'failed', errorCode: 'native_model_error' };
    if (!this.settled || !this.ended || this.tools.size !== 0 || !nativeEndEntryId) {
      return { status: 'interrupted', reason: 'native_settlement_missing' };
    }
    if (this.stopReason !== 'stop')
      return { status: 'interrupted', reason: 'native_response_incomplete' };
    return { status: 'completed', nativeEndEntryId };
  }
}
