/**
 * Composite fill editor (GD-4 #24).
 *
 * The same editor owns canvas.background and eligible element fill values.
 * Every terminal action hands a complete BentoFillV4 to a typed command
 * builder; no CSS/native fill payload is written from this module.
 */
import type {
  BentoColorStop,
  BentoFillV4,
  BentoImageFillV4,
  BentoLinearGradientFill,
  BentoRadialGradientFillV4,
} from "contracts";
import { backgroundCommands, fillClearAllowed, fillCommands } from "../fill.ts";
import { parseCropRatios } from "../image.ts";
import { pickImageFile } from "./image.ts";
import {
  compositeConflictNote,
  gradientAngleControls,
  gradientStopsEditor,
  semanticEqual,
  stagedCropInputs,
} from "./context.ts";
import { reconcileStructuredEdit } from "kernel";
import { button, colorInput, numberInput, parseHexColor, parseNumberInputValue, row, section, select } from "./primitives.ts";
import type { VisualCommandV4 } from "contracts";

type FillCommit = (fill: BentoFillV4 | null) => void;

const FILL_TYPES = ["solid", "linear", "radial", "image"] as const;
type FillType = (typeof FILL_TYPES)[number];

const fallbackStops = (): BentoColorStop[] => [
  { position: 0, color: "#000000" },
  { position: 1, color: "#FFFFFF" },
];

function fillType(fill: BentoFillV4 | undefined): FillType {
  if (fill?.type === "solid") return "solid";
  if (fill?.type === "gradient") return fill.gradientType === "radial" ? "radial" : "linear";
  if (fill?.type === "image") return "image";
  return "solid";
}

function defaultFill(type: FillType): BentoFillV4 {
  if (type === "solid") return { type: "solid", color: "#FFFFFF" };
  if (type === "image") return { type: "image", src: `asset:${"0".repeat(64)}`, fit: "contain" };
  return {
    type: "gradient",
    gradientType: type,
    stops: fallbackStops(),
    ...(type === "linear" ? { angle: 90 } : {}),
  } as BentoLinearGradientFill | BentoRadialGradientFillV4;
}

function readGradient(
  fill: Extract<BentoFillV4, { type: "gradient" }>,
  stops: readonly BentoColorStop[],
  angle: number | undefined,
  gradientType: "linear" | "radial" = fill.gradientType,
): BentoFillV4 | null {
  if (stops.length < 2 || stops.some((stop) => !Number.isFinite(stop.position) || stop.position < 0 || stop.position > 1 || parseHexColor(stop.color) === undefined)) return null;
  return {
    type: "gradient",
    gradientType,
    stops: stops.map((stop) => ({ ...stop })),
    ...(gradientType === "linear" && angle !== undefined ? { angle } : {}),
  };
}

type GradientDraft = { stops: BentoColorStop[]; angle?: number };
type GradientDraftReader = () => GradientDraft | null;

function renderGradient(
  host: HTMLElement,
  fill: Extract<BentoFillV4, { type: "gradient" }>,
  commit: FillCommit,
  command: string,
  gradientType: () => "linear" | "radial" = () => fill.gradientType,
  registerDraft?: (reader: GradientDraftReader) => void,
  markDirty?: () => void,
): void {
  const linear = fill.gradientType === "linear" ? fill as BentoLinearGradientFill : undefined;
  const angleControls = linear !== undefined ? gradientAngleControls(linear.angle, command, markDirty) : undefined;
  const angle = angleControls?.angle;
  const angleOpts = { min: 0, max: 360, maxExclusive: true, step: 1 } as const;
  const editor = gradientStopsEditor(fill.stops, {
    hostClass: "c2a-fill-gradient-stops",
    step: 0.01,
    command,
    addedStop: { position: 1, color: "#FFFFFF" },
    onEdit: markDirty,
    // A non-blank invalid angle fails the whole draft closed, including the
    // structural +Stop/−Stop gestures.
    draftValid: () => angle === undefined || angle.value.trim() === "" || parseNumberInputValue(angle.value, angleOpts) !== undefined,
    decoratePosition: (input, index) => {
      input.classList.add("ed-a1a2-fill-stop-position");
      input.dataset.stopIndex = String(index);
    },
    decorateColor: (input, index) => {
      input.classList.add("ed-a1a2-fill-stop-color");
      input.dataset.stopIndex = String(index);
    },
    renderStop: (index, position, color) => {
      const line = document.createElement("div");
      line.className = "c2a-row";
      line.append(document.createTextNode(`#${index + 1}`), position, color);
      return line;
    },
  });
  const readDraft: GradientDraftReader = () => {
    const stops = editor.readStopsDraft();
    if (stops === null) return null;
    const rawAngle = angle === undefined || angle.value.trim() === "" ? undefined : parseNumberInputValue(angle.value, angleOpts);
    if (angle !== undefined && angle.value.trim() !== "" && rawAngle === undefined) return null;
    return { stops, ...(rawAngle === undefined ? {} : { angle: rawAngle }) };
  };
  registerDraft?.(readDraft);
  host.appendChild(editor.stopHost);
  host.appendChild(row("Stops", document.createElement("span")));
  if (angleControls !== undefined) host.appendChild(row("Angle", angleControls.angle));
  if (angleControls !== undefined) host.appendChild(angleControls.reset);
  host.appendChild(editor.addStop);
  host.appendChild(editor.removeStop);
  host.appendChild(button("Apply gradient", () => {
    const draft = readDraft();
    if (draft === null) return;
    const next = readGradient(fill, draft.stops, draft.angle, gradientType());
    if (next !== null) commit(next);
  }, "setStyle"));
}

