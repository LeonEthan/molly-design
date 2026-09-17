import { describe, expect, it } from 'vitest';

import { Loro } from 'loro-crdt';
import { Mirror } from 'loro-mirror';

import { sessionDocSchema } from '../src/schema';
import type { SessionHistoryInput } from '../src/schema';
import type { SessionDoc } from '../src/schema';
import type { SessionId } from '../src/ai';
import {
  MAX_DESIGN_TURN_OUTCOME_DIAGNOSTICS,
  MAX_DESIGN_TURN_OUTCOME_DIAGNOSTIC_MESSAGE_LENGTH,
  DESIGN_TURN_OUTCOME_VERSION,
  sanitizeDesignTurnOutcome,
  sanitizeDesignTurnOutcomeDiagnostics,
  type DesignTurnOutcome,
} from '../src/design-turn-outcome';

const SHA = 'a'.repeat(64);
const THUMBNAIL = { path: `design-thumbnail/${SHA}.png`, width: 320, height: 200 };

const outcome = (patch: Partial<DesignTurnOutcome> = {}): DesignTurnOutcome => ({
  version: DESIGN_TURN_OUTCOME_VERSION,
  status: 'committed',
  turnId: 'turn-1',
  artworkId: 'artwork-1',
  revisionId: SHA,
  timestamp: '2026-09-10T00:00:00.000Z',
  ...patch,
});

describe('sanitizeDesignTurnOutcome', () => {
  it('keeps a fully described outcome', () => {
    expect(sanitizeDesignTurnOutcome(outcome())).toEqual(outcome());
  });

  it('keeps a candidate with its diagnostics', () => {
    const candidate = outcome({
      status: 'candidate',
      candidateId: SHA,
      revisionId: undefined,
      diagnostics: [{ code: 'MOLLY-E005', message: '引用媒体文件不存在：media/a.png' }],
    });
    expect(sanitizeDesignTurnOutcome(candidate)).toEqual(candidate);
  });

  it.each([
    ['a non-object', 'committed'],
    ['a missing status', { ...outcome(), status: undefined }],
    ['an unknown status', outcome({ status: 'done' as never })],
    ['a future version', { ...outcome(), version: 2 }],
    ['a missing turn id', { ...outcome(), turnId: '' }],
    ['a missing timestamp', { ...outcome(), timestamp: undefined }],
  ])('drops %s', (_label, value) => {
    expect(sanitizeDesignTurnOutcome(value)).toBeUndefined();
  });

  it('drops optional fields that cannot be rendered faithfully', () => {
    const sanitized = sanitizeDesignTurnOutcome({
      ...outcome(),
      candidateId: 'not-a-digest',
      revisionId: 42,
    });
    expect(sanitized).toEqual(outcome({ revisionId: undefined }));
  });

  it('bounds and deduplicates diagnostics, and drops an empty list', () => {
    const many = Array.from(
      { length: MAX_DESIGN_TURN_OUTCOME_DIAGNOSTICS + 5 },
      (_value, index) => ({
        code: `MOLLY-E${String(index).padStart(3, '0')}`,
        message: `problem ${index}`,
      })
    );
    const bounded = sanitizeDesignTurnOutcomeDiagnostics([...many, many[0]]);
    expect(bounded).toHaveLength(MAX_DESIGN_TURN_OUTCOME_DIAGNOSTICS);
    expect(sanitizeDesignTurnOutcomeDiagnostics([])).toBeUndefined();
    expect(sanitizeDesignTurnOutcomeDiagnostics([{ code: 'MOLLY-E001' }])).toBeUndefined();
  });

  it('keeps one code reported at two different places', () => {
    expect(
      sanitizeDesignTurnOutcomeDiagnostics([
        { code: 'MOLLY-E006', message: 'bounds 越出画布：pages[0].elements[1]' },
        { code: 'MOLLY-E006', message: 'bounds 越出画布：pages[0].elements[2]' },
      ])
    ).toHaveLength(2);
  });

  it('truncates an overlong message instead of dropping the diagnostic', () => {
    const [kept] = sanitizeDesignTurnOutcomeDiagnostics([
      { code: 'design_store_failed', message: 'x'.repeat(4_000) },
    ])!;
    expect(kept?.message).toHaveLength(MAX_DESIGN_TURN_OUTCOME_DIAGNOSTIC_MESSAGE_LENGTH);
  });

  it.each([THUMBNAIL, 'invalid legacy reference', null])(
    'ignores legacy thumbnail metadata without changing the source',
    (thumbnail) => {
      const stored = { ...outcome(), thumbnail };
      const before = JSON.stringify(stored);
      expect(sanitizeDesignTurnOutcome(stored)).toEqual(outcome());
      expect(JSON.stringify(stored)).toBe(before);
    }
  );
});

