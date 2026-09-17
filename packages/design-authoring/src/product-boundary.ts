/**
 * Closed-world router for product inputs that are not YAML artwork fields.
 *
 * These requests are deliberately routed at the authoring input boundary,
 * before manifest parsing can reinterpret them as arbitrary YAML.  A valid
 * request gets the matrix's named product-boundary refusal; malformed input
 * gets a structural E001 and can never be turned into a rejection claim.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import type { LiveDiagnostic, ValidationResult } from "./contracts.ts";
import { FROZEN_CAPABILITY_MATRIX } from "./capability-matrix.ts";
import { liveDiagnosticCode } from "./live-diagnostics.ts";

type Raw = Record<string, unknown>;

type ProductBoundaryInputKind =
  | "pptx-slide-transition"
  | "media-timeline"
  | "pptx-document"
  | "renderer-runtime-request";

interface ProductBoundaryRejection {
  readonly accepted: false;
  readonly canonicalProduced: false;
  readonly failureCode: "PPTD-E011";
  readonly capabilityId: string;
  readonly inputKind: ProductBoundaryInputKind;
  readonly message: string;
}

interface ProductBoundaryMalformedInput {
  readonly accepted: false;
  readonly canonicalProduced: false;
  readonly failureCode: "PPTD-E001";
  readonly message: string;
}

type ProductBoundaryRouteResult = ProductBoundaryRejection | ProductBoundaryMalformedInput;

interface RouteContract {
  /** Frozen matrix capabilityId; may remain common.kimiRuntime. */
  readonly capabilityId: string;
  /** Molly-facing probe id; remote renderer is not named Kimi. */
  readonly liveCapabilityId: string;
  readonly requiredPayload: readonly string[];
}

const ROUTES: Readonly<Record<ProductBoundaryInputKind, RouteContract>> = Object.freeze({
  "pptx-slide-transition": {
    capabilityId: "common.transitions",
    liveCapabilityId: "common.transitions",
    requiredPayload: ["slideId", "transition"],
  },
  "media-timeline": {
    capabilityId: "common.audioVideo",
    liveCapabilityId: "common.audioVideo",
    requiredPayload: ["media", "timeline"],
  },
  "pptx-document": {
    capabilityId: "common.pptxInterop",
    liveCapabilityId: "common.pptxInterop",
    requiredPayload: ["format", "operation", "documentName"],
  },
  "renderer-runtime-request": {
    capabilityId: "common.kimiRuntime",
    liveCapabilityId: "common.remoteRenderer",
    requiredPayload: ["renderer", "runtime", "operation"],
  },
});

const FROZEN_MATRIX = FROZEN_CAPABILITY_MATRIX;
for (const [inputKind, route] of Object.entries(ROUTES)) {
  const row = FROZEN_MATRIX.rows.find((candidate) => candidate.capabilityId === route.capabilityId);
  if (row?.profileState !== "excluded" || !row.failureCode.includes("PPTD-E011")) {
    throw new Error(`product-boundary route is not backed by an excluded E011 matrix row: ${inputKind}`);
  }
}

function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function malformed(message: string): ProductBoundaryMalformedInput {
  return {
    accepted: false,
    canonicalProduced: false,
    failureCode: "PPTD-E001",
    message,
  };
}

