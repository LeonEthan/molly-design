import {
  sanitizeDesignTurnOutcome,
  type DesignTurnOutcome,
} from '../../../packages/shared/src/design-turn-outcome.js';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

type DesignEvalTurn = { turnId: string; manifest: unknown; receipt: unknown };

export async function readDesignEvalTurnIds(workdir: string): Promise<string[]> {
  try {
    const entries = await readdir(join(workdir, 'design-input'), { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function readDesignEvalTurn(
  workdir: string,
  previousTurnIds: readonly string[]
): Promise<DesignEvalTurn | undefined> {
  const ids = (await readDesignEvalTurnIds(workdir)).filter((id) => !previousTurnIds.includes(id));
  if (ids.length > 1) throw Error('More than one new design turn appeared for one eval prompt');
  const turnId = ids[0];
  if (!turnId) return undefined;
  const directory = join(workdir, 'design-input', turnId);
  try {
    const manifest: unknown = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
    const receipt: unknown = JSON.parse(await readFile(join(directory, 'receipt.json'), 'utf8'));
    return { turnId, manifest, receipt };
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

export function requireCommittedDesignEvalTurn(
  turn: DesignEvalTurn,
  artworkId: string,
  prompt: string
): DesignTurnOutcome & { status: 'committed'; revisionId: string } {
  const receipt = sanitizeDesignTurnOutcome(turn.receipt);
  const manifest = turn.manifest;
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    !('turnId' in manifest) ||
    manifest.turnId !== turn.turnId ||
    !('prompt' in manifest) ||
    manifest.prompt !== prompt ||
    ('artworkId' in manifest && manifest.artworkId !== artworkId) ||
    !receipt ||
    receipt.turnId !== turn.turnId ||
    receipt.artworkId !== artworkId ||
    receipt.status !== 'committed' ||
    !receipt.revisionId
  )
    throw Error(
      `Design eval turn ${turn.turnId} has no matching committed receipt for ${artworkId}`
    );
  return { ...receipt, status: 'committed', revisionId: receipt.revisionId };
}
