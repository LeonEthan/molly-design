/**
 * The render bridge's wire schemas (P2.4b).
 *
 * These pin the shapes both ends must agree on: the daemon's answers and the
 * desktop host's poll. The preview answer is the one that needs saying out loud
 * — it carries the same `type` for a rendering and for a refusal — so both
 * halves are asserted here rather than left to whichever end happens to parse
 * them first.
 */

import { describe, expect, it } from 'vitest';
import {
  DESIGN_RENDER_HOST_POLL_INTERVAL_MS,
  DESIGN_RENDER_HOST_TTL_MS,
  DesignRenderHostReportSchema,
  DesignRenderHostWorkSchema,
  DesignRenderRpcResultSchema,
  LocalMachineRpcRequestSchema,
} from '../src/local-machine-rpc';

const request = (method: string, params: unknown): unknown => ({
  machineId: 'machine-1',
  workspaceId: 'workspace-1',
  method,
  params,
});

const work = (overrides: Record<string, unknown> = {}): unknown => ({
  requestId: 'request-1',
  payloadPath: '/data/design-preview-stage/request-1.json',
  outputPath: '/data/chats/session-1/design-preview/1789041600000-request1.png',
  width: 320,
  height: 200,
  ...overrides,
});

describe('the desktop host’s poll', () => {
  it('carries reports and nothing else: the host has no session to name', () => {
    const parsed = LocalMachineRpcRequestSchema.safeParse(
      request('design/render-host', {
        reports: [{ requestId: 'request-1', ok: false, error: 'font failed to load' }],
      })
    );
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).not.toHaveProperty('ownerSessionId');
  });

  it('bounds the batch the host may deliver in one poll', () => {
    const reports = Array.from({ length: 9 }, (_, index) => ({
      requestId: `request-${index}`,
      ok: true as const,
    }));
    expect(
      LocalMachineRpcRequestSchema.safeParse(request('design/render-host', { reports })).success
    ).toBe(false);
    expect(
      LocalMachineRpcRequestSchema.safeParse(
        request('design/render-host', { reports: reports.slice(0, 8) })
      ).success
    ).toBe(true);
  });

  it('requires a failed report to say why', () => {
    expect(DesignRenderHostReportSchema.safeParse({ requestId: 'r', ok: false }).success).toBe(
      false
    );
    expect(DesignRenderHostReportSchema.safeParse({ requestId: 'r', ok: true }).success).toBe(true);
  });

  it('carries the asking session on the two agent-facing methods', () => {
    for (const method of ['design/render-preview', 'design/render-host-status']) {
      const parsed = LocalMachineRpcRequestSchema.safeParse({
        ...(request(method, {}) as Record<string, unknown>),
        ownerSessionId: 'session-1',
      });
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data).toMatchObject({ ownerSessionId: 'session-1' });
    }
  });

  it('leaves the asking session optional, because the daemon owns that rule', () => {
    // `ownerSessionId` is optional on every method: what makes a request
    // legitimate is the daemon's answer (a session it cannot read is refused
    // there), not a schema that cannot see the session table.
    expect(
      LocalMachineRpcRequestSchema.safeParse(request('design/render-preview', {})).success
    ).toBe(true);
  });
});

describe('the work the daemon hands out', () => {
  it('accepts a staged render and rejects an unbounded or partial one', () => {
    expect(DesignRenderHostWorkSchema.safeParse(work()).success).toBe(true);
    expect(DesignRenderHostWorkSchema.safeParse(work({ width: 4097 })).success).toBe(false);
    expect(DesignRenderHostWorkSchema.safeParse(work({ height: 0 })).success).toBe(false);
    expect(DesignRenderHostWorkSchema.safeParse(work({ requestId: '   ' })).success).toBe(false);
    expect(DesignRenderHostWorkSchema.safeParse(work({ payloadPath: undefined })).success).toBe(
      false
    );
  });

  it('rejects the retired thumbnail-only scale parameter', () => {
    expect(DesignRenderHostWorkSchema.safeParse(work({ maxEdge: 480 })).success).toBe(false);
  });
});

describe('the daemon’s render answers', () => {
  it('parses a host poll answer', () => {
    const parsed = DesignRenderRpcResultSchema.safeParse({
      type: 'design/render-host',
      requests: [work()],
    });
    expect(parsed.success).toBe(true);
    expect(
      parsed.success && parsed.data.type === 'design/render-host' && parsed.data.requests
    ).toHaveLength(1);
  });

  it('parses the host status', () => {
    expect(
      DesignRenderRpcResultSchema.safeParse({ type: 'design/render-host-status', connected: false })
        .success
    ).toBe(true);
  });

  /**
   * The case a flat discriminated union cannot hold: two variants that share a
   * `type` and differ in `ok`. Both must parse to their own half, or the tool
   * that reads them answers "unexpected answer" for every successful render.
   */
  it('parses both halves of the preview answer', () => {
    const rendered = DesignRenderRpcResultSchema.safeParse({
      type: 'design/render-preview',
      ok: true,
      path: 'design-preview/1789041600000-abcd1234.png',
      width: 320,
      height: 200,
      bytes: 4096,
    });
    expect(rendered.success && rendered.data).toMatchObject({
      type: 'design/render-preview',
      ok: true,
      bytes: 4096,
    });

    const refused = DesignRenderRpcResultSchema.safeParse({
      type: 'design/render-preview',
      ok: false,
      error: 'the Molly desktop is not running',
    });
    expect(refused.success && refused.data).toEqual({
      type: 'design/render-preview',
      ok: false,
      error: 'the Molly desktop is not running',
    });
  });

  it('keeps each half’s fields out of the other, and refuses an empty refusal', () => {
    // A refusal with a path is not a rendering, and vice versa: the union is
    // exhaustive, not permissive.
    expect(
      DesignRenderRpcResultSchema.safeParse({
        type: 'design/render-preview',
        ok: false,
        error: 'nope',
        path: 'design-preview/a.png',
      }).success
    ).toBe(false);
    expect(
      DesignRenderRpcResultSchema.safeParse({
        type: 'design/render-preview',
        ok: true,
        path: 'design-preview/a.png',
        width: 1,
        height: 1,
        bytes: 1,
        error: 'nope',
      }).success
    ).toBe(false);
    expect(
      DesignRenderRpcResultSchema.safeParse({
        type: 'design/render-preview',
        ok: false,
        error: '  ',
      }).success
    ).toBe(false);
    expect(
      DesignRenderRpcResultSchema.safeParse({
        type: 'design/render-preview',
        ok: true,
        path: 'design-preview/a.png',
        width: 1,
        height: 1,
        bytes: 0,
      }).success
    ).toBe(false);
  });
});

describe('host liveness constants', () => {
  it('keeps the TTL comfortably longer than one poll interval', () => {
    // A host that misses a single poll is still there; one that is gone for
    // several is not. Reversing these would make every preview flaky.
    expect(DESIGN_RENDER_HOST_TTL_MS).toBeGreaterThan(DESIGN_RENDER_HOST_POLL_INTERVAL_MS * 2);
  });
});
