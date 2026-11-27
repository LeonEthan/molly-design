import path from 'node:path';
import { lstat } from 'node:fs/promises';
import { resolveIsolatedDataPath } from '@molly/shared/node/installation-profile';
import { ARTWORK_ENTRY } from '@molly/design-authoring';
import {
  DESIGN_TURN_MANIFEST_FILENAME,
  designTurnInputDir,
  isDesignTurnId,
  readFrozenManifest,
} from './turn-input';
import { readDesignArtifactDigest } from './artifact';
import { buildPreviewPayload, type ObservedPreviewResult } from './render-preview';

/** Display provenance only: this never grants submission authority or writes a draft. */
export async function buildLivePreviewPayload(
  dataRoot: string,
  workdir: string,
  live: { sessionId: string; sourceTurnId: string },
  previousSourceIdentity?: string
): Promise<ObservedPreviewResult> {
  // A turn identity is a path component, never a filesystem capability.
  if (!isDesignTurnId(live.sourceTurnId)) throw Error('Invalid source turn');
  const inputRoot = resolveIsolatedDataPath(dataRoot, 'chats', live.sessionId);
  const turnDir = designTurnInputDir(inputRoot, live.sourceTurnId);
  resolveIsolatedDataPath(
    inputRoot,
    path.relative(inputRoot, turnDir),
    DESIGN_TURN_MANIFEST_FILENAME
  );
  const manifest = await readFrozenManifest(turnDir, live.sourceTurnId);
  if (!manifest) return { status: 'refused', error: '', dependencies: [ARTWORK_ENTRY] };
  if (path.resolve(manifest.artifactWorkdir ?? inputRoot) !== path.resolve(workdir))
    return { status: 'refused', error: 'Active design input belongs to a different workspace.' };
  if (!previousSourceIdentity) {
    try {
      await lstat(path.join(workdir, ARTWORK_ENTRY));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { status: 'refused', error: '', dependencies: [ARTWORK_ENTRY] };
      throw error;
    }
  }
  const built = await buildPreviewPayload(workdir, { previousSourceIdentity });
  if (manifest.previewSourceAtSend) {
    if (built.sourceIdentity === manifest.previewSourceAtSend)
      return { status: 'refused', error: '', dependencies: built.dependencies };
  } else if (manifest.artifactAtSend?.status === 'present') {
    const artifact = await readDesignArtifactDigest(workdir);
    if (artifact.status === 'present' && artifact.digest === manifest.artifactAtSend.digest)
      return { status: 'refused', error: '', dependencies: built.dependencies };
  }
  return built;
}
