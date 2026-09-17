/** Synthetic historical bytes only; production has no candidate writer. */
import { createHash } from 'node:crypto';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { canonicalContentBytes, designInput, type DesignCandidate } from './store';

export async function writeHistoricalCandidate(
  root: string,
  input: Omit<DesignCandidate, 'version' | 'candidateId'>
) {
  input = { ...input, content: designInput.parse(input.content) };
  const candidateId = createHash('sha256')
    .update(canonicalContentBytes(input.content))
    .digest('hex');
  const directory = path.join(root, 'chats', input.artworkId, 'candidates');
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, `${candidateId}.json`),
    JSON.stringify({ version: 1, candidateId, ...input })
  );
  return { candidateId };
}

export async function listHistoricalCandidateFiles(
  root: string,
  artworkId: string
): Promise<string[]> {
  try {
    return (await readdir(path.join(root, 'chats', artworkId, 'candidates'))).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}
