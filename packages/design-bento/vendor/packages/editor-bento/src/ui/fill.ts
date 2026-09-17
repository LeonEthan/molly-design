/**
 * Persistent fill command builders (GD-4 #24).
 *
 * `setBackground` owns the document canvas fill.  Element fills use the
 * existing typed setStyle.fill patch; both forms carry the complete BentoFill
 * value so inverse/reproject never need to infer a second representation.
 */
import type { BentoFillV4, VisualCommandV4 } from "contracts";

/** Background is required; only element fills have a legal clear form. */
export function fillClearAllowed(command: "setStyle" | "setBackground"): boolean {
  return command === "setStyle";
}

/** canvas.background → document-level setBackground. */
export function backgroundCommands(background: BentoFillV4): VisualCommandV4[] {
  return [{ type: "setBackground", background: structuredClone(background) }];
}

/** shape/icon (and other eligible composite hosts) fill.* → setStyle.fill. */
export function fillCommands(id: string, fill: BentoFillV4 | null): VisualCommandV4[] {
  return [{ type: "setStyle", targetId: id, patch: { fill: structuredClone(fill) } }];
}
