/**
 * C2-A edit surface — table 面板（GD-4c Wave C2 ticket #12；浏览器侧薄 DOM；
 * 命令来自 ui/table.ts 纯映射）。
 *
 * 行/列增（setTableShape grow）；比例、样式槽位、body cycle、行列冲突规则、
 * 单元格文本/富文本、填充、边框、对齐、合并/拆分均在这里组成真实控件，
 * 终态手势统一经 bridge.dispatch → kernel。面板不保存 canonical 镜像：每个
 * callback 都从 bridge.snapshot() 重读，以免连续 composite 手势覆盖旧 revision。
 */
import {
  button,
  checkbox,
  colorInput,
  numberInput,
  parseHexColor,
  parseNumberInputValue,
  row,
  section,
  select,
  textInput,
  textareaInput,
} from "./primitives.ts";
import { renderFontFamilyControls } from "./font-family.ts";
import {
  anchorCell,
  canMerge,
  cellStyleCommands,
  cellTextCommands,
  cellTextContentStyleCommands,
  cellTextParagraphStyleCommands,
  cellTextRunStyleCommands,
  growCommands,
  mergeCommands,
  rowOverColumnCommands,
  splitCommands,
  tableBodyStyleAppendCommands,
  tableBodyStyleEditCommands,
  tableBodyStyleRemoveCommands,
  tableGridDraftMatches,
  tableGridCommands,
  normalizeRatios,
  tableStyleCommands,
  tableStyleClearLabel,
  tableStyleSlotCommands,
  TABLE_STYLE_SLOTS,
  isAssetFillSource,
  expandCellBorderSides,
  type TableBorderSidesV4,
  type TableStyleSlotV4,
  type TableTextContentStylePatchV4,
  type TableTextParagraphStylePatchV4,
  type TableTextRunStylePatchV4,
} from "../table.ts";
import { compositeConflictNote, currentDoc, gradientAngleControls, gradientStopsEditor, semanticEqual, stagedCropInputs, type PanelContext } from "./context.ts";
import { reconcileStructuredEdit } from "kernel";
import { pickImageFile } from "./image.ts";
import {
  parseLineHeightValue,
  resolveStaticV1TextStyle,
  type BentoAlignmentV4,
  type BentoBorderSpecV4,
  type BentoCellBorderV4,
  type BentoDocV4,
  type BentoFillV4,
  type BentoImageFillV4,
  type BentoParagraphListV4,
  type BentoTableCellStyleV4,
  type BentoTableCellV4,
  type BentoTableElementV4,
  type BentoTableStyleV4,
  type BentoTextContentV4,
  type BentoTextParagraphV4,
  type BentoTextRunV4,
  type TableCellStylePatchV4,
  type VisualCommandV4,
} from "contracts";
import { parseCropRatios } from "../image.ts";

export interface TableCellAnchor {
  elId: string;
  /** 逻辑坐标（td data-r/data-c）。 */
  row: number;
  col: number;
}

const H_ALIGNS = ["left", "center", "right", "justify", "distributed"] as const;
const V_ALIGNS = ["top", "middle", "bottom"] as const;
const CELL_BORDER_STYLE = ["", "__default__", "solid", "dash", "dot"] as const;
const CELL_BORDER_STYLE_DEFAULT = "__default__";
const FILL_TYPES = ["none", "solid", "linear", "radial", "image"] as const;
const IMAGE_FITS = ["fill", "contain", "cover"] as const;
const STYLE_SLOT_LABELS: Record<TableStyleSlotV4, string> = {
  cellStyle: "All cells",
  firstRowStyle: "First row",
  lastRowStyle: "Last row",
  firstColumnStyle: "First column",
  lastColumnStyle: "Last column",
};

type FillKind = (typeof FILL_TYPES)[number];
type BorderSides = TableBorderSidesV4;

/** cell.text 纯文本（段落换行连接）。 */
function cellPlainText(cell: BentoTableCellV4): string {
  if (cell.text === undefined) return "";
  return cell.text.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join("")).join("\n");
}

/** 从最新 canonical 读取 table；旧 panel closure 不参与语义判断。 */
function currentTable(ctx: PanelContext, id: string): BentoTableElementV4 | null {
  try {
    const doc = currentDoc(ctx.bridge);
    const element = doc.elements.find((candidate) => candidate.id === id);
    return element?.kind === "table" ? element : null;
  } catch {
    return null;
  }
}

function currentCell(ctx: PanelContext, id: string, rowIndex: number, colIndex: number): BentoTableCellV4 | null {
  const element = currentTable(ctx, id);
  if (element === null) return null;
  return anchorCell(element.table, rowIndex, colIndex)?.cell ?? null;
}

function currentStyle(ctx: PanelContext, id: string): BentoTableStyleV4 | undefined {
  return currentTable(ctx, id)?.table.style;
}

function dispatchBodyStyleEdit(
  ctx: PanelContext,
  id: string,
  index: number,
  patch: TableCellStylePatchV4,
): void {
  const commands = tableBodyStyleEditCommands(id, currentStyle(ctx, id), index, patch);
  if (commands.length > 0) ctx.dispatch(commands);
}

function dispatchBodyStyleRemove(ctx: PanelContext, id: string, index: number): void {
  const commands = tableBodyStyleRemoveCommands(id, currentStyle(ctx, id), index);
  if (commands.length > 0) ctx.dispatch(commands);
}

function clearStyleButton(label: string, onClick: () => void, command: string): HTMLButtonElement {
  const result = button(label, onClick, command);
  result.classList.add("c2a-table-clear");
  return result;
}

/** Cell style lineHeight/lineHeightPx are mutually exclusive in the kernel. */
function cellStyleCommit(
  ctx: PanelContext,
  id: string,
  rowIndex: number,
  colIndex: number,
  patch: TableCellStylePatchV4,
): void {
  const cell = currentCell(ctx, id, rowIndex, colIndex);
  if (cell === null) return;
  const projected = structuredClone(cell);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined) delete (projected as unknown as Record<string, unknown>)[key];
    else (projected as unknown as Record<string, unknown>)[key] = structuredClone(value);
  }
  if (patch.lineHeight !== undefined && patch.lineHeight !== null) delete projected.lineHeightPx;
  if (patch.lineHeightPx !== undefined && patch.lineHeightPx !== null) delete projected.lineHeight;
  if (semanticEqual(cell, projected)) return;
  const commands: VisualCommandV4[] = [];
  if (patch.lineHeight !== undefined && patch.lineHeight !== null && cell.lineHeightPx !== undefined) {
    commands.push(...cellStyleCommands(id, rowIndex, colIndex, { lineHeightPx: null }));
  }
  if (patch.lineHeightPx !== undefined && patch.lineHeightPx !== null && cell.lineHeight !== undefined) {
    commands.push(...cellStyleCommands(id, rowIndex, colIndex, { lineHeight: null }));
  }
  commands.push(...cellStyleCommands(id, rowIndex, colIndex, patch));
  ctx.dispatch(commands);
}

