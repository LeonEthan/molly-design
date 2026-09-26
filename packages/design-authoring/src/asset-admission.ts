import { sniffStaticV1FontMime, sniffStaticV1ImageMime } from './contracts.ts';

export const MAX_ASSET_BYTES = 16 * 1024 * 1024;

export type AssetKind = 'image' | 'font' | 'asset';
export type AssetAdmissionFailure =
  | { code: 'asset_too_large'; path: string; actualBytes: number; limitBytes: number }
  | { code: 'asset_format_unsupported'; path: string; kind: AssetKind };

export function assetSizeFailure(
  path: string,
  actualBytes: number
): AssetAdmissionFailure | undefined {
  return actualBytes > MAX_ASSET_BYTES
    ? { code: 'asset_too_large', path, actualBytes, limitBytes: MAX_ASSET_BYTES }
    : undefined;
}

export function inspectAssetAdmission(
  bytes: Uint8Array,
  path: string,
  kind: AssetKind = 'asset'
): { ok: true; mime: string } | { ok: false; failure: AssetAdmissionFailure } {
  const oversized = assetSizeFailure(path, bytes.byteLength);
  if (oversized) return { ok: false, failure: oversized };
  const mime =
    kind === 'font'
      ? sniffStaticV1FontMime(bytes)
      : kind === 'image'
        ? sniffStaticV1ImageMime(bytes)
        : (sniffStaticV1ImageMime(bytes) ?? sniffStaticV1FontMime(bytes));
  return mime === null
    ? { ok: false, failure: { code: 'asset_format_unsupported', path, kind } }
    : { ok: true, mime };
}

export function describeAssetAdmissionFailure(failure: AssetAdmissionFailure): string {
  return failure.code === 'asset_too_large'
    ? `Asset ${failure.path} is ${failure.actualBytes} bytes; limit is ${failure.limitBytes} bytes (16 MiB).`
    : `Unsupported ${failure.kind} bytes: ${failure.path}.`;
}
