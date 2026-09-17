import { describe, expect, it } from 'vitest';
import { LoroDoc } from 'loro-crdt';
import { createHistoryWriter } from '../src/history-writer';
import { createLoroSessionData } from '../src/session-data';
import type { SessionId } from '../src/ids';
import type { DesignTurnOutcome } from '../src/design-turn-outcome';

const timestamp = '2026-09-17T00:00:00Z';
const outcome: DesignTurnOutcome = {
  version: 1,
  status: 'committed',
  turnId: 'user',
  artworkId: 'artwork',
  revisionId: 'a'.repeat(64),
  timestamp,
};

describe('Molly history writer compatibility', () => {
  it('persists the first design receipt and exact provider identity through snapshot reopen', () => {
    const doc = new LoroDoc();
    const writer = createHistoryWriter(doc);
    writer.append({
      id: 'user',
      role: 'user',
      timestamp,
      fileDiff: [],
      inputConfig: { agentConfigId: 'provider-a', mcpServerIds: [] },
    });
    writer.updateEntry('user', (entry) => ({ ...entry, designOutcome: outcome }));
    const snapshot = doc.export({ mode: 'snapshot' });
    const reopened = new LoroDoc();
    reopened.import(snapshot);
    const data = createLoroSessionData({ sessionId: 'session' as SessionId, doc: reopened });
    expect(data.history.readTurn('user')).toMatchObject({
      state: 'ready',
      turn: { designOutcome: outcome },
    });
    const directory = data.history.readDirectory(0, 1);
    expect(directory[0]?.inputConfig).toMatchObject({
      agentConfigId: 'provider-a',
      mcpServerIds: [],
    });
  });

  it('preserves opaque old design data when editing another field and rejects an invalid new receipt', () => {
    const doc = new LoroDoc();
    const opaque = { version: 99, thumbnail: { future: true } };
    doc
      .getList('history')
      .insert(0, { id: 'user', role: 'user', timestamp, designOutcome: opaque });
    doc.commit();
    const writer = createHistoryWriter(doc);
    writer.setField('user', 'status', 'handled');
    expect(writer.readStored()[0]?.designOutcome).toEqual(opaque);
    expect(() =>
      writer.updateEntry('user', (entry) => ({
        ...entry,
        designOutcome: { ...outcome, revisionId: 'invalid' },
      }))
    ).toThrow('Invalid history write');
    expect(writer.readStored()[0]?.designOutcome).toEqual(opaque);
  });
});

it('atomically keeps the first design verdict and exposes it without body hydration', async () => {
  const doc = new LoroDoc();
  const data = createLoroSessionData({ sessionId: 'receipt' as SessionId, doc });
  await data.commands.appendTurn({
    id: 'user',
    role: 'user',
    timestamp,
    items: [{ type: 'text', text: 'design' }],
  });
  expect(
    await data.commands.applyHistoryAction({ kind: 'design-outcome', turnId: 'user', outcome })
  ).toMatchObject({ matched: true });
  expect(
    await data.commands.applyHistoryAction({
      kind: 'design-outcome',
      turnId: 'user',
      outcome: { ...outcome, status: 'failed' },
    })
  ).toMatchObject({ matched: false });
  expect(await data.history.readDirectory(0, 1)).toMatchObject([
    { scalars: { designOutcome: outcome } },
  ]);
  const reopened = new LoroDoc();
  reopened.import(doc.export({ mode: 'snapshot' }));
  const recovered = createLoroSessionData({ sessionId: 'receipt' as SessionId, doc: reopened });
  expect(await recovered.history.readDirectory(0, 1)).toMatchObject([
    { scalars: { designOutcome: outcome } },
  ]);
});