function renderImageFill(
  host: HTMLElement,
  fill: BentoImageFillV4,
  commit: FillCommit,
  command: string,
  readCurrent?: () => BentoFillV4 | undefined,
): void {
  const currentImage = (): BentoImageFillV4 | undefined => {
    const current = readCurrent?.();
    if (readCurrent !== undefined) return current?.type === "image" ? current : undefined;
    return fill;
  };
  const commitImage = (next: BentoImageFillV4): void => {
    const current = currentImage();
    if (current === undefined || semanticEqual(current, next)) return;
    commit(next);
  };
  host.appendChild(button("Choose fill image…", () => {
    pickImageFile((assetKey) => {
      const current = currentImage();
      if (current === undefined) return;
      commitImage({
      ...structuredClone(current),
      type: "image",
      src: `asset:${assetKey}`,
      });
    });
  }, command));
  host.appendChild(row("Fit", select(
    ["fill", "contain", "cover"].map((value) => ({ value, label: value })),
    fill.fit ?? "contain",
    (value) => {
      const current = currentImage();
      if (current === undefined) return;
      commitImage({ ...structuredClone(current), fit: value as BentoImageFillV4["fit"] });
    },
    command,
  )));
  const cropInputs = stagedCropInputs(fill.crop, { command });
  const initialOpacityValue = String(fill.opacity ?? 1);
  let opacityTouched = false;
  let opacity: HTMLInputElement;
  ["l", "t", "r", "b"].forEach((edge, index) => host.appendChild(row(`Crop ${edge}`, cropInputs[index]!)));
  host.appendChild(button("Apply fill crop", () => {
    const rawCrop = cropInputs.map((input) => input.value);
    const current = currentImage();
    if (current === undefined) return;
    const next = structuredClone(current);
    if (!rawCrop.every((value) => value.trim() === "")) {
      const crop = parseCropRatios(rawCrop);
      if (crop === null) return;
      next.crop = crop;
    }
    const rawOpacity = opacity.value.trim();
    const opacityIsUntouchedFallback = !opacityTouched && rawOpacity === initialOpacityValue && fill.opacity === undefined;
    if (rawOpacity !== "" && (!opacityIsUntouchedFallback || fill.opacity !== undefined)) {
      const parsedOpacity = parseNumberInputValue(rawOpacity, { min: 0, max: 1, step: 0.01 });
      if (parsedOpacity === undefined) return;
      next.opacity = parsedOpacity;
    }
    if (semanticEqual(current, next)) return;
    commitImage(next);
  }, command));
  host.appendChild(button("Reset crop", () => {
    const current = currentImage();
    if (current === undefined) return;
    const next = structuredClone(current);
    if (next.crop === undefined) return;
    delete next.crop;
    commitImage(next);
  }, command));
  opacity = numberInput(fill.opacity ?? 1, () => {
    // Keep opacity in the same composite terminal gesture as crop.
    opacityTouched = true;
  }, { min: 0, max: 1, step: 0.01 }, command);
  host.appendChild(row("Opacity", opacity));
  host.appendChild(button("Reset opacity", () => {
    const current = currentImage();
    if (current === undefined) return;
    const next = structuredClone(current);
    if (next.opacity === undefined) return;
    delete next.opacity;
    commitImage(next);
  }, command));
}

