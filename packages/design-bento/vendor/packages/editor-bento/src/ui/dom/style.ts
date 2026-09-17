/**
 * Shared persistent decoration controls (GD-4 #24).
 *
 * Border and shadow values are edited as complete composites.  Inputs stay
 * local until Apply, then the typed builders emit exactly one setBorder or
 * setShadow command.  This prevents a stale panel frame from dropping a
 * sibling field and keeps the kernel as the sole validator.
 */
import type {
  BentoBorder,
  BentoGradientFillV4,
  BentoShadow,
  BentoTextElementV4,
} from "contracts";
import { borderCommands, shadowCommands, textGradientCommands } from "../style.ts";
import { button, colorInput, numberInput, parseHexColor, parseNumberInputValue, row, section, select } from "./primitives.ts";
import {
  compositeConflictNote,
  currentDoc,
  gradientAngleControls,
  gradientStopsEditor,
  semanticEqual,
  type PanelContext,
} from "./context.ts";
import { reconcileStructuredEdit } from "kernel";

const BORDER_STYLES = ["solid", "dash", "dot"] as const;
const BORDER_STYLE_DEFAULT = "__default__";
const GRADIENT_TYPES = ["linear", "radial"] as const;

function borderEditor(host: HTMLElement, ctx: PanelContext): void {
  const element = ctx.element;
  if (element.kind === "text") return;
  const border = element.border;
  const readLatestBorder = (): BentoBorder | null | undefined => {
    const latest = currentDoc(ctx.bridge).elements.find((candidate) => candidate.id === element.id);
    return latest !== undefined && latest.kind !== "text" ? latest.border : undefined;
  };
  let borderDirty = false;
  const markDirty = (): void => {
    borderDirty = true;
  };
  const style = select(
    [
      { value: BORDER_STYLE_DEFAULT, label: "— default —" },
      ...BORDER_STYLES.map((value) => ({ value, label: value })),
    ],
    border?.style ?? BORDER_STYLE_DEFAULT,
    () => markDirty(),
    "setBorder",
  );
  const color = colorInput(border?.color ?? "#000000", () => markDirty(), "setBorder");
  const width = numberInput(border?.width ?? 1, () => markDirty(), { min: 0, minExclusive: true, step: 0.1 }, "setBorder");
  const initialColor = color.value;
  const initialWidth = width.value;
  const conflictNote = compositeConflictNote(
    "c2aStyleBorderConflict",
    "This border changed underneath the editor; the conflicting edit was not applied. The panel refreshes to the current value once focus leaves.",
  );
  host.appendChild(section("Border"));
  host.appendChild(row("Style", style));
  host.appendChild(row("Color", color));
  host.appendChild(row("Width", width));
  host.appendChild(button("Apply border", () => {
    conflictNote.hidden = true;
    const next: BentoBorder = structuredClone(border ?? {});
    if (style.value !== (border?.style ?? BORDER_STYLE_DEFAULT)) {
      if (style.value === BORDER_STYLE_DEFAULT) delete next.style;
      else next.style = style.value as (typeof BORDER_STYLES)[number];
    }
    // width/color are optional canonical fields. The fallback values shown in
    // an empty editor are display hints only; only an existing field or an
    // actual draft change is written back. Apply still parses the live DOM so
    // malformed manual edits fail closed rather than reusing stale state.
    if (width.value !== initialWidth) {
      if (width.value.trim() === "") delete next.width;
      else {
        const parsedWidth = parseNumberInputValue(width.value, { min: 0, minExclusive: true, step: 0.1 });
        if (parsedWidth === undefined) return;
        next.width = parsedWidth;
      }
    }
    if (color.value !== initialColor) {
      if (color.value.trim() === "") delete next.color;
      else {
        const parsedColor = parseHexColor(color.value.trim());
        if (parsedColor === undefined) return;
        next.color = parsedColor;
      }
    }
    const decision = reconcileStructuredEdit(
      border ?? undefined,
      readLatestBorder() ?? undefined,
      borderDirty ? { kind: "replace", value: next } : { kind: "unchanged" },
    );
    if (decision.kind === "conflict") {
      conflictNote.hidden = false;
      return;
    }
    if (decision.kind === "noop") return;
    ctx.dispatch(borderCommands(element.id, decision.value ?? null));
  }, "setBorder"));
  host.appendChild(button("Clear border", () => {
    // A new commit gesture on the same composite: reset any previously
    // surfaced refusal so a successful clear leaves no stale note behind.
    conflictNote.hidden = true;
    const decision = reconcileStructuredEdit(
      border ?? undefined,
      readLatestBorder() ?? undefined,
      { kind: "clear" },
    );
    if (decision.kind === "noop") return;
    ctx.dispatch(borderCommands(element.id, null));
  }, "setBorder"));
  host.appendChild(conflictNote);
}

