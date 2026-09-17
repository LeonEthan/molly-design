/**
 * The collected-snapshot → store-asset-table step, shared by the two paths that
 * read a PPTD project out of a session workdir: post-turn collection (P2.3,
 * `./turn-outcome.ts`) and preview rendering (P2.4b, `./render-preview.ts`).
 *
 * Both must turn the same bytes into the same table, and the store re-checks
 * every asset by digest, so this stays one function rather than two copies that
 * could drift into accepting different MIME types.
 */

import {
  sniffStaticV1FontMime,
  sniffStaticV1ImageMime,
} from '../../../../packages/design-bento/vendor/packages/contracts/src/static-v1';

/** Matches the design store's per-asset cap (`store.ts` `designInput`). */
export const MAX_ASSET_BYTES = 16 * 1024 * 1024;

/**
 * The store admits exactly these MIME types, sniffed from the bytes themselves
 * (`store.ts` cross-checks the same way) — so a font is never served as an image
 * and a mislabeled asset fails loudly here instead of being repaired.
 */
export function buildAssetDataUris(assets: Map<string, Uint8Array>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [hash, bytes] of assets) {
    const mime = sniffStaticV1ImageMime(bytes) ?? sniffStaticV1FontMime(bytes);
    if (mime === null) throw Error(`unsupported asset bytes for ${hash}`);
    if (bytes.byteLength > MAX_ASSET_BYTES) throw Error(`asset exceeds 16 MiB: ${hash}`);
    out[hash] = `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
  }
  return out;
}
