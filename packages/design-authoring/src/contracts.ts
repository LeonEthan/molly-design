/**
 * Vendored Bento contracts seam.
 *
 * All authoring modules import contracts through this single module so the
 * vendored path (packages/design-bento/vendor, pinned upstream snapshot)
 * appears exactly once in this package. The vendored contracts are pure TS
 * with no node builtins, so they are safe to bundle for both the CLI daemon
 * (vite SSR, noExternal) and the self-contained skill scripts (esbuild).
 */

export type * from '../../design-bento/vendor/packages/contracts/src/bentodoc.ts';
export {
  BENTO_DOC_V2_FIELDS,
  BENTO_DOC_V3_FIELDS,
} from '../../design-bento/vendor/packages/contracts/src/bentodoc.ts';
export * from '../../design-bento/vendor/packages/contracts/src/bentodoc-v4.ts';
export { CHART_SERIES_TYPES } from '../../design-bento/vendor/packages/contracts/src/chart-invariants.ts';
export { DIAGNOSTIC_CODES } from '../../design-bento/vendor/packages/contracts/src/diagnostics.ts';
export type {
  AssetIndex,
  ImportIssue,
  ImportResult,
} from '../../design-bento/vendor/packages/contracts/src/validation.ts';
export {
  FROZEN_MATRIX_SHA256,
  parseCapabilityMatrix,
  type CapabilityMatrix,
} from '../../design-bento/vendor/packages/contracts/src/matrix.ts';
export {
  sniffStaticV1FontMime,
  sniffStaticV1ImageMime,
  staticV1UnregisteredFontFamilies,
  resolveStaticV1IconMembership,
} from '../../design-bento/vendor/packages/contracts/src/static-v1.ts';

export { createVisualDocumentKernel } from '../../design-bento/vendor/packages/kernel/src/kernel.ts';
import type {
  Diagnostic as FrozenDiagnostic,
  DiagnosticCode as FrozenDiagnosticCode,
} from '../../design-bento/vendor/packages/contracts/src/diagnostics.ts';
export type { FrozenDiagnostic, FrozenDiagnosticCode };
export type LiveDiagnosticCode = FrozenDiagnosticCode extends `PPTD-${infer Rest}`
  ? `MOLLY-${Rest}`
  : never;
export type LiveDiagnostic = {
  code: LiveDiagnosticCode;
  path: string;
  message: string;
};
export type ValidatedArtwork = import('./canvas-format.ts').CanvasSource;
export type FrozenAuthoringValidationResult =
  | {
      ok: true;
      document: ValidatedArtwork;
      diagnostics: FrozenDiagnostic[];
    }
  | {
      ok: false;
      diagnostics: FrozenDiagnostic[];
    };
export type ValidationResult =
  | {
      ok: true;
      document: ValidatedArtwork;
      diagnostics: LiveDiagnostic[];
    }
  | {
      ok: false;
      diagnostics: LiveDiagnostic[];
    };