describe('session document persistence', () => {
  const entryWith = (designOutcome: unknown): SessionHistoryInput => ({
    id: 'turn-1',
    role: 'user',
    items: [{ type: 'text', text: 'make a poster' }],
    timestamp: '2026-09-10T00:00:00.000Z',
    status: 'handled',
    read: false,
    userId: 'user-1',
    fileDiff: [],
    finished: true,
    designOutcome: designOutcome as DesignTurnOutcome,
  });

  const withMirror = (run: (mirror: Mirror<typeof sessionDocSchema>, doc: Loro) => void) => {
    const doc = new Loro();
    const mirror = new Mirror({
      doc,
      schema: sessionDocSchema,
      initialState: {
        session: { id: 'session-1' as SessionId },
        history: [],
        mq: [],
      } satisfies Partial<SessionDoc>,
      throwOnValidationError: true,
    });
    try {
      run(mirror, doc);
    } finally {
      mirror.dispose();
    }
  };

  it('persists the outcome on the turn it belongs to', () => {
    withMirror((mirror) => {
      expect(() => {
        mirror.setState((prev) => ({ ...prev, history: [entryWith(outcome())] }));
      }).not.toThrow();
      const persisted = mirror.getState().history[0]?.designOutcome;
      expect(sanitizeDesignTurnOutcome(persisted)).toEqual(outcome());
    });
  });

  it('survives a snapshot export/import, which is how a reopen reads it back', () => {
    const doc = new Loro();
    const mirror = new Mirror({
      doc,
      schema: sessionDocSchema,
      initialState: {
        session: { id: 'session-1' as SessionId },
        history: [],
        mq: [],
      } satisfies Partial<SessionDoc>,
      throwOnValidationError: true,
    });
    const stored = outcome({ status: 'candidate', candidateId: SHA, revisionId: undefined });
    mirror.setState((prev) => ({ ...prev, history: [entryWith(stored)] }));
    const snapshot = doc.export({ mode: 'snapshot' });
    mirror.dispose();

    const revivedDoc = new Loro();
    revivedDoc.import(snapshot);
    const revived = new Mirror({
      doc: revivedDoc,
      schema: sessionDocSchema,
      throwOnValidationError: true,
    });
    try {
      expect(sanitizeDesignTurnOutcome(revived.getState().history[0]?.designOutcome)).toEqual(
        stored
      );
    } finally {
      revived.dispose();
    }
  });

  it('reopens legacy history without rewriting its thumbnail metadata', () => {
    // The read view drops retired fields; the durable history retains them.
    const doc = new Loro();
    const mirror = new Mirror({
      doc,
      schema: sessionDocSchema,
      initialState: {
        session: { id: 'session-1' as SessionId },
        history: [],
        mq: [],
      } satisfies Partial<SessionDoc>,
      throwOnValidationError: true,
    });
    const current = outcome({ status: 'candidate', candidateId: SHA, revisionId: undefined });
    const stored = { ...current, thumbnail: THUMBNAIL };
    mirror.setState((prev) => ({ ...prev, history: [entryWith(stored)] }));
    const snapshot = doc.export({ mode: 'snapshot' });
    mirror.dispose();

    const revivedDoc = new Loro();
    revivedDoc.import(snapshot);
    const revived = new Mirror({
      doc: revivedDoc,
      schema: sessionDocSchema,
      throwOnValidationError: true,
    });
    try {
      expect(sanitizeDesignTurnOutcome(revived.getState().history[0]?.designOutcome)).toEqual(
        current
      );
      expect(revived.getState().history[0]?.designOutcome).toEqual(stored);
    } finally {
      revived.dispose();
    }
  });

  it('keeps the outcome intact when a later single-field update lands on the turn', () => {
    withMirror((mirror) => {
      mirror.setState((prev) => ({ ...prev, history: [entryWith(outcome())] }));
      mirror.setState((prev) => ({
        ...prev,
        history: prev.history.map((turn) => ({ ...turn, status: 'seen' as const })),
      }));
      expect(sanitizeDesignTurnOutcome(mirror.getState().history[0]?.designOutcome)).toEqual(
        outcome()
      );
    });
  });
});