function shadowLayerInputs(host: HTMLElement, layer: BentoShadow, index: number, update: (patch: Partial<BentoShadow>) => void): {
  blur: HTMLInputElement;
  color: HTMLInputElement;
  x: HTMLInputElement;
  y: HTMLInputElement;
} {
  const blur = numberInput(layer.blur, (value) => update({ blur: value }), { min: 0, step: 0.5 }, "setShadow");
  const color = colorInput(layer.color, (value) => update({ color: value }), "setShadow");
  // An omitted offset is meaningful. Blank fields preserve that optional
  // spelling; entering either coordinate makes the pair explicit at Apply.
  let x: HTMLInputElement;
  let y: HTMLInputElement;
  x = numberInput(layer.offset?.[0], (value) => {
    const peer = parseNumberInputValue(y.value, { step: 0.5 });
    update({ offset: [value, peer ?? layer.offset?.[1] ?? 0] });
  }, { step: 0.5 }, "setShadow");
  y = numberInput(layer.offset?.[1], (value) => {
    const peer = parseNumberInputValue(x.value, { step: 0.5 });
    update({ offset: [peer ?? layer.offset?.[0] ?? 0, value] });
  }, { step: 0.5 }, "setShadow");
  for (const input of [blur, color, x, y]) input.dataset.shadowIndex = String(index);
  host.appendChild(row(index === 0 ? "Blur" : `Blur ${index + 1}`, blur));
  host.appendChild(row(index === 0 ? "Color" : `Color ${index + 1}`, color));
  host.appendChild(row(index === 0 ? "Offset X" : `Offset X ${index + 1}`, x));
  host.appendChild(row(index === 0 ? "Offset Y" : `Offset Y ${index + 1}`, y));
  return { blur, color, x, y };
}

function shadowEditor(host: HTMLElement, ctx: PanelContext): void {
  const element = ctx.element;
  const existing = element.shadow;
  let layers: BentoShadow[] = existing === undefined
    ? [{ blur: 4, color: "#000000", offset: [0, 2] }]
    : (Array.isArray(existing) ? existing : [existing]).map((layer) => structuredClone(layer));
  host.appendChild(section("Shadow"));
  const layerHost = document.createElement("div");
  layerHost.className = "c2a-shadow-layers";
  host.appendChild(layerHost);
  let controls: ReturnType<typeof shadowLayerInputs>[] = [];
  const renderLayers = (): void => {
    layerHost.replaceChildren();
    controls = layers.map((layer, index) => shadowLayerInputs(layerHost, layer, index, (patch) => {
      Object.assign(layers[index]!, patch);
    }));
  };
  renderLayers();
  const readLayer = (input: ReturnType<typeof shadowLayerInputs>): BentoShadow | null => {
    const blur = parseNumberInputValue(input.blur.value, { min: 0, step: 0.5 });
    const color = parseHexColor(input.color.value.trim());
    if (blur === undefined || color === undefined) return null;
    const rawX = input.x.value.trim();
    const rawY = input.y.value.trim();
    if (rawX === "" && rawY === "") return { blur, color };
    const x = rawX === "" ? 0 : parseNumberInputValue(rawX, { step: 0.5 });
    const y = rawY === "" ? 0 : parseNumberInputValue(rawY, { step: 0.5 });
    if (x === undefined || y === undefined) return null;
    return { blur, color, offset: [x, y] };
  };
  host.appendChild(button("Apply shadow", () => {
    const next = controls.map(readLayer);
    if (next.some((layer): layer is null => layer === null)) return;
    const complete = next as BentoShadow[];
    if (complete.length > 16) return;
    const latest = currentDoc(ctx.bridge).elements.find((candidate) => candidate.id === element.id);
    const existingLatest = latest?.shadow;
    if (complete.length === 0) {
      if (!Array.isArray(existingLatest) || existingLatest.length === 0) return;
      ctx.dispatch(shadowCommands(element.id, []));
      return;
    }
    const nextShadow = Array.isArray(existingLatest) || complete.length > 1 ? complete : complete[0]!;
    if (semanticEqual(existingLatest ?? null, nextShadow)) return;
    ctx.dispatch(shadowCommands(element.id, nextShadow));
  }, "setShadow"));
  const add = button("Add shadow layer", () => {
    if (layers.length >= 16) return;
    if (controls.length > 0 && readLayer(controls[controls.length - 1]!) === null) return;
    layers.push({ blur: 2, color: "#000000", offset: [0, 1] });
    renderLayers();
    updateRemoveButton();
    add.disabled = layers.length >= 16;
  });
  add.disabled = layers.length >= 16;
  host.appendChild(add);
  const remove = button("Remove last shadow layer", () => {
    if (layers.length <= 1) return;
    layers.pop();
    renderLayers();
    updateRemoveButton();
    add.disabled = layers.length >= 16;
  });
  const updateRemoveButton = (): void => {
    remove.disabled = layers.length <= 1;
  };
  updateRemoveButton();
  host.appendChild(remove);
  host.appendChild(button("Clear shadow", () => {
    const latest = currentDoc(ctx.bridge).elements.find((candidate) => candidate.id === element.id);
    if (latest?.shadow === undefined || (Array.isArray(latest.shadow) && latest.shadow.length === 0)) return;
    ctx.dispatch(shadowCommands(element.id, null));
  }, "setShadow"));
}