/** Four-side view of the canonical border union (top, right, bottom, left). */
function borderShape(border: BentoCellBorderV4 | undefined): "none" | "uniform" | "pair" | "four" {
  if (border === undefined || border === null) return "none";
  if (!Array.isArray(border)) return "uniform";
  return border.length === 2 ? "pair" : "four";
}

function cloneBorderSpec(spec: BentoBorderSpecV4 | null): BentoBorderSpecV4 | null {
  return spec === null ? null : structuredClone(spec);
}

function buildBorder(
  mode: "none" | "uniform" | "pair" | "four",
  sides: BorderSides,
): BentoCellBorderV4 | null {
  if (mode === "none") return null;
  if (mode === "uniform") return cloneBorderSpec(sides[0] ?? sides[1] ?? sides[2] ?? sides[3]);
  if (mode === "pair") return [cloneBorderSpec(sides[0]), cloneBorderSpec(sides[1])];
  return [cloneBorderSpec(sides[0]), cloneBorderSpec(sides[1]), cloneBorderSpec(sides[2]), cloneBorderSpec(sides[3])];
}

function borderHasSpec(border: BentoCellBorderV4 | null): boolean {
  if (border === null) return false;
  if (!Array.isArray(border)) return Object.keys(border).length > 0;
  return border.some((side) => side !== null && Object.keys(side).length > 0);
}

function borderEditor(
  host: HTMLElement,
  label: string,
  initial: BentoCellBorderV4 | undefined,
  onCommit: (border: BentoCellBorderV4 | null) => void,
  applyClass: string,
  command = "setTableCellStyle",
  readCurrent?: () => BentoCellBorderV4 | undefined,
): void {
  host.appendChild(section(label));
  let mode = borderShape(initial);
  const sides = expandCellBorderSides(initial);
  let borderDirty = false;
  const markBorderDirty = (): void => {
    borderDirty = true;
  };
  const conflictNote = compositeConflictNote(
    "c2aTableBorderConflict",
    "This cell border changed underneath the editor; the conflicting edit was not applied. The panel refreshes to the current value once focus leaves.",
  );
  const sideLabels = ["Top", "Right", "Bottom", "Left"] as const;
  const controls: Array<{
    style: HTMLSelectElement;
    width: HTMLInputElement;
    color: HTMLInputElement;
    hadWidth: boolean;
    hadColor: boolean;
    initialWidth: string;
    initialColor: string;
  }> = [];

  const modeSelect = select(
    [
      { value: "none", label: "— none —" },
      { value: "uniform", label: "All sides" },
      { value: "pair", label: "Top/bottom + left/right" },
      { value: "four", label: "Four sides" },
    ],
    mode,
    (value) => { mode = value as typeof mode; markBorderDirty(); },
    command,
  );
  modeSelect.classList.add("c2a-table-border-mode");
  host.appendChild(row("Border shape", modeSelect));

  sideLabels.forEach((sideLabel, sideIndex) => {
    let spec = sides[sideIndex];
    const ensureSpec = (): BentoBorderSpecV4 => {
      if (spec === null) {
        // A newly selected side starts as an empty border spec. Width/color
        // remain optional until the user actually edits those controls.
        spec = {};
        sides[sideIndex] = spec;
      }
      return spec;
    };
    const style = select(
      CELL_BORDER_STYLE.map((value) => ({
        value,
        label: value === "" ? "— none —" : value === CELL_BORDER_STYLE_DEFAULT ? "— default —" : value,
      })),
      spec === null ? "" : spec?.style ?? CELL_BORDER_STYLE_DEFAULT,
      (value) => {
        markBorderDirty();
        if (value === "") {
          spec = null;
          sides[sideIndex] = null;
        } else if (value === CELL_BORDER_STYLE_DEFAULT) {
          const next = ensureSpec();
          delete next.style;
        } else {
          ensureSpec().style = value as "solid" | "dash" | "dot";
        }
      },
      command,
    );
    const width = numberInput(spec?.width ?? 1, (value) => { markBorderDirty(); ensureSpec().width = value; }, { min: 0, minExclusive: true, step: 0.5 }, command);
    const color = colorInput(spec?.color ?? "#1A1D24", (value) => { markBorderDirty(); ensureSpec().color = value; }, command);
    const hadWidth = spec?.width !== undefined;
    const hadColor = spec?.color !== undefined;
    const initialWidth = width.value;
    const initialColor = color.value;
    style.classList.add(`c2a-table-border-style-${sideIndex}`);
    width.classList.add(`c2a-table-border-width-${sideIndex}`);
    color.classList.add(`c2a-table-border-color-${sideIndex}`);
    controls.push({ style, width, color, hadWidth, hadColor, initialWidth, initialColor });
    const side = document.createElement("div");
    side.className = "c2a-table-border-side";
    side.dataset.c2aTableBorderSide = sideLabel.toLowerCase();
    side.append(row("Style", style), row("Width", width), row("Color", color));
    host.appendChild(side);
  });

  // All controls stay visible so a composite editor can switch shape and make
  // a single final Apply gesture without rebuilding the focused input.
  const apply = button("Apply border", () => {
    conflictNote.hidden = true;
    const readLatest = (): BentoCellBorderV4 | undefined => readCurrent === undefined ? initial : readCurrent();
    if (mode === "none") {
      // An untouched shape selector is not an authored clear: only an
      // explicit mode change may remove a concurrently added border.
      const decision = reconcileStructuredEdit(
        initial ?? undefined,
        readLatest() ?? undefined,
        borderDirty ? { kind: "clear" } : { kind: "unchanged" },
      );
      if (decision.kind === "conflict") {
        conflictNote.hidden = false;
        return;
      }
      if (decision.kind === "noop") return;
      onCommit(decision.value ?? null);
      return;
    }
    const nextSides: BorderSides = [null, null, null, null];
    for (let index = 0; index < controls.length; index += 1) {
      const control = controls[index]!;
      if (control.style.value === "") continue;
      const next: BentoBorderSpecV4 = {};
      if (control.style.value !== CELL_BORDER_STYLE_DEFAULT) {
        next.style = control.style.value as "solid" | "dash" | "dot";
      }
      const widthTouched = control.hadWidth || control.width.value !== control.initialWidth;
      const colorTouched = control.hadColor || control.color.value !== control.initialColor;
      if (widthTouched && control.width.value.trim() !== "") {
        const width = parseNumberInputValue(control.width.value, { min: 0, minExclusive: true, step: 0.5 });
        if (width === undefined) return;
        next.width = width;
      }
      if (colorTouched && control.color.value.trim() !== "") {
        const color = parseHexColor(control.color.value.trim());
        if (color === undefined) return;
        next.color = color;
      }
      nextSides[index] = next;
    }
    const next = buildBorder(mode, nextSides);
    if (!borderHasSpec(next) && (initial === undefined || initial === null)) return;
    if (next === null) return;
    const decision = reconcileStructuredEdit(
      initial ?? undefined,
      readLatest() ?? undefined,
      borderDirty ? { kind: "replace", value: next } : { kind: "unchanged" },
    );
    if (decision.kind === "conflict") {
      conflictNote.hidden = false;
      return;
    }
    if (decision.kind === "noop") return;
    onCommit(decision.value ?? null);
  }, command);
  apply.classList.add(applyClass);
  host.appendChild(apply);
  host.appendChild(conflictNote);
}

