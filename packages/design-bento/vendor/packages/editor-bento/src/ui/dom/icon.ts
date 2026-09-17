/** Icon name composite editor (GD-4 #24). */
import type { BentoIconElementV4 } from "contracts";
import { iconNameCommands } from "../icon.ts";
import { button, row, section, textInput } from "./primitives.ts";
import type { PanelContext } from "./context.ts";

/**
 * The field deliberately accepts the canonical `fas:...`/`far:...`/`fab:...`
 * form (and aliases accepted by the kernel).  Membership stays centralized in
 * the kernel/static-v1 resolver instead of duplicating the generated shelf.
 */
export function renderIconPanel(host: HTMLElement, ctx: PanelContext): void {
  if (ctx.element.kind !== "icon") return;
  const element = ctx.element as BentoIconElementV4;
  const input = textInput(element.iconName, () => undefined, "setIconName");
  host.appendChild(section("Icon"));
  host.appendChild(row("Name", input));
  host.appendChild(button("Apply icon", () => {
    const value = input.value.trim();
    if (value.length > 0) ctx.dispatch(iconNameCommands(element.id, value));
  }, "setIconName"));
}
