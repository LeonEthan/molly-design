/**
 * C2-A edit surface — transform/image 面板（GD-4c Wave C2 ticket #12；
 * 浏览器侧薄 DOM；命令来自 ui/transform.ts 纯映射）。
 *
 * 面：flip H/V（common.flip adapter）、group 标签置/离组（common.group）、
 * image.cropShape 预设/清除（image.cropShape adapter）。shape/icon/line/
 * table/chart 仅共享 group（common 行）；image 追加 cropShape。
 */
import { button, checkbox, numberInput, parseNumberInputValue, row, section, select, textInput, textareaInput } from "./primitives.ts";
import {
  CROP_SHAPE_PRESETS,
  cropShapeCommands,
  flipCommands,
  numFieldCommands,
  type NumFieldKey,
  groupCommands,
  zOrderStepCommands,
  zOrderToEdgeCommands,
} from "../transform.ts";
import { groupGestureCommands, nextGroupId } from "../gestures.ts";
import { currentDoc, hostSelection, type PanelContext } from "./context.ts";
import type { BentoCropShapeDefV4, BentoDocV4, VisualCommandV4 } from "contracts";

type ElementLike = BentoDocV4["elements"][number];

/** Canonical z-order is the document element sequence with its explicit zIndex. */
function zOrderIds(doc: BentoDocV4): string[] {
  return doc.elements
    .map((element, sequence) => ({ id: element.id, zIndex: element.zIndex, sequence }))
    .sort((left, right) => left.zIndex - right.zIndex || left.sequence - right.sequence)
    .map(({ id }) => id);
}

type NumericFieldSpec = {
  key: NumFieldKey;
  label: string;
  command: string;
  min?: number;
  minExclusive?: boolean;
  max?: number;
  step: number;
};

const NUMERIC_FIELDS: readonly NumericFieldSpec[] = [
  { key: "x", label: "X", command: "setBounds", step: 0.1 },
  { key: "y", label: "Y", command: "setBounds", step: 0.1 },
  { key: "w", label: "Width", command: "setBounds", min: 0, minExclusive: true, step: 0.1 },
  { key: "h", label: "Height", command: "setBounds", min: 0, minExclusive: true, step: 0.1 },
  { key: "rotation", label: "Rotation", command: "setRotation", step: 0.1 },
  { key: "opacity", label: "Opacity", command: "setStyle", min: 0, max: 1, step: 0.01 },
] as const;

type NumericField = (typeof NUMERIC_FIELDS)[number]["key"];

function numericValue(element: ElementLike, key: NumericField): number {
  if (key === "x" || key === "y" || key === "w" || key === "h") {
    const index = ({ x: 0, y: 1, w: 2, h: 3 } as const)[key];
    return element.bounds[index];
  }
  if (key === "rotation") return element.rotation ?? 0;
  return element.opacity ?? 1;
}

/** Project-side common.bounds/rotation/opacity numeric controls.  Each change
 * samples the current canonical again before building the command so a panel
 * rendered before another successful edit cannot overwrite a newer axis. */
export function renderNumericTransform(host: HTMLElement, ctx: PanelContext): void {
  const element = ctx.element;
  host.appendChild(section("Geometry"));
  const fields = element.kind === "table" || element.kind === "chart"
    ? NUMERIC_FIELDS.filter((field) => field.key !== "rotation")
    : NUMERIC_FIELDS;
  for (const field of fields) {
    const input = numberInput(
      numericValue(element, field.key),
      (value) => {
        const current = currentDoc(ctx.bridge);
        const commands = numFieldCommands(current, element.id, field.key, value);
        if (commands.length > 0) ctx.dispatch(commands);
      },
      { min: field.min, minExclusive: field.minExclusive, max: field.max, step: field.step },
      field.command,
    );
    input.classList.add(`ed-a1a2-transform-${field.key}`);
    host.appendChild(row(field.label, input));
  }
}

/**
 * Project-side common.zOrder controls.  The selected ids and order are sampled
 * again at click time so a stale panel frame cannot target the wrong index;
 * an empty command list is a genuine edge/multi-select no-op and is not sent
 * to the bridge as an invalid empty batch.
 */