function gradientStops(fill: BentoFillV4 | undefined): Array<{ position: number; color: string }> {
  if (fill?.type === "gradient" && fill.stops.length > 0) return fill.stops.map((stop) => ({ ...stop }));
  return [
    { position: 0, color: "#FFFFFF" },
    { position: 1, color: "#000000" },
  ];
}

function imageFill(fill: BentoFillV4 | undefined): BentoImageFillV4 | undefined {
  return fill?.type === "image" ? fill : undefined;
}

/** Fill editor covers solid, linear/radial gradients, and asset image fills. */
function fillEditor(
  host: HTMLElement,
  label: string,
  initial: BentoFillV4 | undefined,
  onCommit: (fill: BentoFillV4 | null) => void,
  applyClass: string,
  command = "setTableCellStyle",
  readCurrent?: () => BentoFillV4 | undefined,
): void {
  host.appendChild(section(label));
  let kind: FillKind = initial?.type === "gradient"
    ? (initial.gradientType === "radial" ? "radial" : "linear")
    : initial?.type ?? "none";
  let imageSrc = imageFill(initial)?.src ?? "";
  let imageSourceApproved = isAssetFillSource(imageSrc);
  let imageFit = imageFill(initial)?.fit ?? "cover";
  let fillDirty = false;
  let imageSourceTouched = false;
  let imageFitTouched = false;
  let cropResetRequested = false;
  let opacityResetRequested = false;
  let opacityTouched = false;

  const latestFill = (): BentoFillV4 | undefined => readCurrent === undefined ? initial : readCurrent();
  const conflictNote = compositeConflictNote(
    "c2aTableFillConflict",
    "This cell fill changed underneath the editor; the conflicting edit was not applied. The panel refreshes to the current value once focus leaves.",
  );
  const commitDraft = (next: BentoFillV4 | null): void => {
    conflictNote.hidden = true;
    const decision = reconcileStructuredEdit(
      initial,
      latestFill(),
      next === null
        ? { kind: "clear" }
        : fillDirty
          ? { kind: "replace", value: next }
          : { kind: "unchanged" },
    );
    if (decision.kind === "conflict") {
      conflictNote.hidden = false;
      return;
    }
    if (decision.kind === "noop") return;
    onCommit(decision.value ?? null);
  };

  const kindSelect = select(
    FILL_TYPES.map((value) => ({ value, label: value === "none" ? "— none —" : value })),
    kind,
    (value) => { kind = value as FillKind; fillDirty = true; },
    command,
  );
  kindSelect.classList.add("c2a-table-fill-type");
  host.appendChild(row("Type", kindSelect));

  let solidColorValue = initial?.type === "solid" ? initial.color : "#FFFFFF";
  const solidColor = colorInput(solidColorValue, (value) => { solidColorValue = value; fillDirty = true; }, command);
  host.appendChild(row("Solid color", solidColor));
  const gradientType = select(
    [{ value: "linear", label: "linear" }, { value: "radial", label: "radial" }],
    kind === "radial" ? "radial" : "linear",
    (value) => { kind = value === "radial" ? "radial" : "linear"; kindSelect.value = kind; fillDirty = true; },
    command,
  );
  gradientType.classList.add("c2a-table-gradient-type");
  host.appendChild(row("Gradient", gradientType));
  const angleControls = gradientAngleControls(
    initial?.type === "gradient" && initial.gradientType === "linear" ? initial.angle : undefined,
    command,
  );
  const angleInput = angleControls.angle;
  host.appendChild(row("Angle", angleInput));
  host.appendChild(angleControls.reset);

  const stopsEditor = gradientStopsEditor(gradientStops(initial), {
    hostClass: "c2a-table-fill-stops",
    step: 0.05,
    command,
    addedStop: { position: 1, color: "#000000" },
    onEdit: () => { fillDirty = true; },
    trimColor: true,
    decoratePosition: (input, index) => input.classList.add(`c2a-table-fill-stop-position-${index}`),
    decorateColor: (input, index) => input.classList.add(`c2a-table-fill-stop-color-${index}`),
    renderStop: (index, position, color) => [row(`Stop ${index + 1} position`, position), row(`Stop ${index + 1} color`, color)],
    addStopClass: "c2a-table-fill-add-stop",
    removeStopClass: "c2a-table-fill-remove-stop",
  });
  host.appendChild(stopsEditor.stopHost);
  host.appendChild(stopsEditor.addStop);
  host.appendChild(stopsEditor.removeStop);

  const image = imageFill(initial);
  const currentImage = (): BentoImageFillV4 | undefined => {
    const latest = readCurrent?.();
    if (readCurrent !== undefined) return latest?.type === "image" ? latest : undefined;
    return image;
  };
  const imageSrcInput = textInput(imageSrc, () => undefined, command);
  imageSrcInput.readOnly = true;
  imageSrcInput.setAttribute("aria-readonly", "true");
  imageSrcInput.classList.add("c2a-table-image-fill-src");
  host.appendChild(row("Image asset", imageSrcInput));
  const pick = button("Pick image…", () => {
    pickImageFile((assetKey) => {
      imageSrc = `asset:${assetKey}`;
      imageSourceTouched = true;
      fillDirty = true;
      imageSourceApproved = isAssetFillSource(imageSrc);
      imageSrcInput.value = imageSrc;
    });
  });
  pick.classList.add("c2a-table-image-fill-pick");
  host.appendChild(pick);
  const fit = select(IMAGE_FITS.map((value) => ({ value, label: value })), imageFit, (value) => {
    imageFit = value as typeof imageFit;
    imageFitTouched = true;
    fillDirty = true;
  }, command);
  host.appendChild(row("Image fit", fit));
  const opacity = numberInput(imageFill(initial)?.opacity, () => {
    opacityTouched = true;
    fillDirty = true;
  }, { min: 0, max: 1, step: 0.05 }, command);
  host.appendChild(row("Image opacity", opacity));
  host.appendChild(button("Reset opacity", () => {
    opacity.value = "";
    opacityResetRequested = true;
    fillDirty = true;
  }));
  const cropInputs = stagedCropInputs(image?.crop, { command, onEdit: () => { fillDirty = true; } });
  ["Left", "Top", "Right", "Bottom"].forEach((name, index) => {
    host.appendChild(row(`Image crop ${name}`, cropInputs[index]!));
  });
  host.appendChild(button("Reset crop", () => {
    cropInputs.forEach((input) => { input.value = ""; });
    cropResetRequested = true;
    fillDirty = true;
  }));

  const apply = button("Apply fill", () => {
    if (kind === "none") {
      commitDraft(null);
    } else if (kind === "solid") {
      const color = parseHexColor(solidColor.value.trim());
      if (color === undefined) return;
      const next: BentoFillV4 = { type: "solid", color };
      commitDraft(next);
    } else if (kind === "linear" || kind === "radial") {
      const nextStops = stopsEditor.readStopsDraft();
      if (nextStops === null || nextStops.length < 2) return;
      const rawAngle = angleInput.value.trim();
      const angle = kind === "linear" && rawAngle !== "" ? parseNumberInputValue(rawAngle, { min: 0, max: 360, maxExclusive: true, step: 1 }) : undefined;
      if (kind === "linear" && rawAngle !== "" && angle === undefined) return;
      const next: BentoFillV4 = { type: "gradient", gradientType: kind, stops: nextStops, ...(angle !== undefined ? { angle } : {}) };
      commitDraft(next);
    } else {
      const live = readCurrent?.();
      const latest = currentImage();
      // A picked asset is an explicit image-fill creation even when the cell
      // had no fill before.  Without this staged base, the terminal Apply
      // would silently discard a successful picker result because currentImage
      // quite correctly refuses to invent a canonical image for an untouched
      // missing field.
      const staged = latest === undefined && imageSourceTouched && imageSourceApproved
        ? { type: "image" as const, src: imageSrc.trim(), fit: imageFit }
        : undefined;
      const base = latest ?? staged;
      if (base === undefined) return;
      const source = imageSourceTouched ? imageSrc.trim() : base.src;
      if (!imageSourceApproved && !isAssetFillSource(source)) return;
      const rawCrop = cropInputs.map((input) => input.value);
      const cropBlank = rawCrop.every((value) => value.trim() === "");
      const crop = cropBlank ? undefined : parseCropRatios(rawCrop);
      if (!cropBlank && crop === null) return;
      const rawOpacity = opacity.value.trim();
      const imageOpacity = rawOpacity === "" ? undefined : parseNumberInputValue(rawOpacity, { min: 0, max: 1, step: 0.05 });
      if (rawOpacity !== "" && imageOpacity === undefined) return;
      const next: BentoImageFillV4 = {
        ...structuredClone(base),
        type: "image",
        src: source,
        fit: imageFitTouched ? fit.value as BentoImageFillV4["fit"] : base.fit,
      };
      if (cropResetRequested) delete next.crop;
      else if (!cropBlank) next.crop = crop!;
      if (opacityResetRequested) delete next.opacity;
      else if (imageOpacity !== undefined && (opacityTouched || imageOpacity !== imageFill(initial)?.opacity)) next.opacity = imageOpacity;
      if (live !== undefined && semanticEqual(live, next)) return;
      commitDraft(next);
    }
  }, command);
  apply.classList.add(applyClass);
  host.appendChild(apply);
  host.appendChild(conflictNote);
}

