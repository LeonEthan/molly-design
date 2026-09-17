/** Persistent icon.name command builders (GD-4 #24). */
import type { VisualCommandV4 } from "contracts";

/** icon.name → canonical style:name setIconName command. */
export function iconNameCommands(id: string, iconName: string): VisualCommandV4[] {
  return [{ type: "setIconName", targetId: id, iconName }];
}
