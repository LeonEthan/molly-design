/**
 * Structured Edit reconciliation (GitHub issue #40).
 *
 * One terminal user intent over a structured visual property, reconciled with
 * the latest canonical value before a kernel apply. The single pure seam
 * shared by the element-fill, style-border, table-fill, table-border, and
 * chart-data editors.
 *
 * - Intent is explicit: `unchanged`, `replace` with a complete structured
 *   snapshot, or `clear`. Form defaults are never mistaken for authored
 *   changes; a replacement always carries the complete form snapshot, never a
 *   sparse patch.
 * - `undefined` is the sole absence spelling at this seam. Callers translate
 *   their domain-specific null spelling (border unions, fill clears) before
 *   calling and translate back when applying.
 * - An empty object is a legitimate structured value, never absence.
 * - `unchanged` always yields `noop`: the caller dispatches nothing and keeps
 *   the latest canonical state.
 * - `clear` is an authoritative live gesture: it applies canonical absence
 *   whenever a latest value exists — even one that changed after mount — and
 *   is a `noop` when the latest value is already absent.
 * - `replace` that reconciles to the latest canonical value yields `noop`.
 *   Otherwise disjoint object-field changes merge (untouched fields keep the
 *   latest value; an explicit property deletion applies only when the latest
 *   property still equals the mounted base), arrays merge by index only while
 *   base, latest, and replacement keep the same length, and any concurrent
 *   same-scalar edit, container-shape change, array-length change, or
 *   modification-versus-deletion of one nested field fails closed as
 *   `conflict`. No element identity inference, no last-write-wins.
 * - Pure and Node-safe: no DOM reads, no dispatch, no messages, no editor
 *   lifecycle. Conflict notes and caller-specific recovery (transient remount,
 *   persistent grid rebase) stay in the panel layer. Inputs are never mutated
 *   and applied values share no mutable state with the inputs.
 */
import { canonicalJson } from "../../contracts/src/index.ts";

/** Explicit terminal intent of one Structured Edit gesture. */
export type StructuredEditIntent<T> =
  | { kind: "unchanged" }
  | { kind: "replace"; value: T }
  | { kind: "clear" };

/**
 * Reconciliation outcome. `apply` carries the value the caller should request
 * a kernel apply for (`undefined` = canonical absence); `noop` and `conflict`
 * dispatch nothing.
 */
export type StructuredEditDecision<T> =
  | { kind: "apply"; value: T | undefined }
  | { kind: "noop" }
  | { kind: "conflict" };

/** Semantic equality on canonical JSON spelling (shared by every structured editor). */
export function semanticEqual(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

const CONFLICT = Symbol("structured-edit conflict");
type MergeResult = unknown | typeof CONFLICT;

type ContainerShape = "missing" | "array" | "object" | "scalar";

function containerShape(value: unknown): ContainerShape {
  if (value === undefined) return "missing";
  if (Array.isArray(value)) return "array";
  if (isRecord(value)) return "object";
  return "scalar";
}

/**
 * Conservative three-way merge of a complete replacement snapshot. Returns
 * CONFLICT whenever the merge is not provable from index identity (arrays) or
 * per-field reconciliation (objects). Never mutates its inputs.
 */
function mergeValue(base: unknown, latest: unknown, draft: unknown): MergeResult {
  // Untouched nodes adopt the latest revision — including canonical absence,
  // so an unchanged form over an externally cleared value stays absent.
  if (semanticEqual(base, draft)) return latest === undefined ? undefined : structuredClone(latest);
  // No concurrent change: a local structural edit applies as staged.
  if (semanticEqual(base, latest)) return draft === undefined ? undefined : structuredClone(draft);
  // Converged nodes need no guess: both sides already agree.
  if (semanticEqual(draft, latest)) return latest === undefined ? undefined : structuredClone(latest);

  // Both sides changed this node. Merging is only provable while all three
  // retain the same container shape; otherwise the stale draft would silently
  // replace an incompatible concurrent value.
  const baseShape = containerShape(base);
  if (baseShape !== containerShape(latest) || baseShape !== containerShape(draft)) return CONFLICT;

  if (baseShape === "scalar") {
    // Both sides changed the same scalar to different values: choosing either
    // would silently clobber a concurrent edit.
    return CONFLICT;
  }

  if (Array.isArray(base) && Array.isArray(latest) && Array.isArray(draft)) {
    // Index identity is the only available array identity. A length change on
    // either concurrent side is still unreachable here when the other side is
    // untouched (handled above); any remaining length difference is a
    // concurrent length change and fails closed. A local addition/removal
    // therefore applies only while the latest array still equals the base.
    if (base.length !== latest.length || base.length !== draft.length) return CONFLICT;
    const merged: unknown[] = [];
    for (let index = 0; index < base.length; index += 1) {
      const value = mergeValue(base[index], latest[index], draft[index]);
      if (value === CONFLICT) return CONFLICT;
      merged.push(value);
    }
    return merged;
  }

  if (isRecord(base) && isRecord(latest) && isRecord(draft)) {
    // Start from the latest revision so untouched and concurrently added
    // fields survive; only reconciled draft fields are overlaid.
    const merged: Record<string, unknown> = structuredClone(latest);
    const keys = new Set([...Object.keys(base), ...Object.keys(latest), ...Object.keys(draft)]);
    for (const key of keys) {
      const baseHas = hasOwn(base, key);
      const latestHas = hasOwn(latest, key);
      const draftHas = hasOwn(draft, key);
      const baseValue = baseHas ? base[key] : undefined;
      const draftValue = draftHas ? draft[key] : undefined;
      if (baseHas === draftHas && semanticEqual(baseValue, draftValue)) continue;
      if (!draftHas) {
        if (!baseHas) continue;
        if (!latestHas) continue;
        if (semanticEqual(baseValue, latest[key])) {
          delete merged[key];
          continue;
        }
        // The draft deletes a property the latest revision concurrently
        // modified: deleting would silently erase newer work.
        return CONFLICT;
      }
      const value = mergeValue(baseValue, latestHas ? latest[key] : undefined, draftValue);
      if (value === CONFLICT) return CONFLICT;
      if (value === undefined && !latestHas) delete merged[key];
      else merged[key] = value;
    }
    return merged;
  }

  return CONFLICT;
}

/**
 * Reconcile one Structured Edit against the latest canonical value.
 *
 * - `unchanged` always yields `noop`.
 * - `clear` yields `noop` when the latest value is absent, otherwise an
 *   `apply` of canonical absence — authoritative even when the latest value
 *   changed after mount.
 * - `replace` yields `noop` when it reconciles to the latest value,
 *   `conflict` when the concurrent change is unprovable, otherwise an `apply`
 *   of the merged snapshot.
 */
export function reconcileStructuredEdit<T>(
  base: T | undefined,
  latest: T | undefined,
  intent: StructuredEditIntent<T>,
): StructuredEditDecision<T> {
  if (intent.kind === "unchanged") return { kind: "noop" };
  if (intent.kind === "clear") {
    return latest === undefined ? { kind: "noop" } : { kind: "apply", value: undefined };
  }
  const draft = intent.value;
  if (semanticEqual(draft, latest)) return { kind: "noop" };
  const merged = mergeValue(base, latest, draft);
  if (merged === CONFLICT) return { kind: "conflict" };
  const value = merged as T | undefined;
  if (semanticEqual(value, latest)) return { kind: "noop" };
  return { kind: "apply", value: value === undefined ? undefined : structuredClone(value) };
}