function renderBasicStyleControls(
  host: HTMLElement,
  initial: BentoTableCellStyleV4 | undefined,
  onPatch: (patch: TableCellStylePatchV4) => void,
  command: string,
  prefix: string,
  readCurrent?: () => BentoTableCellStyleV4 | undefined,
): void {
  const display = resolveStaticV1TextStyle(initial ?? {});
  const align: BentoAlignmentV4 = initial?.align ?? ["left", "middle"];
  host.appendChild(row("Bold", checkbox(initial?.bold === true, (value) => onPatch({ bold: value }), command)));
  host.appendChild(row("Italic", checkbox(initial?.italic === true, (value) => onPatch({ italic: value }), command)));
  host.appendChild(row("Color", colorInput(display.color, (value) => onPatch({ color: value }), command)));
  host.appendChild(row("Fill", colorInput(initial?.backgroundColor ?? "#FFFFFF", (value) => onPatch({ backgroundColor: value }), command)));
  host.appendChild(row("Size", numberInput(display.fontSize, (value) => onPatch({ fontSize: value }), { min: 0, minExclusive: true, step: 1 }, command)));
  renderFontFamilyControls({
    host,
    label: "Font",
    initial: initial?.fontFamily ?? display.fontFamily,
    onCommit: (family) => onPatch({ fontFamily: family }),
    command,
    readCurrent: () => readCurrent?.()?.fontFamily,
    prefix,
  });
  host.appendChild(row("Line height", numberInput(initial?.lineHeight, (value) => onPatch({ lineHeight: value }), { min: 0, minExclusive: true, max: 100, step: 0.05 }, command)));
  host.appendChild(row("Line height px", numberInput(initial?.lineHeightPx, (value) => onPatch({ lineHeightPx: value }), { min: 0, minExclusive: true, step: 1 }, command)));
  host.appendChild(row("Letter spacing", numberInput(initial?.letterSpacing, (value) => onPatch({ letterSpacing: value }), { min: -1000, max: 1000, step: 0.5 }, command)));
  host.appendChild(row("Margin top", numberInput(initial?.marginTop, (value) => onPatch({ marginTop: value }), { step: 1 }, command)));
  host.appendChild(row("Align", select(
    H_ALIGNS.map((value) => ({ value, label: value })),
    align[0],
    (value) => {
      const latest = readCurrent?.()?.align ?? align;
      onPatch({ align: [value as (typeof H_ALIGNS)[number], latest[1]] });
    },
    command,
  )));
  host.appendChild(row("V-align", select(
    V_ALIGNS.map((value) => ({ value, label: value })),
    align[1],
    (value) => {
      const latest = readCurrent?.()?.align ?? align;
      onPatch({ align: [latest[0], value as (typeof V_ALIGNS)[number]] });
    },
    command,
  )));
}