function textGradientEditor(host: HTMLElement, element: BentoTextElementV4, ctx: PanelContext): void {
  const current = element.text.gradient;
  host.appendChild(section("Text gradient"));
  const type = select(
    GRADIENT_TYPES.map((value) => ({ value, label: value })),
    current?.gradientType ?? "linear",
    () => undefined,
    "setStyle",
  );
  const editor = gradientStopsEditor(current?.stops ?? [
    { position: 0, color: "#000000" },
    { position: 1, color: "#FFFFFF" },
  ], {
    hostClass: "c2a-text-gradient-stops",
    step: 0.01,
    command: "setStyle",
    addedStop: { position: 1, color: "#FFFFFF" },
    trimColor: true,
    decoratePosition: (input, index) => { input.dataset.gradientStopIndex = String(index); },
    decorateColor: (input, index) => { input.dataset.gradientStopIndex = String(index); },
    renderStop: (index, position, color) => {
      const line = document.createElement("div");
      line.className = "c2a-row";
      line.append(document.createTextNode(`#${index + 1}`), position, color);
      return line;
    },
  });
  const angleControls = gradientAngleControls(
    current?.gradientType === "linear" ? current.angle : undefined,
    "setStyle",
  );
  const angle = angleControls.angle;
  host.appendChild(editor.stopHost);
  host.appendChild(row("Type", type));
  host.appendChild(row("Angle", angle));
  host.appendChild(angleControls.reset);
  host.appendChild(editor.addStop);
  host.appendChild(editor.removeStop);
  host.appendChild(button("Apply gradient", () => {
    const parsedAngle = type.value === "linear" && angle.value.trim() !== ""
      ? parseNumberInputValue(angle.value, { min: 0, max: 360, maxExclusive: true, step: 1 })
      : undefined;
    if (type.value === "linear" && angle.value.trim() !== "" && parsedAngle === undefined) return;
    const nextStops = editor.readStopsDraft();
    if (nextStops === null) return;
    const gradient: BentoGradientFillV4 = {
      type: "gradient",
      gradientType: type.value as (typeof GRADIENT_TYPES)[number],
      stops: nextStops,
      ...(parsedAngle !== undefined ? { angle: parsedAngle } : {}),
    } as BentoGradientFillV4;
    const latest = currentDoc(ctx.bridge).elements.find((candidate) => candidate.id === element.id);
    if (latest?.kind !== "text") return;
    if (semanticEqual(latest.text.gradient ?? null, gradient)) return;
    ctx.dispatch(textGradientCommands(element.id, gradient));
  }, "setStyle"));
  host.appendChild(button("Clear gradient", () => {
    const latest = currentDoc(ctx.bridge).elements.find((candidate) => candidate.id === element.id);
    if (latest?.kind !== "text" || latest.text.gradient === undefined || latest.text.gradient === null) return;
    ctx.dispatch(textGradientCommands(element.id, null));
  }, "setStyle"));
}

/** Common border + shadow controls; text gets only its supported shadow facet. */
export function renderCommonStylePanel(host: HTMLElement, ctx: PanelContext): void {
  borderEditor(host, ctx);
  shadowEditor(host, ctx);
}

/** Text-only gradient composite editor. */
export function renderTextGradientPanel(host: HTMLElement, ctx: PanelContext): void {
  if (ctx.element.kind === "text") textGradientEditor(host, ctx.element, ctx);
}
