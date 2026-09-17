/**
 * Frozen capability matrix, bundle-safe.
 *
 * Upstream loads `capability-matrix/v1.json` from disk relative to
 * `import.meta.url` (contracts/capability-matrix/loader.ts), which breaks
 * under bundling: the CLI daemon inlines this package into vite chunks and
 * the materialized skill scripts are esbuild bundles. Instead, scripts/
 * build.mjs embeds the vendored v1.json bytes as base64 in
 * src/generated/capability-matrix-bytes.ts (regenerated every build).
 *
 * Runtime still verifies the embedded bytes against FROZEN_MATRIX_SHA256 from
 * the vendored contracts before parsing, fail-closed, so a stale or corrupted
 * generated module can never silently change validation behavior.
 */

import { createHash } from 'node:crypto';
import { FROZEN_MATRIX_SHA256, parseCapabilityMatrix, type CapabilityMatrix } from './contracts.ts';
import { CAPABILITY_MATRIX_V1_BASE64 } from './generated/capability-matrix-bytes.ts';

export class CapabilityMatrixHashMismatchError extends Error {
  readonly code = 'MATRIX_HASH_MISMATCH';
  readonly expected: string;
  readonly actual: string;

  constructor(expected: string, actual: string) {
    super(`capability matrix content hash mismatch: expected ${expected}, got ${actual}`);
    this.name = 'CapabilityMatrixHashMismatchError';
    this.expected = expected;
    this.actual = actual;
  }
}

function loadEmbeddedCapabilityMatrix(): CapabilityMatrix {
  const bytes = Buffer.from(CAPABILITY_MATRIX_V1_BASE64, 'base64');
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== FROZEN_MATRIX_SHA256) {
    throw new CapabilityMatrixHashMismatchError(FROZEN_MATRIX_SHA256, actual);
  }
  return parseCapabilityMatrix(bytes);
}

/** Parsed frozen capability matrix (hash-verified at module load). */
export const FROZEN_CAPABILITY_MATRIX: CapabilityMatrix = loadEmbeddedCapabilityMatrix();