function textContentControls(host: HTMLElement, ctx: PanelContext, id: string, rowIndex: number, colIndex: number, initial: BentoTextContentV4): void {
  host.appendChild(section("Cell text content"));
  const currentText = (): BentoTextContentV4 | undefined => currentCell(ctx, id, rowIndex, colIndex)?.text;
  const commit = (patch: TableTextContentStylePatchV4) => {
    const latest = currentText();
    if (latest === undefined) return;
    const commands = cellTextContentStyleCommands(id, rowIndex, colIndex, latest, patch);
    const next = commands[0]?.type === "setTableCellText" && typeof commands[0].text !== "string" ? commands[0].text : undefined;
    if (next !== null && next !== undefined && semanticEqual(latest, next)) return;
    ctx.dispatch(commands);
  };
  const display = resolveStaticV1TextStyle(initial);
  host.appendChild(row("Text bold", checkbox(initial.bold === true, (value) => commit({ bold: value }), "setTableCellText")));
  host.appendChild(row("Text italic", checkbox(initial.italic === true, (value) => commit({ italic: value }), "setTableCellText")));
  host.appendChild(row("Text color", colorInput(display.color, (value) => commit({ color: value }), "setTableCellText")));
  host.appendChild(row("Text bg", colorInput(initial.backgroundColor ?? "#FFFFFF", (value) => commit({ backgroundColor: value }), "setTableCellText")));
  host.appendChild(row("Text size", numberInput(display.fontSize, (value) => commit({ fontSize: value }), { min: 0, minExclusive: true, step: 1 }, "setTableCellText")));
  host.appendChild(row("Text line", numberInput(initial.lineHeight, (value) => commit({ lineHeight: value }), { min: 0, minExclusive: true, max: 100, step: 0.05 }, "setTableCellText")));
  host.appendChild(row("Text line px", numberInput(initial.lineHeightPx, (value) => commit({ lineHeightPx: value }), { min: 0, minExclusive: true, step: 1 }, "setTableCellText")));
  host.appendChild(row("Text spacing", numberInput(initial.letterSpacing, (value) => commit({ letterSpacing: value }), { min: -1000, max: 1000, step: 0.5 }, "setTableCellText")));
  host.appendChild(row("Text margin", numberInput(initial.marginTop, (value) => commit({ marginTop: value }), { step: 1 }, "setTableCellText")));
  renderFontFamilyControls({
    host,
    label: "Text font",
    initial: initial.fontFamily ?? display.fontFamily,
    onCommit: (family) => commit({ fontFamily: family }),
    command: "setTableCellText",
    readCurrent: () => currentText()?.fontFamily,
    prefix: "c2a-table-cell-text",
  });
  host.appendChild(row("Direction", select(
    [{ value: "horizontal", label: "horizontal" }, { value: "vertical", label: "vertical" }],
    initial.textDirection ?? "horizontal",
    (value) => commit({ textDirection: value as "horizontal" | "vertical" }),
    "setTableCellText",
  )));
  host.appendChild(row("Wrap", checkbox(initial.wrap !== false, (value) => commit({ wrap: value }), "setTableCellText")));
  const align: BentoAlignmentV4 = initial.align ?? ["left", "middle"];
  host.appendChild(row("Text align", select(H_ALIGNS.map((value) => ({ value, label: value })), align[0], (value) => {
    const latest = currentText()?.align ?? align;
    commit({ align: [value as (typeof H_ALIGNS)[number], latest[1]] });
  }, "setTableCellText")));
  host.appendChild(row("Text V-align", select(V_ALIGNS.map((value) => ({ value, label: value })), align[1], (value) => {
    const latest = currentText()?.align ?? align;
    commit({ align: [latest[0], value as (typeof V_ALIGNS)[number]] });
  }, "setTableCellText")));
}

function textRunControls(host: HTMLElement, ctx: PanelContext, id: string, rowIndex: number, colIndex: number, paragraphIndex: number, runIndex: number, run: BentoTextRunV4): void {
  const commit = (patch: TableTextRunStylePatchV4) => {
    const latest = currentCell(ctx, id, rowIndex, colIndex)?.text;
    if (latest === undefined) return;
    const commands = cellTextRunStyleCommands(id, rowIndex, colIndex, latest, paragraphIndex, runIndex, patch);
    const next = commands[0]?.type === "setTableCellText" && typeof commands[0].text !== "string" ? commands[0].text : undefined;
    if (next !== null && next !== undefined && semanticEqual(latest, next)) return;
    ctx.dispatch(commands);
  };
  host.appendChild(section(`Run ${paragraphIndex + 1}.${runIndex + 1}`));
  host.appendChild(row("Bold", checkbox(run.bold === true, (value) => commit({ bold: value }), "setTableCellText")));
  host.appendChild(row("Italic", checkbox(run.italic === true, (value) => commit({ italic: value }), "setTableCellText")));
  host.appendChild(row("Underline", checkbox(run.underline === true, (value) => commit({ underline: value }), "setTableCellText")));
  host.appendChild(row("Strike", checkbox(run.strikethrough === true, (value) => commit({ strikethrough: value }), "setTableCellText")));
  host.appendChild(row("Baseline", select([
    { value: "", label: "— none —" }, { value: "sup", label: "superscript" }, { value: "sub", label: "subscript" },
  ], run.baselineShift ?? "", (value) => commit({ baselineShift: value === "" ? null : value as "sup" | "sub" }), "setTableCellText")));
  host.appendChild(row("Color", colorInput(run.color ?? "#000000", (value) => commit({ color: value }), "setTableCellText")));
  host.appendChild(row("Size", numberInput(run.fontSize, (value) => commit({ fontSize: value }), { min: 0, minExclusive: true, step: 1 }, "setTableCellText")));
  host.appendChild(row("Background", colorInput(run.backgroundColor ?? "#FFFFFF", (value) => commit({ backgroundColor: value }), "setTableCellText")));
  const inheritedFamily = currentCell(ctx, id, rowIndex, colIndex)?.text?.fontFamily;
  renderFontFamilyControls({
    host,
    label: "Font",
    initial: run.fontFamily ?? inheritedFamily,
    onCommit: (family) => commit({ fontFamily: family }),
    command: "setTableCellText",
    readCurrent: () => {
      const latest = currentCell(ctx, id, rowIndex, colIndex)?.text;
      return latest?.paragraphs[paragraphIndex]?.runs[runIndex]?.fontFamily ?? latest?.fontFamily;
    },
    prefix: `c2a-table-run-${paragraphIndex}-${runIndex}`,
  });
  host.appendChild(row("Link", textInput(run.href ?? "", (value) => commit({ href: value.trim() === "" ? null : value.trim() }), "setTableCellText")));
  host.appendChild(row("LaTeX", textInput(run.latex ?? "", (value) => commit({ latex: value.trim() === "" ? null : value.trim() }), "setTableCellText")));
}

