import { readDesignElementReferences, validateDesignElementReferences } from '@molly/shared/design-element-reference';
import { getIpcServices } from './electron-ipc-client';

/**
 * P2.2 design-turn send gate. Before a design session turn is dispatched, the
 * canvas editor — which may be open-but-hidden behind another side-panel tab —
 * must have flushed its pending edits through the design store save, so the
 * daemon pins the post-save baseline revisionId in the turn-input manifest.
 *
 * Resolves when the send may proceed: non-Electron hosts have no canvas
 * editor, and a session whose canvas was never attached this run has no
 * unsaved edits. Rejects on a real save failure; callers must block the send,
 * keep the user's draft, and surface the error (P1 save-failure semantics).
 */
export async function flushDesignCanvasBeforeSend(artworkId: string, prompt = ''): Promise<void> {
  const design = getIpcServices()?.design;
  const references = readDesignElementReferences(prompt);
  if (!design) {
    if (references.length) throw Error('Cannot validate element references without the local artwork');
    return;
  }
  await design.save(artworkId);
  if (references.length) validateDesignElementReferences(references, artworkId, await design.read(artworkId));
}
