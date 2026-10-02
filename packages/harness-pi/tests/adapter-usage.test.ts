import type { SessionNotification } from '@agentclientprotocol/sdk';
import type { AssistantMessage, Usage } from '@earendil-works/pi-ai';
import { SessionManager, type ContextUsage } from '@earendil-works/pi-coding-agent';
import { LODY_EXTENSION_METHODS, type SessionUsageUpdate } from 'acp-extension-core';
import { describe, expect, it } from 'vitest';
import { PiAcpUsage } from '../src/usage';

function usage(input: number, cost = 0): Usage {
  return {
    input,
    output: 12,
    cacheRead: 3,
    cacheWrite: 4,
    totalTokens: input + 19,
    reasoning: 5,
    cost: { input: cost, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
  };
}

function assistant(provider: string, model: string, nativeUsage: Usage): AssistantMessage {
  return {
    role: 'assistant',
    provider,
    model,
    api: 'openai-completions',
    content: [{ type: 'text', text: 'Synthetic result' }],
    usage: nativeUsage,
    stopReason: 'stop',
    timestamp: 0,
  };
}

function fixture(manager = SessionManager.inMemory('/synthetic-project'), withCore = true) {
  const notifications: { method: string; params: Record<string, unknown> }[] = [];
  const updates: SessionNotification[] = [];
  let context: ContextUsage | undefined;
  const session = { sessionManager: manager, getContextUsage: () => context };
  const projection = new PiAcpUsage(session, {
    sessionUpdate: async (update) => {
      updates.push(update);
    },
    ...(withCore
      ? {
          extNotification: async (method: string, params: Record<string, unknown>) => {
            notifications.push({ method, params });
          },
        }
      : {}),
  });
  return {
    manager,
    projection,
    updates,
    notifications,
    setContext: (value: ContextUsage | undefined) => {
      context = value;
    },
    lastUsage: () => notifications.at(-1)?.params as SessionUsageUpdate | undefined,
  };
}

describe('native ACP usage projection', () => {
  it('restores all native accounting including compacted entries without replaying deltas', async () => {
    const manager = SessionManager.inMemory('/synthetic-project');
    manager.appendModelChange('provider', 'model');
    const before = manager.appendMessage(assistant('provider', 'model', usage(100, 0.1)));
    manager.appendCompaction('Summary', before, 119, undefined, false, usage(20, 0.02));
    manager.appendMessage(assistant('provider', 'model', usage(50, 0.05)));
    const f = fixture(manager);
    await f.projection.flush();
    expect(f.notifications).toEqual([
      {
        method: LODY_EXTENSION_METHODS.sessionUsageUpdate,
        params: expect.objectContaining({
          sessionId: manager.getSessionId(),
          modelUsage: {
            'provider/model': expect.objectContaining({
              inputTokens: 150,
              outputTokens: 14,
              reasoningOutputTokens: 10,
              cacheReadInputTokens: 6,
              cacheCreationInputTokens: 8,
            }),
            unknown: expect.objectContaining({ inputTokens: 20 }),
          },
        }),
      },
    ]);
    expect(f.lastUsage()?.delta).toBeUndefined();
    expect(f.lastUsage()?.modelUsage?.['provider/model']?.costUSD).toBeCloseTo(0.15);
    expect(f.lastUsage()?.modelUsage?.unknown?.costUSD).toBe(0.02);
    const snapshot = structuredClone(f.notifications);
    await f.projection.flush();
    expect(f.notifications).toEqual(snapshot);
  });

  it('adds each native assistant, usage and compaction ID once across model switches', async () => {
    const f = fixture();
    f.manager.appendModelChange('first', 'model');
    const first = f.manager.appendMessage(assistant('first', 'model', usage(10, 0.1)));
    await f.projection.flush();
    expect(f.lastUsage()?.delta?.usage.inputTokens).toBe(10);
    f.manager.appendUsage('cache_warm', 'first', 'model', usage(2, 0.02));
    f.manager.appendModelChange('second', 'model');
    f.manager.appendCompaction('Summary', first, 29, undefined, false, usage(3, 0.03));
    await f.projection.flush();
    expect(f.lastUsage()?.modelUsage).toMatchObject({
      'first/model': { inputTokens: 12 },
      unknown: { inputTokens: 3, costUSD: 0.03 },
    });
    expect(f.lastUsage()?.modelUsage?.['second/model']).toBeUndefined();
    expect(f.lastUsage()?.modelUsage?.['first/model']?.costUSD).toBeCloseTo(0.12);
    expect(f.lastUsage()?.delta?.usage.inputTokens).toBe(3);
    const snapshot = structuredClone(f.notifications);
    await f.projection.flush();
    expect(f.notifications).toEqual(snapshot);
  });

  it('restores extraction usage without adding it to context or replaying a delta', async () => {
    const manager = SessionManager.inMemory('/synthetic-project');
    manager.appendMessage(assistant('provider', 'model', usage(23, 0.1)));
    manager.appendUsage('personal_memory_extraction', 'provider', 'model', usage(3, 0.015));
    const f = fixture(manager);
    await f.projection.flush();
    expect(f.lastUsage()).toMatchObject({
      modelUsage: { 'provider/model': { inputTokens: 26, costUSD: 0.115 } },
    });
    expect(f.lastUsage()?.delta).toBeUndefined();
    expect(manager.buildSessionContext().messages).toEqual([
      assistant('provider', 'model', usage(23, 0.1)),
    ]);
    const snapshot = structuredClone(f.notifications);
    await f.projection.flush();
    expect(f.notifications).toEqual(snapshot);
  });

  it('retains cumulative usage after notification failure without duplicating a delta', async () => {
    const manager = SessionManager.inMemory('/synthetic-project');
    const received: Record<string, unknown>[] = [];
    let disconnected = true;
    const projection = new PiAcpUsage(
      { sessionManager: manager, getContextUsage: () => undefined },
      {
        sessionUpdate: async () => {},
        extNotification: async (_method, params) => {
          if (disconnected) throw new Error('synthetic_transport_disconnected');
          received.push(params);
        },
      }
    );
    manager.appendUsage('personal_memory_extraction', 'provider', 'model', usage(3, 0.015));
    await expect(projection.flush()).rejects.toThrow('synthetic_transport_disconnected');
    disconnected = false;
    await projection.flush();
    expect(received).toEqual([
      expect.objectContaining({
        modelUsage: {
          'provider/model': expect.objectContaining({ inputTokens: 3, costUSD: 0.015 }),
        },
      }),
    ]);
    expect(received[0]?.delta).toBeUndefined();
    const snapshot = structuredClone(received);
    await projection.flush();
    expect(received).toEqual(snapshot);
  });

  it('does not infer summary request identity from virtual selection or branch history', async () => {
    const manager = SessionManager.inMemory('/synthetic-project');
    const first = manager.appendModelChange('virtual', 'router');
    manager.appendMessage(assistant('physical', 'model', usage(10)));
    manager.appendModelChange('other-branch', 'model');
    manager.appendMessage(assistant('other-branch', 'model', usage(20)));
    manager.branch(first);
    manager.appendCompaction('Summary', first, 10, undefined, false, usage(5));
    const f = fixture(manager);
    await f.projection.flush();
    expect(f.lastUsage()?.modelUsage).toMatchObject({
      'physical/model': { inputTokens: 10 },
      'other-branch/model': { inputTokens: 20 },
      unknown: { inputTokens: 5 },
    });
    expect(f.lastUsage()?.modelUsage?.['virtual/router']).toBeUndefined();
  });

  it('keeps unattributed hook and tool usage unknown instead of charging the active model', async () => {
    const f = fixture();
    const selected = f.manager.appendModelChange('selected', 'model');
    f.manager.appendCompaction('Plugin summary', selected, 10, undefined, true, usage(5));
    f.manager.branchWithSummary(selected, 'Abandoned branch summary', undefined, false, usage(7));
    f.manager.appendMessage({
      role: 'toolResult',
      toolCallId: 'synthetic-tool',
      toolName: 'synthetic',
      content: [],
      usage: usage(6),
      isError: false,
      timestamp: 0,
    });
    await f.projection.flush();
    expect(f.lastUsage()?.modelUsage).toEqual({
      unknown: expect.objectContaining({ inputTokens: 18 }),
    });
    expect(f.lastUsage()?.modelUsage?.unknown?.costUSD).toBeUndefined();
    expect(f.lastUsage()?.delta?.usage.costUSD).toBeUndefined();
  });

  it('never treats SDK zero prices as free and propagates unknown costs through totals', async () => {
    const f = fixture();
    f.manager.appendMessage(assistant('custom', 'model', usage(10, 0)));
    await f.projection.flush();
    expect(f.lastUsage()?.usage.costUSD).toBeUndefined();
    f.manager.appendMessage(assistant('custom', 'model', usage(20, 0.2)));
    await f.projection.flush();
    expect(f.lastUsage()?.modelUsage?.['custom/model']?.costUSD).toBeUndefined();
    expect(f.lastUsage()?.delta?.usage.costUSD).toBeUndefined();
    expect(f.lastUsage()?.usage.costUSD).toBe(0.2);
  });

  it('projects finite public context changes even without Core notification support', async () => {
    const f = fixture(undefined, false);
    f.setContext({ tokens: 15, contextWindow: 100, percent: 15 });
    await f.projection.flush();
    f.setContext({ tokens: null, contextWindow: 100, percent: null });
    await f.projection.flush();
    f.setContext({ tokens: Number.NaN, contextWindow: 100, percent: 0 });
    await f.projection.flush();
    f.setContext({ tokens: 0, contextWindow: 200, percent: 0 });
    await f.projection.flush();
    await f.projection.flush();
    expect(f.updates).toEqual([
      {
        sessionId: f.manager.getSessionId(),
        update: { sessionUpdate: 'usage_update', used: 15, size: 100 },
      },
      {
        sessionId: f.manager.getSessionId(),
        update: { sessionUpdate: 'usage_update', used: 0, size: 200 },
      },
    ]);
    expect(f.notifications).toEqual([]);
  });

  it('does not publish malformed native counters or cross-session totals', async () => {
    const f = fixture();
    f.manager.appendMessage(assistant('provider', 'model', { ...usage(5), output: -1 }));
    await f.projection.flush();
    expect(f.notifications).toEqual([]);
    f.manager.newSession();
    await expect(f.projection.flush()).rejects.toThrow('adapter_usage_session_changed');
  });

  it('correlates compaction activities and preserves public token estimates without a clock', () => {
    const f = fixture();
    f.setContext({ tokens: 100, contextWindow: 200, percent: 50 });
    const start = f.projection.activity({ type: 'compaction_start', reason: 'threshold' });
    const end = f.projection.activity({
      type: 'compaction_end',
      reason: 'threshold',
      result: {
        summary: 'Summary',
        firstKeptEntryId: 'native-entry',
        tokensBefore: 100,
        estimatedTokensAfter: 25,
      },
      aborted: false,
      willRetry: false,
    });
    expect(start).toMatchObject({
      sessionUpdate: 'tool_call',
      status: 'in_progress',
      _meta: {
        lody: {
          activity: {
            version: 1,
            kind: 'context_compaction',
            automatic: true,
            usedTokensBefore: 100,
          },
        },
      },
    });
    expect(end).toMatchObject({
      sessionUpdate: 'tool_call_update',
      status: 'completed',
      _meta: { lody: { activity: { usedTokensBefore: 100, usedTokensAfter: 25 } } },
    });
    if (start?.sessionUpdate !== 'tool_call' || end?.sessionUpdate !== 'tool_call_update')
      throw new Error('Expected activity tool updates');
    expect(end.toolCallId).toBe(start.toolCallId);
    expect(f.projection.activity({ type: 'agent_settled' })).toBeUndefined();
  });

  it('keeps retry attempts in one activity and emits bounded failure metadata', () => {
    const f = fixture();
    const first = f.projection.activity({
      type: 'auto_retry_start',
      attempt: 1,
      maxAttempts: 2,
      delayMs: 100,
      errorMessage: 'sensitive-provider-detail',
    });
    const next = f.projection.activity({
      type: 'auto_retry_start',
      attempt: 2,
      maxAttempts: 2,
      delayMs: 200,
      errorMessage: 'sensitive-provider-detail',
    });
    const end = f.projection.activity({
      type: 'auto_retry_end',
      success: false,
      attempt: 2,
      finalError: 'sensitive-provider-detail',
    });
    if (
      first?.sessionUpdate !== 'tool_call' ||
      next?.sessionUpdate !== 'tool_call_update' ||
      end?.sessionUpdate !== 'tool_call_update'
    )
      throw new Error('Expected retry activity tool updates');
    expect([next.toolCallId, end.toolCallId]).toEqual([first.toolCallId, first.toolCallId]);
    expect(end).toMatchObject({
      status: 'failed',
      _meta: { lody: { activity: { kind: 'retry', failureReason: 'retry_failed' } } },
    });
    expect(JSON.stringify([first, next, end])).not.toContain('sensitive-provider-detail');
  });
});