function textParagraphControls(host: HTMLElement, ctx: PanelContext, id: string, rowIndex: number, colIndex: number, paragraph: BentoTextParagraphV4, paragraphIndex: number): void {
  const currentParagraph = (): BentoTextParagraphV4 | undefined => currentCell(ctx, id, rowIndex, colIndex)?.text?.paragraphs[paragraphIndex];
  const commit = (patch: TableTextParagraphStylePatchV4) => {
    const latest = currentCell(ctx, id, rowIndex, colIndex)?.text;
    if (latest === undefined) return;
    const commands = cellTextParagraphStyleCommands(id, rowIndex, colIndex, latest, paragraphIndex, patch);
    const next = commands[0]?.type === "setTableCellText" && typeof commands[0].text !== "string" ? commands[0].text : undefined;
    if (next !== null && next !== undefined && semanticEqual(latest, next)) return;
    ctx.dispatch(commands);
  };
  host.appendChild(section(`Paragraph ${paragraphIndex + 1}`));
  host.appendChild(row("Align", select(
    [{ value: "", label: "— inherit —" }, ...H_ALIGNS.map((value) => ({ value, label: value }))],
    paragraph.align ?? "",
    (value) => commit({ align: value === "" ? null : value as (typeof H_ALIGNS)[number] }),
    "setTableCellText",
  )));
  const line = paragraph.lineHeight;
  host.appendChild(row("Line height", textInput(line === undefined ? "" : String(line), (value) => {
    if (value.trim() === "") {
      commit({ lineHeight: null });
      return;
    }
    const parsed = parseLineHeightValue(value);
    if (parsed !== undefined) commit({ lineHeight: parsed });
  }, "setTableCellText")));

  const margin = paragraph.margin ?? {};
  for (const key of ["top", "left", "right"] as const) {
    host.appendChild(row(`Margin ${key}`, numberInput(margin[key], (value) => {
      const currentMargin = currentParagraph()?.margin ?? {};
      commit({ margin: { ...currentMargin, [key]: value } });
    }, { step: 1 }, "setTableCellText")));
  }
  host.appendChild(button("Clear paragraph margin", () => commit({ margin: null }), "setTableCellText"));

  const list = paragraph.list;
  host.appendChild(section("List"));
  host.appendChild(row("List enabled", checkbox(list !== undefined, (checked) => {
    const currentList = currentParagraph()?.list;
    commit({ list: checked ? (currentList ?? { ordered: false, marker: "disc", indent: 0 }) : null });
  }, "setTableCellText")));
  if (list !== undefined) {
    const updateList = (update: (current: BentoParagraphListV4) => BentoParagraphListV4): void => {
      const current = currentParagraph()?.list ?? list;
      commit({ list: update(structuredClone(current)) });
    };
    host.appendChild(row("Ordered", select(
      [{ value: "false", label: "unordered" }, { value: "true", label: "ordered" }],
      String(list.ordered === true),
      (value) => updateList((current) => ({ ...current, ordered: value === "true" })),
      "setTableCellText",
    )));
    host.appendChild(row("Marker", textInput(list.marker ?? (list.ordered ? "decimal" : "disc"), (value) => {
      updateList((current) => ({ ...current, marker: value.trim() || undefined }));
    }, "setTableCellText")));
    host.appendChild(row("Indent", numberInput(list.indent ?? 0, (value) => {
      updateList((current) => ({ ...current, indent: value }));
    }, { min: 0, step: 1 }, "setTableCellText")));

    const itemStyle = list.style ?? {};
    const updateListStyle = (update: (style: NonNullable<BentoParagraphListV4["style"]>) => NonNullable<BentoParagraphListV4["style"]>): void => {
      updateList((current) => {
        const style = update({ ...(current.style ?? {}) });
        return Object.keys(style).length === 0 ? (({ style: undefined, ...rest }) => rest)(current) : { ...current, style };
      });
    };
    host.appendChild(section("List item style"));
    host.appendChild(row("Item align", select(
      [{ value: "", label: "— inherit —" }, ...H_ALIGNS.map((value) => ({ value, label: value }))],
      itemStyle.align ?? "",
      (value) => updateListStyle((style) => value === "" ? (({ align: _align, ...rest }) => rest)(style) : { ...style, align: value as (typeof H_ALIGNS)[number] }),
      "setTableCellText",
    )));
    host.appendChild(row("Item line height", textInput(itemStyle.lineHeight === undefined ? "" : String(itemStyle.lineHeight), (value) => {
      const trimmed = value.trim();
      if (trimmed === "") {
        updateListStyle((style) => {
          const { lineHeight: _lineHeight, ...rest } = style;
          return rest;
        });
        return;
      }
      const parsed = parseLineHeightValue(trimmed);
      if (parsed !== undefined) updateListStyle((style) => ({ ...style, lineHeight: parsed }));
    }, "setTableCellText")));
    host.appendChild(row("Item spacing", numberInput(itemStyle.letterSpacing, (value) => updateListStyle((style) => ({ ...style, letterSpacing: value })), { step: 0.5 }, "setTableCellText")));
    host.appendChild(row("Item margin top", numberInput(itemStyle.marginTop, (value) => updateListStyle((style) => ({ ...style, marginTop: value })), { step: 1 }, "setTableCellText")));
    host.appendChild(row("Item margin left", numberInput(itemStyle.marginLeft, (value) => updateListStyle((style) => ({ ...style, marginLeft: value })), { step: 1 }, "setTableCellText")));
    host.appendChild(row("Item marker", textInput(itemStyle.marker ?? "", (value) => updateListStyle((style) => value.trim() === "" ? (({ marker: _marker, ...rest }) => rest)(style) : { ...style, marker: value.trim() }), "setTableCellText")));
  }
  host.appendChild(clearStyleButton("Clear paragraph", () => {
    const latest = currentCell(ctx, id, rowIndex, colIndex)?.text;
    if (latest === undefined) return;
    commit({
      align: null,
      lineHeight: null,
      margin: null,
      list: null,
    });
  }, "setTableCellText"));
}

function cellTextControls(host: HTMLElement, ctx: PanelContext, id: string, anchor: TableCellAnchor, cell: BentoTableCellV4): void {
  const table = currentTable(ctx, id)?.table;
  if (table === undefined) return;
  const logical = anchorCell(table, anchor.row, anchor.col);
  if (logical === null) return;
  const a = logical.anchor;
  host.appendChild(row("Text", textareaInput(cellPlainText(cell), (value) => {
    ctx.dispatch(cellTextCommands(id, a.row, a.col, value));
  }, "setTableCellText")));
  if (cell.text === undefined) return;
  textContentControls(host, ctx, id, a.row, a.col, cell.text);
  cell.text.paragraphs.forEach((paragraph, paragraphIndex) => {
    textParagraphControls(host, ctx, id, a.row, a.col, paragraph, paragraphIndex);
    paragraph.runs.forEach((run, runIndex) => textRunControls(host, ctx, id, a.row, a.col, paragraphIndex, runIndex, run));
  });
}

