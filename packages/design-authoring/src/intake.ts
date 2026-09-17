/**
 * Authoring Bridge intake (Issue #39).
 *
 * Single immutable-byte intake seam: Workspace owns secure filesystem
 * collection and passes a normalized relative entry path plus a read-only
 * snapshot map. This module validates only the supplied bytes, binds semantic
 * asset references from exact captured bytes, imports into the BentoDoc
 * visual canonical, and returns canonical + content-addressed assets together.
 *
 * Vocabulary note (CONTEXT.md): no new domain glossary term is introduced.
 * Authoring Bridge is existing architecture vocabulary (solution.md §5.2);
 * intake/snapshot/semantic binding are implementation names for that bridge,
 * per Issue #39 Further Notes.
 *
 * Discipline:
 * - Never rereads the source filesystem; snapshot is the complete truth for
 *   validation, media lookup, hashing, and import.
 * - Snapshot remains caller-owned; it is never returned, persisted, or copied
 *   as a second truth. Only content-addressed asset bytes (subset) are returned.
 *   The parsed `validated` document is derived evidence for closure producers
 *   to avoid a second validation pass over the same snapshot; it is not a
 *   second copy of the raw bytes for audit artifacts.
 * - Two rejection categories preserved: validation diagnostics vs import
 *   unsupported issues. No new diagnostic vocabulary, no new MIME admission.
 * - Asset-bearing fields are image src, image-fill src, and custom-font src
 *   only (single truth in semantic-assets.ts). Unrelated strings beginning
 *   with `media/` are ignored.
 */

import { createHash } from "node:crypto";
import path from "node:path";
import type {
  BentoDocV4,
  ImportIssue,
  LiveDiagnostic,
  ValidatedArtwork,
} from "./contracts.ts";
import { importYaml } from "./canvas-format.ts";
import { liveDiagnosticCode, liveImportIssues } from "./live-diagnostics.ts";
import { listSemanticAssetRefs } from "./semantic-assets.ts";
import { validateSnapshot } from "./validate.ts";

export type AuthoringIntakeResult =
  | {
      status: "ok";
      document: BentoDocV4;
      /** SHA-256 hex -> exact captured bytes (content-addressed). */
      assets: Map<string, Uint8Array>;
      sourceMap: Record<string, readonly string[]>;
      profileVersion: string;
      degradations: readonly [];
      /**
       * Parsed validated document from the same snapshot, for closure
       * evidence selectors (native fields/elements). Derived evidence, not a
       * second copy of raw bytes for audit artifacts; avoids a parallel
       * validation pass over the same snapshot.
       */
      validated: ValidatedArtwork;
    }
  | {
      status: "invalid";
      diagnostics: LiveDiagnostic[];
    }
  | {
      status: "unsupported";
      issues: readonly ImportIssue[];
    };

const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/**
 * Deepen intake: validate snapshot bytes, bind semantic assets from exact
 * captured bytes, import into BentoDoc. Workspace collection errors occur
 * before this seam and remain outside the result.
 */
export function intakeAuthoring(
  entryRel: string,
  snapshot: ReadonlyMap<string, Uint8Array>,
): AuthoringIntakeResult {
  const normEntry = path.posix.normalize(entryRel);
  const validation = validateSnapshot(normEntry, snapshot);
  if (!validation.ok) {
    return { status: "invalid", diagnostics: validation.diagnostics };
  }
  const validated = validation.document;
  const pagePath = normEntry;
  const semantic = listSemanticAssetRefs(validated);
  const refs = [...new Set(semantic.map(({ ref }) => ref))].sort();
  const assetIndex: Record<string, string> = {};
  const assets = new Map<string, Uint8Array>();
  for (const ref of refs) {
    const bytes = snapshot.get(ref);
    if (bytes === undefined) {
      // Same snapshot validated above, so the validator already reported this
      // semantic ref as E005 at its authoritative path: reuse that exact
      // diagnostic instead of inventing a code/path/message here.
      const at = semantic.find((entry) => entry.ref === ref);
      return {
        status: "invalid",
        diagnostics: [
          {
            code: liveDiagnosticCode("PPTD-E005"),
            path: at !== undefined ? at.path : `${pagePath}#`,
            message: `引用媒体文件不存在：${ref}（相对 projectRoot）`,
          },
        ],
      };
    }
    const hash = sha256Hex(bytes);
    assetIndex[ref] = `asset:${hash}`;
    if (!assets.has(hash)) assets.set(hash, bytes);
  }
  const imported = importYaml(validated, assetIndex);
  if (imported.status !== "ok") {
    return { status: "unsupported", issues: liveImportIssues(imported.issues) };
  }
  return {
    status: "ok",
    document: imported.document,
    assets,
    sourceMap: imported.sourceMap,
    profileVersion: imported.profileVersion,
    degradations: imported.degradations,
    validated,
  };
}


