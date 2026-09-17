/** Enumerate only asset-bearing native fields. */
import type { ValidatedArtwork } from './contracts.ts';
import { mapArtworkAssets } from './canvas-format.ts';
export interface SemanticAssetRef {
  /** media/ relative path as authored. */
  ref: string;
  /** Artwork YAML path for diagnostics (import `unsupported` attribution). */
  path: string;
  /** Source element id when attributable. */
  sourceId?: string;
}

export function listSemanticAssetRefs(validated: ValidatedArtwork): SemanticAssetRef[] {
  const out: SemanticAssetRef[] = [];
  mapArtworkAssets(validated, (ref, _kind, path) => { out.push({ref, path}); return ref; });
  return out;
}