function cellStyleEditor(host: HTMLElement, ctx: PanelContext, element: BentoTableElementV4, anchor: { row: number; col: number }, cell: BentoTableCellV4): void {
  const commit = (patch: TableCellStylePatchV4) => cellStyleCommit(ctx, element.id, anchor.row, anchor.col, patch);
  const style = document.createElement("div");
  style.className = "c2a-table-cell-style";
  renderBasicStyleControls(style, cell, commit, "setTableCellStyle", "c2a-table-cell", () => currentCell(ctx, element.id, anchor.row, anchor.col) ?? undefined);
  fillEditor(style, "Cell fill", cell.fill, (fill) => commit({ fill }), "c2a-table-cell-fill-apply", "setTableCellStyle", () => currentCell(ctx, element.id, anchor.row, anchor.col)?.fill);
  borderEditor(
    style,
    "Cell border",
    cell.border,
    (border) => commit({ border }),
    "c2a-table-cell-border-apply",
    "setTableCellStyle",
    () => currentCell(ctx, element.id, anchor.row, anchor.col)?.border,
  );
  style.appendChild(clearStyleButton("Clear cell style", () => commit({
    color: null, fontSize: null, fontFamily: null, bold: null, italic: null, backgroundColor: null,
    lineHeight: null, lineHeightPx: null, letterSpacing: null, marginTop: null, fill: null, border: null, align: null,
  }), "setTableCellStyle"));
  host.appendChild(style);
}

/** 选中单元格区（文本/富文本/样式/合并/拆分）。 */
function cellControls(host: HTMLElement, ctx: PanelContext, element: BentoTableElementV4, anchor: TableCellAnchor, cell: BentoTableCellV4): void {
  const logical = anchorCell(element.table, anchor.row, anchor.col);
  if (logical === null) return;
  const a = logical.anchor;
  host.appendChild(section(`Cell (${a.row}, ${a.col})`));
  cellTextControls(host, ctx, element.id, anchor, cell);
  cellStyleEditor(host, ctx, element, a, cell);

  // 合并/拆分（table.merge 行）。已合并锚点不能再扩展（kernel 拒绝区域内含
  // merged cell 的再合并）→ 按钮禁用，避免静默无效手势。
  host.appendChild(section("Merge"));
  const merged = a.rowSpan > 1 || a.colSpan > 1;
  const mergeRight = button("Merge right", () => {
    const latest = currentTable(ctx, element.id);
    if (latest === null) return;
    const latestAnchor = anchorCell(latest.table, a.row, a.col)?.anchor;
    if (latestAnchor === undefined || !canMerge(latest.table, latestAnchor, { rows: 0, cols: 1 })) return;
    ctx.dispatch(mergeCommands(element.id, latestAnchor.row, latestAnchor.col, latestAnchor.rowSpan, latestAnchor.colSpan + 1));
  }, "setTableMerge");
  mergeRight.disabled = !canMerge(element.table, a, { rows: 0, cols: 1 });
  host.appendChild(mergeRight);
  const mergeDown = button("Merge down", () => {
    const latest = currentTable(ctx, element.id);
    if (latest === null) return;
    const latestAnchor = anchorCell(latest.table, a.row, a.col)?.anchor;
    if (latestAnchor === undefined || !canMerge(latest.table, latestAnchor, { rows: 1, cols: 0 })) return;
    ctx.dispatch(mergeCommands(element.id, latestAnchor.row, latestAnchor.col, latestAnchor.rowSpan + 1, latestAnchor.colSpan));
  }, "setTableMerge");
  mergeDown.disabled = !canMerge(element.table, a, { rows: 1, cols: 0 });
  host.appendChild(mergeDown);
  if (merged) {
    host.appendChild(button("Split", () => {
      const latest = currentTable(ctx, element.id);
      if (latest === null) return;
      const latestAnchor = anchorCell(latest.table, a.row, a.col)?.anchor;
      if (latestAnchor === undefined || (latestAnchor.rowSpan <= 1 && latestAnchor.colSpan <= 1)) return;
      ctx.dispatch(splitCommands(element.id, latestAnchor.row, latestAnchor.col));
    }, "setTableSplit"));
  }
}

function gridEditor(host: HTMLElement, ctx: PanelContext, element: BentoTableElementV4): void {
  const table = element.table;
  const columnWidths = [...table.columnWidths];
  const rowHeights = [...table.rowHeights];
  const columnInputs: HTMLInputElement[] = [];
  const rowInputs: HTMLInputElement[] = [];
  host.appendChild(section("Grid ratios"));
  const wrap = document.createElement("div");
  wrap.className = "c2a-gridwrap c2a-table-grid-editor";
  const grid = document.createElement("table");
  grid.className = "c2a-grid";
  const header = document.createElement("tr");
  const corner = document.createElement("th");
  corner.textContent = "";
  header.appendChild(corner);
  columnWidths.forEach((_, index) => {
    const th = document.createElement("th");
    th.className = "c2a-gridheader";
    th.textContent = `Col ${index + 1}`;
    header.appendChild(th);
  });
  grid.appendChild(header);
  const colRow = document.createElement("tr");
  const colLabel = document.createElement("th");
  colLabel.className = "c2a-gridheader";
  colLabel.textContent = "Width";
  colRow.appendChild(colLabel);
  columnWidths.forEach((value, index) => {
    const input = numberInput(value, (next) => {
      // Keep the form draft as entered; the terminal Apply gesture performs
      // one deterministic normalization after all dimensions are edited.
      columnWidths[index] = next;
    }, { min: 0, max: 1, step: 0.01 }, "setTableGrid");
    input.classList.add(`c2a-table-grid-col-${index}`);
    columnInputs.push(input);
    const td = document.createElement("td");
    td.appendChild(input);
    colRow.appendChild(td);
  });
  grid.appendChild(colRow);
  rowHeights.forEach((value, index) => {
    const line = document.createElement("tr");
    const label = document.createElement("th");
    label.className = "c2a-gridheader";
    label.textContent = `Row ${index + 1} height`;
    line.appendChild(label);
    const input = numberInput(value, (next) => {
      rowHeights[index] = next;
    }, { min: 0, max: 1, step: 0.01 }, "setTableGrid");
    input.classList.add(`c2a-table-grid-row-${index}`);
    rowInputs.push(input);
    const td = document.createElement("td");
    td.colSpan = Math.max(1, columnWidths.length);
    td.appendChild(input);
    line.appendChild(td);
    grid.appendChild(line);
  });
  wrap.appendChild(grid);
  host.appendChild(wrap);
  const apply = button("Apply grid", () => {
    const latest = currentTable(ctx, element.id);
    // +Row/+Col can commit while this panel is still mounted.  Never let an
    // old form overwrite a differently shaped canonical grid; the panel will
    // be rebuilt by the normal reprojection path before another Apply.
    if (latest === null || !tableGridDraftMatches(latest.table, columnInputs.length, rowInputs.length)) return;
    const columnsRaw = columnInputs.map((input) => parseNumberInputValue(input.value, { min: 0, max: 1, step: 0.01 }));
    const rowsRaw = rowInputs.map((input) => parseNumberInputValue(input.value, { min: 0, max: 1, step: 0.01 }));
    if (columnsRaw.some((value) => value === undefined) || rowsRaw.some((value) => value === undefined)) return;
    const columns = normalizeRatios(columnsRaw as number[]);
    const rows = normalizeRatios(rowsRaw as number[]);
    if (columns === null || rows === null) return;
    ctx.dispatch(tableGridCommands(element.id, columns, rows));
  }, "setTableGrid");
  apply.classList.add("c2a-table-grid-apply");
  host.appendChild(apply);
}