function exactKeys(value: Raw, required: readonly string[]): string | null {
  const allowed = new Set(required);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown !== undefined) return `unknown field "${unknown}"`;
  const missing = required.find((key) => !Object.prototype.hasOwnProperty.call(value, key));
  return missing === undefined ? null : `missing field "${missing}"`;
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function finiteNonNegative(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function payloadShapeError(inputKind: ProductBoundaryInputKind, payload: Raw): string | null {
  switch (inputKind) {
    case "pptx-slide-transition": {
      if (!nonEmptyString(payload.slideId)) return "payload.slideId must be a non-empty string";
      if (!isRecord(payload.transition)) return "payload.transition must be an object";
      if (!nonEmptyString(payload.transition.type)) return "payload.transition.type must be a non-empty string";
      if (!finiteNonNegative(payload.transition.durationMs)) return "payload.transition.durationMs must be a non-negative number";
      return null;
    }
    case "media-timeline": {
      if (!isRecord(payload.media)) return "payload.media must be an object";
      if (payload.media.kind !== "audio" && payload.media.kind !== "video") return "payload.media.kind must be audio or video";
      if (!nonEmptyString(payload.media.src)) return "payload.media.src must be a non-empty string";
      if (!Array.isArray(payload.timeline) || payload.timeline.length === 0) return "payload.timeline must be a non-empty array";
      for (const [index, item] of payload.timeline.entries()) {
        if (!isRecord(item) || !finiteNonNegative(item.startMs) || !finiteNonNegative(item.endMs) || (item.endMs as number) < (item.startMs as number)) {
          return `payload.timeline[${index}] must contain non-negative startMs/endMs with endMs >= startMs`;
        }
      }
      return null;
    }
    case "pptx-document":
      if (payload.format !== "pptx") return "payload.format must be pptx";
      if (!nonEmptyString(payload.operation)) return "payload.operation must be a non-empty string";
      if (!nonEmptyString(payload.documentName)) return "payload.documentName must be a non-empty string";
      return null;
    case "renderer-runtime-request":
      if (payload.renderer !== "remote") return "payload.renderer must be remote";
      if (payload.runtime !== "remote") return "payload.runtime must be remote";
      if (!nonEmptyString(payload.operation)) return "payload.operation must be a non-empty string";
      return null;
  }
  // Unreachable: ProductBoundaryInputKind is a closed union over the cases above.
  throw new Error("unreachable: unknown product-boundary input kind");
}

/**
 * Route one external product input.  Only the four exact input kinds above
 * can reach the E011 refusal; arbitrary objects and empty/wrong-shaped
 * payloads are structural E001 failures.
 */
function routeProductBoundaryInput(input: unknown): ProductBoundaryRouteResult {
  if (!isRecord(input)) return malformed("product-boundary input must be an object");
  const shapeError = exactKeys(input, ["probeVersion", "capabilityId", "inputKind", "payload"]);
  if (shapeError !== null) return malformed(`product-boundary input ${shapeError}`);
  if (input.probeVersion !== 1) return malformed("product-boundary input probeVersion must be 1");
  if (typeof input.inputKind !== "string" || !(input.inputKind in ROUTES)) {
    return malformed("product-boundary input inputKind is not supported");
  }
  const inputKind = input.inputKind as ProductBoundaryInputKind;
  const route = ROUTES[inputKind];
  if (input.capabilityId !== route.liveCapabilityId) {
    return malformed(`product-boundary input capabilityId does not match ${inputKind}`);
  }
  if (!isRecord(input.payload) || Object.keys(input.payload).length === 0) {
    return malformed(`product-boundary input ${route.liveCapabilityId} payload must be a non-empty object`);
  }
  const payloadError = exactKeys(input.payload, route.requiredPayload);
  if (payloadError !== null) return malformed(`product-boundary input ${route.liveCapabilityId} payload ${payloadError}`);
  const valueError = payloadShapeError(inputKind, input.payload);
  if (valueError !== null) return malformed(`product-boundary input ${route.liveCapabilityId} ${valueError}`);
  const presented =
    inputKind === "renderer-runtime-request" ? "remote renderer" : route.liveCapabilityId;
  return {
    accepted: false,
    canonicalProduced: false,
    failureCode: "PPTD-E011",
    capabilityId: route.capabilityId,
    inputKind,
    message: `${presented} is outside the single-canvas YAML artwork product boundary (${inputKind})`,
  };
}

function diagnostic(file: string, result: ProductBoundaryRouteResult): LiveDiagnostic {
  return { code: liveDiagnosticCode(result.failureCode), path: `${file}#`, message: result.message };
}

function unread(file: string, message: string): ValidationResult {
  return {
    ok: false,
    diagnostics: [{ code: liveDiagnosticCode("PPTD-E001"), path: `${file}#`, message }],
  };
}

/**
 * Read a JSON product-boundary request for validate().  A `.json` entry is an
 * explicit boundary input, so malformed JSON is E001 instead of being
 * reinterpreted as a legal YAML manifest.  Other extensions remain on the
 * existing YAML validator path.
 */
export function validateProductBoundaryFile(entryPath: string): ValidationResult | null {
  if (path.extname(entryPath).toLowerCase() !== ".json") return null;
  const file = path.basename(entryPath);
  let text: string;
  try {
    text = readFileSync(entryPath, "utf8");
  } catch {
    return unread(file, `文件不可读：${file}`);
  }
  return validateProductBoundaryText(file, text);
}

/**
 * Snapshot variant of the product-boundary gate. Reads only the supplied
 * immutable bytes; never touches the source filesystem. Diagnostic codes,
 * paths, and messages match the file variant byte-for-byte.
 *
 * @internal composition seam for validateSnapshot/intake only.
 */
export function validateProductBoundarySnapshot(
  entryRel: string,
  snapshot: ReadonlyMap<string, Uint8Array>,
): ValidationResult | null {
  if (path.posix.extname(entryRel).toLowerCase() !== ".json") return null;
  const file = entryRel.split("/").pop() ?? entryRel;
  const bytes = snapshot.get(entryRel);
  if (bytes === undefined) {
    return unread(file, `文件不可读：${file}`);
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8").decode(bytes);
  } catch {
    return unread(file, `文件不可读：${file}`);
  }
  return validateProductBoundaryText(file, text);
}

function validateProductBoundaryText(file: string, text: string): ValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return unread(
      file,
      `不是合法 product-boundary JSON：${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
    );
  }
  const routed = routeProductBoundaryInput(parsed);
  return { ok: false, diagnostics: [diagnostic(file, routed)] };
}
