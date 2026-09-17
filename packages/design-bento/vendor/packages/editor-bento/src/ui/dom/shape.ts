/** Shape preset/adjustment/custom-path composite editor (GD-4 #24). */
import type { BentoDocV4, BentoShapeElementV4, StaticV1ShapeName } from "contracts";
import { STATIC_V1_SHAPE_PRESETS } from "contracts";
import { shapeGeometryCommands } from "../shape.ts";
import { button, numberInput, parseNumberInputValue, row, section, select, textareaInput } from "./primitives.ts";
import { currentDoc, type PanelContext } from "./context.ts";

const SHAPE_NAMES: readonly StaticV1ShapeName[] = [...STATIC_V1_SHAPE_PRESETS, "custom"];
const DEFAULT_CUSTOM_VIEWBOX: [number, number] = [100, 100];
const DEFAULT_CUSTOM_PATH = "M0 0 L100 0 L100 100 L0 100 Z";

function defaultAdjustments(shapeName: StaticV1ShapeName): number[] | undefined {
  if (shapeName === "roundRect") return [10000];
  if (shapeName === "triangle") return [50000];
  if (shapeName === "arrow") return [50000, 50000];
  return undefined;
}

function shapeTarget(doc: BentoDocV4, id: string): BentoShapeElementV4 | undefined {
  const element = doc.elements.find((candidate) => candidate.id === id);
  return element?.kind === "shape" ? element : undefined;
}

/** Shape geometry is one complete command: switching preset clears old custom fields. */
export function renderShapePanel(host: HTMLElement, ctx: PanelContext): void {
  if (ctx.element.kind !== "shape") return;
  const element = ctx.element as BentoShapeElementV4;
  host.appendChild(section("Shape geometry"));
  const preset = select(
    SHAPE_NAMES.map((value) => ({ value, label: value })),
    element.shapeName,
    (value) => {
      const shapeName = value as StaticV1ShapeName;
      if (shapeName === "custom") {
        ctx.dispatch(shapeGeometryCommands(element.id, {
          shapeName,
          viewBox: element.viewBox ?? DEFAULT_CUSTOM_VIEWBOX,
          path: element.path ?? DEFAULT_CUSTOM_PATH,
        }));
        return;
      }
      ctx.dispatch(shapeGeometryCommands(element.id, {
        shapeName,
        adjustments: defaultAdjustments(shapeName),
      }));
    },
    "setShapeGeometry",
  );
  host.appendChild(row("Preset", preset));

  if (element.shapeName === "roundRect") {
    const initial = element.adjustments ?? defaultAdjustments(element.shapeName)!;
    const inputs = initial.map((value, index) => numberInput(
      value,
      (next) => {
        const current = shapeTarget(currentDoc(ctx.bridge), element.id);
        if (!current) return;
        const adjustments = [...(current.adjustments ?? defaultAdjustments(current.shapeName) ?? [])];
        adjustments[index] = next;
        ctx.dispatch(shapeGeometryCommands(current.id, {
          shapeName: current.shapeName,
          adjustments,
        }));
      },
      { min: 0, max: 50000, step: 100 },
      "setShapeGeometry",
    ));
    inputs.forEach((input, index) => host.appendChild(row(`Adjustment ${index + 1}`, input)));
    host.appendChild(button("Reset adjustments", () => {
      const current = shapeTarget(currentDoc(ctx.bridge), element.id);
      if (current?.shapeName !== "roundRect") return;
      if (current.adjustments === undefined || current.adjustments.length === 0) return;
      ctx.dispatch(shapeGeometryCommands(current.id, { shapeName: "roundRect" }));
    }, "setShapeGeometry"));
  } else if (element.shapeName === "triangle" || element.shapeName === "arrow") {
    // static-v1 fixes these preset adjustments exactly; presenting a free
    // number field would mostly emit commands the kernel must reject. Keep
    // the derived values visible but read-only and let preset switching carry
    // the only legal geometry write.
    const derived = defaultAdjustments(element.shapeName)!.join(", ");
    const note = document.createElement("span");
    note.textContent = `[${derived}] (fixed by static-v1)`;
    host.appendChild(row("Adjustments", note));
  }

  if (element.shapeName === "custom") {
    const viewBox = [
      numberInput(element.viewBox?.[0] ?? DEFAULT_CUSTOM_VIEWBOX[0], () => undefined, { min: 0, minExclusive: true, step: 1 }, "setShapeGeometry"),
      numberInput(element.viewBox?.[1] ?? DEFAULT_CUSTOM_VIEWBOX[1], () => undefined, { min: 0, minExclusive: true, step: 1 }, "setShapeGeometry"),
    ];
    const path = textareaInput(element.path ?? DEFAULT_CUSTOM_PATH, () => undefined, "setShapeGeometry");
    host.appendChild(row("ViewBox W", viewBox[0]!));
    host.appendChild(row("ViewBox H", viewBox[1]!));
    host.appendChild(row("Path", path));
    host.appendChild(button("Apply custom path", () => {
      const width = parseNumberInputValue(viewBox[0]!.value, { min: 0, minExclusive: true, step: 1 });
      const height = parseNumberInputValue(viewBox[1]!.value, { min: 0, minExclusive: true, step: 1 });
      if (width === undefined || height === undefined) return;
      ctx.dispatch(shapeGeometryCommands(element.id, {
        shapeName: "custom",
        viewBox: [width, height],
        path: path.value,
      }));
    }, "setShapeGeometry"));
  }
}
