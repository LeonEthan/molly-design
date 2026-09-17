/** Persistent font-family/registration command builders (GD-4 #24). */
import type { BentoFontFamilyV4, BentoFontRegistrationV4, VisualCommandV4 } from "contracts";

/** font.familyUniform/familyLatinEa → text host setStyle.fontFamily. */
export function fontFamilyCommands(id: string, fontFamily: BentoFontFamilyV4 | null): VisualCommandV4[] {
  return [{ type: "setStyle", targetId: id, patch: { fontFamily: fontFamily === null ? null : structuredClone(fontFamily) } }];
}

/** font.registration add (asset must already be registered by the host). */
export function addFontRegistrationCommand(font: BentoFontRegistrationV4): VisualCommandV4[] {
  return [{ type: "addFontRegistration", font: structuredClone(font) }];
}

/** font.registration remove by its identity tuple. */
export function removeFontRegistrationCommand(
  family: string,
  weight?: string,
  style?: string,
): VisualCommandV4[] {
  return [{
    type: "removeFontRegistration",
    family,
    ...(weight !== undefined ? { weight } : {}),
    ...(style !== undefined ? { style } : {}),
  }];
}