export function renderZOrderPanel(host: HTMLElement, ctx: PanelContext): void {
  const selection = hostSelection();
  const doc = currentDoc(ctx.bridge);
  const order = zOrderIds(doc);
  const selectedIndex = selection.length === 1 ? order.indexOf(selection[0] as string) : -1;
  const canMove = selection.length === 1 && selectedIndex >= 0;

  host.appendChild(section("Layer"));
  const strip = document.createElement("div");
  strip.className = "c2a-strip";

  const add = (
    label: string,
    title: string,
    className: string,
    commands: (current: BentoDocV4, ids: readonly string[]) => VisualCommandV4[],
    disabled: boolean,
  ): void => {
    const control = button(label, () => {
      const current = currentDoc(ctx.bridge);
      const next = commands(current, hostSelection());
      if (next.length > 0) ctx.dispatch(next);
    }, "setZOrder");
    control.title = title;
    control.classList.add(className);
    control.disabled = disabled;
    strip.appendChild(control);
  };

  add(
    "Send to back",
    "Send to back",
    "ed-a1a2-z-order-back",
    (current, ids) => zOrderToEdgeCommands(zOrderIds(current), ids, "back"),
    !canMove || selectedIndex === 0,
  );
  add(
    "Move backward",
    "Move backward",
    "ed-a1a2-z-order-step-back",
    (current, ids) => zOrderStepCommands(zOrderIds(current), ids, -1),
    !canMove || selectedIndex === 0,
  );
  add(
    "Move forward",
    "Move forward",
    "ed-a1a2-z-order-step-front",
    (current, ids) => zOrderStepCommands(zOrderIds(current), ids, 1),
    !canMove || selectedIndex === order.length - 1,
  );
  add(
    "Bring to front",
    "Bring to front",
    "ed-a1a2-z-order-front",
    (current, ids) => zOrderToEdgeCommands(zOrderIds(current), ids, "front"),
    !canMove || selectedIndex === order.length - 1,
  );
  host.appendChild(strip);
}

/** flip/group 公共区（flip 仅 common.flip 宿主；table/chart 只保留 group）。 */
export function renderCommonTransform(host: HTMLElement, ctx: PanelContext): void {
  const element = ctx.element;
  host.appendChild(section("Transform"));
  if (element.kind !== "table" && element.kind !== "chart") {
    const flip = element.flip ?? [false, false];
    const currentFlip = (): [boolean, boolean] | null => {
      const current = currentDoc(ctx.bridge).elements.find((candidate) => candidate.id === element.id);
      return current === undefined ? null : (current.flip ?? [false, false]);
    };
    host.appendChild(row("Flip H", checkbox(flip[0] === true, (checked) => {
      const latest = currentFlip();
      if (latest === null) return;
      ctx.dispatch(flipCommands(element.id, [checked, latest[1] === true]));
    }, "setFlip")));
    host.appendChild(row("Flip V", checkbox(flip[1] === true, (checked) => {
      const latest = currentFlip();
      if (latest === null) return;
      ctx.dispatch(flipCommands(element.id, [latest[0] === true, checked]));
    }, "setFlip")));
  }

  host.appendChild(row("Group", textInput(element.groupId ?? "", (value) => {
    ctx.dispatch(groupCommands(element.id, value.trim() === "" ? null : value.trim()));
  }, "setGroupId")));
  host.appendChild(button("Ungroup", () => {
    ctx.dispatch(groupCommands(element.id, null));
  }, "setGroupId"));
}

