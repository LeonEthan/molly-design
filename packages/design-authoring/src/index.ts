/**
 * @molly/design-authoring — YAML artwork intake for the Molly platform.
 *
 * Migrated from the pinned upstream authoring package (see source-manifest.json
 * and README.md). Scope: YAML snapshot validation, YAML → BentoDoc v4 import,
 * BentoDoc schema migration, and secure authoring snapshot collection.
 * Explicitly not migrated: immutable revision CAS store, quality orchestration,
 * PPTD authoring generators.
 */

export { intakeAuthoring, type AuthoringIntakeResult } from './intake.ts';
export { validate, validateSnapshot, type ValidateOptions } from './validate.ts';
export {
  loadBentoDocV4,
  UnsupportedSchemaVersionError,
  BentoDocUnknownFieldError,
} from './migrate.ts';
export {
  collectAuthoring,
  digestAuthoring,
  assertAuthoringEntry,
  isAuthoringRelPath,
  AuthoringSnapshotError,
} from './collect-authoring.ts';
export { listSemanticAssetRefs, type SemanticAssetRef } from './semantic-assets.ts';
export {
  FROZEN_CAPABILITY_MATRIX,
  CapabilityMatrixHashMismatchError,
} from './capability-matrix.ts';

export {
  exportAuthoring,
  assertRenderableLines,
  AUTHORING_DEFAULT_FONT_FAMILY,
  ARTWORK_ENTRY,
  ARTWORK_FORMAT,
  ARTWORK_ROOT_FIELDS,
  ARTWORK_EXCLUSIONS,
  describeAuthoringFormat,
  type ArtworkExclusionScope,
  type ArtworkFormatExclusion,
  type ArtworkFormatDescription,
  type ArtworkKindDescription,
} from './canvas-format.ts';
export { AUTHORING_PROJECTION_CAPABILITIES } from './projection-capabilities.ts';
export { migrateTwoFileArtwork } from './migrate-two-file.ts';
