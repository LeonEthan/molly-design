import { describe, expect, it, vi } from 'vitest';
import * as acp from '@agentclientprotocol/sdk';
import type { SessionInfo } from '@agentclientprotocol/sdk';
import type { ACPSessionId } from '@molly/shared';

import {
  dedupeHistorySessionsById,
  listPaginatedHistorySessions,
  requestHistorySessionReplay,
  resolveHistoryACPProcessLaunch,
} from '../src/lib/history-session-catalog-client';

function session(sessionId: string, title: string): SessionInfo {
  return {
    sessionId,
    title,
    updatedAt: '2026-05-14T00:00:00.000Z',
  } as SessionInfo;
}

describe('history session catalog client', () => {
  it('paginates listSessions until nextCursor is empty', async () => {
    const calls: Array<{ cwd: string; cursor?: string | null }> = [];
    const result = await listPaginatedHistorySessions('/repo/project', async (params) => {
      calls.push(params);
      if (!params.cursor) {
        return {
          sessions: [session('session-1', 'First')],
          nextCursor: 'page-2',
        };
      }
      return {
        sessions: [session('session-2', 'Second')],
        nextCursor: null,
      };
    });

    expect(calls).toEqual([
      { cwd: '/repo/project', cursor: undefined },
      { cwd: '/repo/project', cursor: 'page-2' },
    ]);
    expect(result.map((item) => item.sessionId)).toEqual(['session-1', 'session-2']);
  });

  it('stops pagination once the requested session limit is filled', async () => {
    const calls: Array<{ cwd: string; cursor?: string | null }> = [];
    const result = await listPaginatedHistorySessions(
      '/repo/project',
      async (params) => {
        calls.push(params);
        const page = params.cursor ? 2 : 1;
        return {
          sessions: Array.from({ length: 60 }, (_, index) =>
            session(`session-${(page - 1) * 60 + index}`, `Session ${index}`)
          ),
          nextCursor: `page-${page + 1}`,
        };
      },
      { maxSessions: 100 }
    );

    expect(calls).toEqual([
      { cwd: '/repo/project', cursor: undefined },
      { cwd: '/repo/project', cursor: 'page-2' },
    ]);
    expect(result).toHaveLength(100);
    expect(result.at(-1)?.sessionId).toBe('session-99');
  });

  it('continues past the limit until explicitly required sessions are found', async () => {
    const calls: Array<{ cwd: string; cursor?: string | null }> = [];
    const result = await listPaginatedHistorySessions(
      '/repo/project',
      async (params) => {
        calls.push(params);
        const page = params.cursor ? 2 : 1;
        return {
          sessions: Array.from({ length: 60 }, (_, index) =>
            session(`session-${(page - 1) * 60 + index}`, `Session ${index}`)
          ),
          nextCursor: page === 1 ? 'page-2' : 'page-3',
        };
      },
      {
        maxSessions: 100,
        requiredSessionIds: new Set(['session-119']),
      }
    );

    expect(calls).toHaveLength(2);
    expect(result).toHaveLength(101);
    expect(result.slice(0, 100).map((item) => item.sessionId)).toEqual(
      Array.from({ length: 100 }, (_, index) => `session-${index}`)
    );
    expect(result.at(-1)?.sessionId).toBe('session-119');
  });

  it('dedupes sessions by acp session id with later entries winning', () => {
    const result = dedupeHistorySessionsById([
      session('session-1', 'Old title'),
      session('session-2', 'Other'),
      session('session-1', 'New title'),
    ]);

    expect(result.map((item) => [item.sessionId, item.title])).toEqual([
      ['session-1', 'New title'],
      ['session-2', 'Other'],
    ]);
  });
});

describe('requestHistorySessionReplay', () => {
  const acpSessionId = 'session-1' as ACPSessionId;
  const codexProvider = { cliType: 'builtin', agentType: 'codex' } as const;

  function initializeResponse(
    overrides: Partial<acp.InitializeResponse> = {}
  ): acp.InitializeResponse {
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: {},
      authMethods: [],
      ...overrides,
    };
  }

  it('uses the advertised Molly read-only method for builtin Codex', async () => {
    const request = vi.fn(async () => ({}));
    const loadSession = vi.fn(async () => ({}));

    await requestHistorySessionReplay({
      provider: codexProvider,
      acpSessionId,
      cwd: '/repo/project',
      connection: { request, loadSession } as never,
      initResponse: initializeResponse({
        agentCapabilities: {
          _meta: {
            lody: {
              sessionHistory: {
                version: 1,
                method: '_lody/session/history/read',
              },
            },
          },
        },
      }),
    });

    expect(request).toHaveBeenCalledWith('_lody/session/history/read', {
      sessionId: acpSessionId,
    });
    expect(loadSession).not.toHaveBeenCalled();
  });

  it('fails closed when builtin Codex does not advertise the read-only method', async () => {
    const request = vi.fn(async () => ({}));
    const loadSession = vi.fn(async () => ({}));

    await expect(
      requestHistorySessionReplay({
        provider: codexProvider,
        acpSessionId,
        cwd: '/repo/project',
        connection: { request, loadSession } as never,
        initResponse: initializeResponse({
          agentCapabilities: { loadSession: true },
        }),
      })
    ).rejects.toThrow('agentCapabilities._meta.lody.sessionHistory version 1');
    expect(request).not.toHaveBeenCalled();
    expect(loadSession).not.toHaveBeenCalled();
  });

  it('keeps loadSession for non-Codex providers', async () => {
    const request = vi.fn(async () => ({}));
    const loadSession = vi.fn(async () => ({}));

    await requestHistorySessionReplay({
      provider: { cliType: 'registry', agentType: 'auggie' },
      acpSessionId,
      cwd: '/repo/project',
      connection: { request, loadSession } as never,
      initResponse: initializeResponse({
        agentCapabilities: { loadSession: true },
      }),
    });

    expect(request).not.toHaveBeenCalled();
    expect(loadSession).toHaveBeenCalledWith({
      sessionId: acpSessionId,
      cwd: '/repo/project',
      mcpServers: [],
    });
  });
});

describe('resolveHistoryACPProcessLaunch', () => {
  it.each([
    {
      cliType: 'builtin',
      agentType: 'codex',
      runtimeOverrides: { codexPath: '/synthetic/legacy' },
    },
    { cliType: 'registry', agentType: 'claude-p' },
    { cliType: 'registry', agentType: 'auggie' },
    { cliType: 'registry', agentType: 'amp-acp' },
  ] as const)('does not start $cliType/$agentType to read history', async (provider) => {
    await expect(
      resolveHistoryACPProcessLaunch({ provider, env: { PATH: '/usr/bin' } })
    ).rejects.toThrow('legacy_harness_execution_disabled');
  });
});