/** Render a complete fill editor. `command` is setStyle or setBackground. */
export function renderFillPanel(
  host: HTMLElement,
  current: BentoFillV4 | undefined,
  commit: FillCommit,
  command: "setStyle" | "setBackground",
  title = "Fill",
  readCurrent?: () => BentoFillV4 | undefined,
): void {
  host.appendChild(section(title));
  const type = fillType(current);
  const fill = current ?? defaultFill(type);
  let selectedType = type;
  let readGradientDraft: GradientDraftReader | undefined;
  let draftDirty = false;
  const latestFill = (): BentoFillV4 | undefined => readCurrent === undefined ? current : readCurrent();
  const conflictNote = compositeConflictNote(
    "c2aFillConflict",
    "This fill changed underneath the editor; the conflicting edit was not applied. The panel refreshes to the current value once focus leaves.",
  );
  const commitFill = (next: BentoFillV4 | null): void => {
    conflictNote.hidden = true;
    const decision = reconcileStructuredEdit(
      current,
      latestFill(),
      next === null
        ? { kind: "clear" }
        : draftDirty
          ? { kind: "replace", value: next }
          : { kind: "unchanged" },
    );
    if (decision.kind === "conflict") {
      conflictNote.hidden = false;
      return;
    }
    if (decision.kind === "noop") return;
    commit(decision.value ?? null);
  };
  host.appendChild(row("Type", select(
    FILL_TYPES.map((value) => ({ value, label: value })),
    type,
    (value) => {
      const nextType = value as FillType;
      if (nextType === "image") {
        // Image fills are content addressed. Open the real asset picker before
        // dispatching so no placeholder src can enter canonical.
        pickImageFile((assetKey) => {
          selectedType = "image";
          draftDirty = true;
          commitFill({ type: "image", src: `asset:${assetKey}`, fit: "contain" });
        });
        return;
      }
      selectedType = nextType;
      draftDirty = true;
      const next = defaultFill(nextType);
      if (next.type === "gradient" && fill.type === "gradient") {
        const draft = readGradientDraft?.();
        if (draft === null) return;
        const draftStops = draft?.stops ?? fill.stops;
        const draftAngle = draft?.angle ?? (fill.gradientType === "linear" ? fill.angle : undefined);
        commitFill({
          ...next,
          stops: draftStops.map((stop) => ({ ...stop })),
          ...(next.gradientType === "linear" && draftAngle !== undefined
            ? { angle: draftAngle }
            : {}),
        });
      } else {
        commitFill(next);
      }
    },
    command,
  )));
  if (fill.type === "solid") {
    host.appendChild(row("Color", colorInput(fill.color, (value) => {
      draftDirty = true;
      commitFill({ type: "solid", color: value });
    }, command)));
  } else if (fill.type === "gradient") {
    renderGradient(host, fill, commitFill, command, () => selectedType === "radial" ? "radial" : "linear", (reader) => {
      readGradientDraft = reader;
    }, () => { draftDirty = true; });
  } else {
    renderImageFill(host, fill, commitFill, command, readCurrent);
  }
  if (fillClearAllowed(command)) host.appendChild(button("Clear fill", () => {
    commitFill(null);
  }, command));
  host.appendChild(conflictNote);
}

/** Element fill adapter: exact setStyle.fill command, useful to panels/tests. */
export function renderElementFillPanel(
  host: HTMLElement,
  fill: BentoFillV4 | undefined,
  id: string,
  dispatch: (commands: readonly VisualCommandV4[]) => void,
  readCurrent?: () => BentoFillV4 | undefined,
): void {
  renderFillPanel(host, fill, (next) => dispatch(fillCommands(id, next)), "setStyle", "Fill", readCurrent);
}

/** Document canvas background adapter: exact setBackground command. */
export function renderBackgroundFillPanel(
  host: HTMLElement,
  background: BentoFillV4,
  dispatch: (commands: readonly VisualCommandV4[]) => void,
  readCurrent?: () => BentoFillV4 | undefined,
): void {
  renderFillPanel(host, background, (next) => {
    if (next !== null) dispatch(backgroundCommands(next));
  }, "setBackground", "Canvas background", readCurrent);
}