/** image.cropShape 预设/清除。 */
export function renderImageCropShape(host: HTMLElement, ctx: PanelContext): void {
  const element = ctx.element as Extract<ElementLike, { kind: "image" }>;
  host.appendChild(section("Crop shape"));
  const options = [
    { value: "", label: "— none —" },
    ...CROP_SHAPE_PRESETS.map((preset) => ({ value: preset.shapeName, label: preset.shapeName })),
    { value: "custom", label: "custom" },
  ];
  const current = element.cropShape?.shapeName ?? "";
  const removeCustomControls = (): void => {
    host.querySelector<HTMLElement>("[data-c2a-custom-crop]")?.remove();
  };
  const renderCustomControls = (cropShape: BentoCropShapeDefV4): void => {
    removeCustomControls();
    const customHost = document.createElement("div");
    customHost.dataset.c2aCustomCrop = "true";
    customHost.appendChild(section("Custom crop mask"));
    const viewBox = [
      numberInput(cropShape.viewBox?.[0] ?? 100, () => undefined, { min: 0, minExclusive: true, step: 1 }, "setImageCropShape"),
      numberInput(cropShape.viewBox?.[1] ?? 100, () => undefined, { min: 0, minExclusive: true, step: 1 }, "setImageCropShape"),
    ];
    const path = textareaInput(cropShape.path ?? "M0 0 L100 0 L100 100 L0 100 Z", () => undefined, "setImageCropShape");
    customHost.appendChild(row("ViewBox W", viewBox[0]!));
    customHost.appendChild(row("ViewBox H", viewBox[1]!));
    customHost.appendChild(row("Path", path));
    customHost.appendChild(button("Apply custom mask", () => {
      const width = parseNumberInputValue(viewBox[0]!.value, { min: 0, minExclusive: true, step: 1 });
      const height = parseNumberInputValue(viewBox[1]!.value, { min: 0, minExclusive: true, step: 1 });
      if (width === undefined || height === undefined) return;
      ctx.dispatch(cropShapeCommands(element.id, {
        shapeName: "custom",
        viewBox: [width, height],
        path: path.value,
      }));
    }, "setImageCropShape"));
    host.appendChild(customHost);
  };
  const removeRoundRectControls = (): void => {
    host.querySelector<HTMLElement>("[data-c2a-roundrect-adjustment]")?.remove();
  };
  const renderRoundRectControls = (cropShape: BentoCropShapeDefV4): void => {
    removeRoundRectControls();
    const controlHost = document.createElement("div");
    controlHost.dataset.c2aRoundrectAdjustment = "true";
    const radius = numberInput(cropShape.adjustments?.[0] ?? 50000, (value) => {
      const updated = currentDoc(ctx.bridge).elements.find((candidate) => candidate.id === element.id);
      if (updated?.kind !== "image" || updated.cropShape?.shapeName !== "roundRect") return;
      ctx.dispatch(cropShapeCommands(element.id, { shapeName: "roundRect", adjustments: [value] }));
    }, { min: 0, max: 50000, step: 100 }, "setImageCropShape");
    controlHost.appendChild(row("Radius", radius));
    controlHost.appendChild(button("Reset radius", () => {
      const updated = currentDoc(ctx.bridge).elements.find((candidate) => candidate.id === element.id);
      if (updated?.kind !== "image" || updated.cropShape?.shapeName !== "roundRect") return;
      if (updated.cropShape.adjustments === undefined || updated.cropShape.adjustments.length === 0) return;
      ctx.dispatch(cropShapeCommands(element.id, { shapeName: "roundRect" }));
    }, "setImageCropShape"));
    host.appendChild(controlHost);
  };
  host.appendChild(row("Preset", select(options, current, (value) => {
    const preset: BentoCropShapeDefV4 | null = value === ""
      ? null
      : value === "custom"
        ? { shapeName: "custom", viewBox: [100, 100], path: "M0 0 L100 0 L100 100 L0 100 Z" }
        : CROP_SHAPE_PRESETS.find((candidate) => candidate.shapeName === value) ?? null;
    removeRoundRectControls();
    removeCustomControls();
    ctx.dispatch(cropShapeCommands(element.id, preset));
    // A select remains focused while its change event is delivered, so the
    // mount focus guard intentionally postpones a full panel rebuild. Append
    // the accepted custom editor immediately after rereading canonical.
    if (value === "custom") {
      const updated = currentDoc(ctx.bridge).elements.find((candidate) => candidate.id === element.id);
      if (updated?.kind === "image" && updated.cropShape?.shapeName === "custom") {
        renderCustomControls(updated.cropShape);
      }
    }
    if (value === "roundRect") {
      const updated = currentDoc(ctx.bridge).elements.find((candidate) => candidate.id === element.id);
      if (updated?.kind === "image" && updated.cropShape?.shapeName === "roundRect") {
        renderRoundRectControls(updated.cropShape);
      }
    }
  }, "setImageCropShape")));

  if (element.cropShape?.shapeName === "roundRect") {
    renderRoundRectControls(element.cropShape);
  }
  if (element.cropShape?.shapeName === "custom") {
    renderCustomControls(element.cropShape);
  }
}

/** 变换/图像面板组装（image 追加 cropShape 区）。 */
export function renderTransformPanel(host: HTMLElement, ctx: PanelContext): void {
  const element = ctx.element;
  renderNumericTransform(host, ctx);
  renderCommonTransform(host, ctx);
  const img = element as Extract<ElementLike, { kind: "image" }>;
  if (img.kind === "image") renderImageCropShape(host, ctx);
}

/** 多选共组面：同组标签 → 批量 setGroupId；离组批量 setGroupId null。 */
export function renderGroupSelection(host: HTMLElement, ctx: PanelContext, ids: readonly string[]): void {
  host.appendChild(section(`Group (${ids.length})`));
  host.appendChild(button("Group selection", () => {
    const current = currentDoc(ctx.bridge);
    const all = current.elements.map(({ id, groupId }) => ({ id, groupId }));
    const selected = all.filter((element) => hostSelection().includes(element.id));
    const commands = groupGestureCommands(selected.map((element) => element.id), nextGroupId(all));
    if (commands.length > 0) ctx.dispatch(commands);
  }, "setGroupId"));
  host.appendChild(button("Ungroup selection", () => {
    const current = currentDoc(ctx.bridge);
    const all = current.elements.map(({ id, groupId }) => ({ id, groupId }));
    const selected = all.filter((element) => hostSelection().includes(element.id));
    const commands = selected.map((element) => groupCommands(element.id, null)[0]);
    if (commands.length > 0) ctx.dispatch(commands);
  }, "setGroupId"));
}
