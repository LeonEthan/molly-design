/**
 * Lossless editor for Bento's `string | { latin, ea }` font-family union.
 *
 * The mode selector is a UI-only choice: switching it never writes canonical
 * state. A field change is the terminal gesture and emits either one uniform
 * family or the complete Latin/EA pair while rereading the latest sibling so
 * sequential edits cannot roll the other half back.
 */
import type { BentoFontFamilyV4 } from "contracts";
import { row, select, textInput } from "./primitives.ts";

export interface FontFamilyControlsOptions {
  host: HTMLElement;
  label: string;
  initial?: BentoFontFamilyV4;
  onCommit: (family: BentoFontFamilyV4 | null) => void;
  command: string;
  readCurrent?: () => BentoFontFamilyV4 | undefined;
  prefix?: string;
}

export function renderFontFamilyControls({
  host,
  label,
  initial,
  onCommit,
  command,
  readCurrent,
  prefix,
}: FontFamilyControlsOptions): void {
  const startingFamily = initial ?? "MiSans";
  let mode: "uniform" | "split" = typeof startingFamily === "object" ? "split" : "uniform";
  const input = (value: string, onChange: (value: string) => void, suffix = ""): HTMLInputElement => {
    const control = textInput(value, onChange, command);
    if (prefix !== undefined) control.classList.add(`${prefix}-font-family${suffix}`);
    return control;
  };
  const fields = document.createElement("div");
  fields.className = "c2a-font-family-fields";
  const renderFields = (value: BentoFontFamilyV4): void => {
    fields.replaceChildren();
    if (mode === "uniform") {
      const uniform = typeof value === "string" ? value : value.latin;
      fields.appendChild(row(label, input(uniform, (next) => {
        onCommit(next.trim() === "" ? null : next.trim());
      })));
      return;
    }
    const split = typeof value === "object" ? value : { latin: value, ea: value };
    fields.appendChild(row(`${label} Latin`, input(split.latin, (next) => {
      const latest = readCurrent?.();
      const ea = typeof latest === "object" ? latest.ea : split.ea;
      const latin = next.trim();
      if (latin === "" || ea.trim() === "") return;
      onCommit({ latin, ea });
    }, "-latin")));
    fields.appendChild(row(`${label} EA`, input(split.ea, (next) => {
      const latest = readCurrent?.();
      const latin = typeof latest === "object" ? latest.latin : split.latin;
      const ea = next.trim();
      if (latin.trim() === "" || ea === "") return;
      onCommit({ latin, ea });
    }, "-ea")));
  };
  const modeSelect = select(
    [{ value: "uniform", label: "uniform" }, { value: "split", label: "Latin + EA" }],
    mode,
    (value) => {
      mode = value === "split" ? "split" : "uniform";
      renderFields(readCurrent?.() ?? startingFamily);
    },
  );
  if (prefix !== undefined) modeSelect.classList.add(`${prefix}-font-family-mode`);
  host.appendChild(row(`${label} mode`, modeSelect));
  renderFields(startingFamily);
  host.appendChild(fields);
}
