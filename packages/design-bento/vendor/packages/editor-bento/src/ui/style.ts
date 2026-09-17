/**
 * Persistent common-style command builders (GD-4 #24).
 *
 * These are deliberately narrow command constructors.  The editor surface
 * owns the values, while the kernel remains the only validator and writer;
 * no native/store-shaped payload is accepted here.
 */
import type { BentoBorder, BentoShadow } from "contracts";
import type { BentoGradientFillV4, VisualCommandV4 } from "contracts";

/** Common text color (text.color) as one exact setStyle command. */
export function colorCommands(id: string, color: string | null): VisualCommandV4[] {
  return [{ type: "setStyle", targetId: id, patch: { color } }];
}

/** Shared border (common.border) as one exact setBorder command. */
export function borderCommands(id: string, border: BentoBorder | null): VisualCommandV4[] {
  return [{ type: "setBorder", targetId: id, border: border === null ? null : structuredClone(border) }];
}

/** Shared/text shadow (common.shadow/text.shadow) as one exact setShadow command. */
export function shadowCommands(id: string, shadow: BentoShadow | BentoShadow[] | null): VisualCommandV4[] {
  return [{ type: "setShadow", targetId: id, shadow: shadow === null ? null : structuredClone(shadow) }];
}

/** Text gradient (text.gradient) as one exact setStyle command. */
export function textGradientCommands(id: string, gradient: BentoGradientFillV4 | null): VisualCommandV4[] {
  return [{ type: "setStyle", targetId: id, patch: { gradient: gradient === null ? null : structuredClone(gradient) } }];
}