function styleSlotEditor(host: HTMLElement, ctx: PanelContext, element: BentoTableElementV4, slot: TableStyleSlotV4, style: BentoTableStyleV4 | undefined): void {
  const wrapper = document.createElement("div");
  wrapper.className = "c2a-table-style-slot";
  wrapper.dataset.c2aTableSlot = slot;
  renderBasicStyleControls(wrapper, style?.[slot], (patch) => {
    ctx.dispatch(tableStyleSlotCommands(element.id, currentStyle(ctx, element.id), slot, patch));
  }, "setTableStyle", `c2a-table-slot-${slot}`, () => currentStyle(ctx, element.id)?.[slot]);
  fillEditor(wrapper, "Fill", style?.[slot]?.fill, (fill) => {
    ctx.dispatch(tableStyleSlotCommands(element.id, currentStyle(ctx, element.id), slot, { fill }));
  }, `c2a-table-slot-${slot}-fill-apply`, "setTableStyle", () => currentStyle(ctx, element.id)?.[slot]?.fill);
  borderEditor(wrapper, "Border", style?.[slot]?.border, (border) => {
    ctx.dispatch(tableStyleSlotCommands(element.id, currentStyle(ctx, element.id), slot, { border }));
  }, `c2a-table-slot-${slot}-border-apply`, "setTableStyle", () => currentStyle(ctx, element.id)?.[slot]?.border);
  wrapper.appendChild(clearStyleButton("Clear slot", () => {
    const latest = currentStyle(ctx, element.id);
    const slotStyle = latest?.[slot];
    if (slotStyle === undefined || Object.keys(slotStyle).length === 0) return;
    ctx.dispatch(tableStyleSlotCommands(element.id, latest, slot, null));
  }, "setTableStyle"));
  host.appendChild(wrapper);
}

function tableStyleEditor(host: HTMLElement, ctx: PanelContext, element: BentoTableElementV4): void {
  const style = element.table.style;
  host.appendChild(section("Table style (resolved inline)"));
  const rowRule = checkbox(style?.rowOverColumn ?? true, (value) => {
    ctx.dispatch(rowOverColumnCommands(element.id, currentStyle(ctx, element.id), value));
  }, "setTableStyle");
  rowRule.classList.add("c2a-table-style-row-over-column");
  host.appendChild(row("Rows over columns", rowRule));
  host.appendChild(clearStyleButton("Use default row rule", () => {
    const latest = currentStyle(ctx, element.id);
    if (latest?.rowOverColumn === undefined) return;
    ctx.dispatch(rowOverColumnCommands(element.id, latest, null));
  }, "setTableStyle"));

  TABLE_STYLE_SLOTS.forEach((slot) => {
    host.appendChild(section(`Style slot: ${STYLE_SLOT_LABELS[slot]}`));
    styleSlotEditor(host, ctx, element, slot, style);
  });

  host.appendChild(section("Body style cycle"));
  const bodyStyles = style?.bodyStyles ?? [];
  bodyStyles.forEach((bodyStyle, index) => {
    const wrapper = document.createElement("div");
    wrapper.className = "c2a-table-body-style";
    wrapper.dataset.c2aTableBodyIndex = String(index);
    renderBasicStyleControls(wrapper, bodyStyle, (patch) => {
      dispatchBodyStyleEdit(ctx, element.id, index, patch);
    }, "setTableStyle", `c2a-table-body-${index}`, () => currentStyle(ctx, element.id)?.bodyStyles?.[index]);
    fillEditor(wrapper, "Fill", bodyStyle.fill, (fill) => {
      dispatchBodyStyleEdit(ctx, element.id, index, { fill });
    }, `c2a-table-body-${index}-fill-apply`, "setTableStyle", () => currentStyle(ctx, element.id)?.bodyStyles?.[index]?.fill);
    borderEditor(wrapper, "Border", bodyStyle.border, (border) => {
      dispatchBodyStyleEdit(ctx, element.id, index, { border });
    }, `c2a-table-body-${index}-border-apply`, "setTableStyle", () => currentStyle(ctx, element.id)?.bodyStyles?.[index]?.border);
    wrapper.appendChild(clearStyleButton("Remove body style", () => dispatchBodyStyleRemove(ctx, element.id, index), "setTableStyle"));
    host.appendChild(wrapper);
  });
  const addBody = button("+ Body style", () => {
    const latest = currentStyle(ctx, element.id);
    ctx.dispatch(tableBodyStyleAppendCommands(element.id, latest));
  }, "setTableStyle");
  addBody.classList.add("c2a-table-body-add");
  host.appendChild(addBody);
  {
    const hasStyle = style !== undefined && Object.keys(style).length > 0;
    const clearTableStyle = clearStyleButton(tableStyleClearLabel(style), () => {
      const latest = currentStyle(ctx, element.id);
      if (latest === undefined || Object.keys(latest).length === 0) return;
      ctx.dispatch(tableStyleCommands(element.id, null));
    }, "setTableStyle");
    // Keep a stable accessible name for the real terminal click while the
    // visible label records the before/after status used by Test 4 evidence.
    clearTableStyle.setAttribute("aria-label", "Clear table style");
    clearTableStyle.disabled = !hasStyle;
    clearTableStyle.classList.add("c2a-table-clear-style");
    host.appendChild(clearTableStyle);
  }
}

/** 表格面板：grid + table style +（有单元格锚点 → 单元格区）。 */
export function renderTablePanel(host: HTMLElement, ctx: PanelContext, cell: TableCellAnchor | null): void {
  const element = ctx.element as Extract<BentoDocV4["elements"][number], { kind: "table" }>;
  if (element.kind !== "table" || element.table === undefined) return;
  host.appendChild(section("Table"));
  const table = element.table;
  host.appendChild(row(`Grid ${table.rows.length}×${table.columnWidths.length}`, document.createElement("span")));
  gridEditor(host, ctx, element);
  const strip = document.createElement("div");
  strip.className = "c2a-strip";
  strip.appendChild(button("+ Row", () => {
    const latest = currentTable(ctx, element.id);
    if (latest !== null) ctx.dispatch(growCommands(element.id, latest.table, 1, 0));
  }, "setTableShape"));
  strip.appendChild(button("+ Col", () => {
    const latest = currentTable(ctx, element.id);
    if (latest !== null) ctx.dispatch(growCommands(element.id, latest.table, 0, 1));
  }, "setTableShape"));
  host.appendChild(strip);
  tableStyleEditor(host, ctx, element);

  if (cell !== null && cell.elId === element.id) {
    const model = anchorCell(table, cell.row, cell.col);
    if (model !== null) cellControls(host, ctx, element, cell, model.cell);
  }
}
