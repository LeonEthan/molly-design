/** Font family + registration controls (GD-4 #24). */
import { sniffStaticV1FontMime, type BentoDocV4, type BentoFontRegistrationV4 } from "contracts";
import { addFontRegistrationCommand, removeFontRegistrationCommand } from "../font.ts";
import { hostRegisterAsset, type PanelContext } from "./context.ts";
import { button, row, section, textInput } from "./primitives.ts";

/**
 * Build a font data URI from admitted bytes, using the byte signature as the
 * MIME authority.  File.name/file.type are only upload hints and can disagree
 * (the fixture intentionally carries an OTF payload under a `.ttf` name).
 * Unknown or structurally invalid bytes fail closed before reaching the host.
 */
export function fontDataUriFromBytes(bytes: Uint8Array): string | null {
  const mime = sniffStaticV1FontMime(bytes);
  if (mime === null) return null;
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

/** Register a font file by content hash before emitting addFontRegistration. */
function pickFontFile(onAsset: (assetKey: string) => void): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "font/ttf,font/otf,font/woff,font/woff2,.ttf,.otf,.woff,.woff2";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file) return;
    void (async () => {
      const bytes = await file.arrayBuffer();
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      const assetKey = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      const dataUri = fontDataUriFromBytes(new Uint8Array(bytes));
      if (dataUri === null) return;
      if (!hostRegisterAsset(assetKey, dataUri)) return;
      onAsset(assetKey);
    })().catch(() => undefined);
  });
  input.click();
}

function identityLabel(font: BentoFontRegistrationV4): string {
  return `${font.family}${font.weight ? ` / ${font.weight}` : ""}${font.style ? ` / ${font.style}` : ""}`;
}

/** Document-level registered font list and content-addressed add flow. */
export function renderFontPanel(host: HTMLElement, ctx: PanelContext, doc: BentoDocV4): void {
  host.appendChild(section("Fonts"));
  const family = textInput("", () => undefined, "addFontRegistration");
  const weight = textInput("", () => undefined, "addFontRegistration");
  const style = textInput("", () => undefined, "addFontRegistration");
  host.appendChild(row("Family", family));
  host.appendChild(row("Weight", weight));
  host.appendChild(row("Style", style));
  // The registration count is visible in the same terminal control, giving
  // the file-picker gesture a concrete DOM before/after without weakening the
  // stable command/class contract.
  host.appendChild(button(`Register font… (${(doc.fonts ?? []).length})`, () => {
    const value = family.value.trim();
    if (value.length === 0) return;
    pickFontFile((assetKey) => {
      const font: BentoFontRegistrationV4 = {
        family: value,
        src: `asset:${assetKey}`,
        ...(weight.value.trim() ? { weight: weight.value.trim() } : {}),
        ...(style.value.trim() ? { style: style.value.trim() } : {}),
      };
      ctx.dispatch(addFontRegistrationCommand(font));
    });
  }, "addFontRegistration"));
  for (const font of doc.fonts ?? []) {
    const line = document.createElement("div");
    line.className = "c2a-row";
    const label = document.createElement("span");
    label.textContent = identityLabel(font);
    label.style.flex = "1";
    line.appendChild(label);
    line.appendChild(button("Remove", () => {
      ctx.dispatch(removeFontRegistrationCommand(font.family, font.weight, font.style));
    }, "removeFontRegistration"));
    host.appendChild(line);
  }
}
