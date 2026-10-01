import type { AgentSideConnection, SessionUpdate } from '@agentclientprotocol/sdk';
import type { Usage } from '@earendil-works/pi-ai';
import type {
  AgentSession,
  AgentSessionEvent,
  SessionEntry,
} from '@earendil-works/pi-coding-agent';
import {
  LODY_EXTENSION_METHODS,
  SessionUsageAccumulator,
  type LodyActivityMeta,
  type ModelUsage,
  type SessionUsageUpdate,
} from 'acp-extension-core';

type UsageSession = Pick<AgentSession, 'sessionManager' | 'getContextUsage'>;
type UsagePeer = Pick<AgentSideConnection, 'sessionUpdate'> &
  Partial<Pick<AgentSideConnection, 'extNotification'>>;
type Activity = { id: string; meta: LodyActivityMeta };

function nonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function modelUsage(usage: Usage): ModelUsage | undefined {
  if (![usage.input, usage.output, usage.cacheRead, usage.cacheWrite].every(nonnegative))
    return undefined;
  if (
    usage.reasoning !== undefined &&
    (!nonnegative(usage.reasoning) || usage.reasoning > usage.output)
  )
    return undefined;
  return {
    inputTokens: usage.input,
    outputTokens: usage.output - (usage.reasoning ?? 0),
    cacheReadInputTokens: usage.cacheRead,
    cacheCreationInputTokens: usage.cacheWrite,
    ...(usage.reasoning === undefined ? {} : { reasoningOutputTokens: usage.reasoning }),
    ...(nonnegative(usage.cost.total) && usage.cost.total > 0 ? { costUSD: usage.cost.total } : {}),
  };
}

function entryUsage(entry: SessionEntry): Record<string, ModelUsage> | undefined {
  let model: string;
  let usage: Usage;
  if (entry.type === 'usage') {
    model = `${entry.provider}/${entry.model}`;
    usage = entry.usage;
  } else if (entry.type === 'message' && entry.message.role === 'assistant') {
    model = `${entry.message.provider}/${entry.message.model}`;
    usage = entry.message.usage;
  } else if (
    entry.type === 'message' &&
    entry.message.role === 'toolResult' &&
    entry.message.usage
  ) {
    model = 'unknown';
    usage = entry.message.usage;
  } else if ((entry.type === 'compaction' || entry.type === 'branch_summary') && entry.usage) {
    model = 'unknown';
    usage = entry.usage;
  } else {
    return undefined;
  }
  const row = modelUsage(usage);
  return row ? { [model]: row } : undefined;
}

export class PiAcpUsage {
  private readonly accumulator = new SessionUsageAccumulator();
  private readonly sessionId: string;
  private baseline: SessionUsageUpdate | undefined;
  private context: string | undefined;
  private activitySequence = 0;
  private compaction: Activity | undefined;
  private retry: Activity | undefined;

  constructor(
    private readonly session: UsageSession,
    private readonly peer: UsagePeer
  ) {
    this.sessionId = session.sessionManager.getSessionId();
    for (const { entry, rows } of this.rows()) {
      this.baseline = this.accumulator.update(this.sessionId, entry.id, rows) ?? this.baseline;
    }
  }

  private rows() {
    const entries = this.session.sessionManager.getEntries();
    return entries.flatMap((entry) => {
      const rows = entryUsage(entry);
      return rows ? [{ entry, rows }] : [];
    });
  }

  async flush(): Promise<void> {
    if (this.session.sessionManager.getSessionId() !== this.sessionId)
      throw new Error('adapter_usage_session_changed');
    if (this.baseline) {
      const { delta: _delta, ...baseline } = this.baseline;
      await this.publish(baseline);
      this.baseline = undefined;
    }
    for (const { entry, rows } of this.rows()) {
      const update = this.accumulator.update(this.sessionId, entry.id, rows);
      if (update) {
        this.baseline = update;
        await this.publish(update);
        this.baseline = undefined;
      }
    }
    const context = this.session.getContextUsage();
    if (!context || !nonnegative(context.tokens) || !nonnegative(context.contextWindow)) return;
    const signature = JSON.stringify([context.tokens, context.contextWindow]);
    if (signature === this.context) return;
    await this.peer.sessionUpdate({
      sessionId: this.sessionId,
      update: { sessionUpdate: 'usage_update', used: context.tokens, size: context.contextWindow },
    });
    this.context = signature;
  }

  private async publish(update: SessionUsageUpdate): Promise<void> {
    await this.peer.extNotification?.(
      LODY_EXTENSION_METHODS.sessionUsageUpdate,
      update as unknown as Record<string, unknown>
    );
  }

  private start(meta: LodyActivityMeta): Activity {
    this.activitySequence += 1;
    return {
      id: `${this.sessionId}:activity:${this.session.sessionManager.getLeafId() ?? 'root'}:${this.activitySequence}`,
      meta,
    };
  }

  activity(event: AgentSessionEvent): SessionUpdate | undefined {
    if (event.type === 'compaction_start') {
      const tokens = this.session.getContextUsage()?.tokens;
      this.compaction = this.start({
        version: 1,
        kind: 'context_compaction',
        automatic: event.reason !== 'manual',
        ...(nonnegative(tokens) ? { usedTokensBefore: tokens } : {}),
      });
      return {
        sessionUpdate: 'tool_call',
        toolCallId: this.compaction.id,
        title: 'Compacting context',
        kind: 'other',
        status: 'in_progress',
        _meta: { lody: { activity: this.compaction.meta } },
      };
    }
    if (event.type === 'compaction_end' && this.compaction) {
      const activity = this.compaction;
      this.compaction = undefined;
      const after = event.result?.estimatedTokensAfter;
      const before = event.result?.tokensBefore;
      const failed = event.aborted || event.errorMessage !== undefined || !event.result;
      return {
        sessionUpdate: 'tool_call_update',
        toolCallId: activity.id,
        status: failed ? 'failed' : 'completed',
        _meta: {
          lody: {
            activity: {
              ...activity.meta,
              ...(nonnegative(before) ? { usedTokensBefore: before } : {}),
              ...(nonnegative(after) ? { usedTokensAfter: after } : {}),
              ...(failed
                ? { failureReason: event.aborted ? 'compaction_cancelled' : 'compaction_failed' }
                : {}),
            },
          },
        },
      };
    }
    if (event.type === 'auto_retry_start') {
      const continuing = this.retry !== undefined;
      this.retry ??= this.start({ version: 1, kind: 'retry', automatic: true });
      return {
        sessionUpdate: continuing ? 'tool_call_update' : 'tool_call',
        toolCallId: this.retry.id,
        title: 'Retrying model request',
        kind: 'other',
        status: 'in_progress',
        _meta: { lody: { activity: this.retry.meta } },
      };
    }
    if (event.type === 'auto_retry_end' && this.retry) {
      const activity = this.retry;
      this.retry = undefined;
      return {
        sessionUpdate: 'tool_call_update',
        toolCallId: activity.id,
        status: event.success ? 'completed' : 'failed',
        _meta: {
          lody: {
            activity: {
              ...activity.meta,
              ...(event.success ? {} : { failureReason: 'retry_failed' }),
            },
          },
        },
      };
    }
    return undefined;
  }
}
