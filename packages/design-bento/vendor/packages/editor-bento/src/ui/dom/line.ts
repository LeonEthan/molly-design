/**
 * C2-A edit surface — line 面板（GD-4c Wave C2 ticket #12；浏览器侧薄 DOM；
 * 命令来自 ui/line.ts 纯映射）。双端箭头 picker（每端：— / arrow /
 * stealth / diamond / oval），终态手势 → setLineArrow。
 */
import { button, numberInput, parseNumberInputValue, row, section, select, textareaInput } from "./primitives.ts";
import { ARROWHEAD_VOCABULARY, arrowCommands, lineGeometryCommands, linePointsWithinViewBox, type LineCurveMode } from "../line.ts";
import { currentDoc, type PanelContext } from "./context.ts";
import type { BentoDocV4 } from "contracts";

const END_OPTIONS = [
  { value: "none", label: "— none —" },
  ...ARROWHEAD_VOCABULARY.map((kind) => ({ value: kind, label: kind })),
] as const;

const toEnd = (value: string) => (value === "none" ? null : (value as (typeof ARROWHEAD_VOCABULARY)[number]));

const CURVE_OPTIONS = [
  { value: "", label: "— default (omit) —" },
  { value: "sharp", label: "sharp" },
  { value: "round", label: "round" },
  { value: "smooth", label: "smooth" },
] as const;

export function renderLinePanel(host: HTMLElement, ctx: PanelContext): void {
  const element = ctx.element as Extract<BentoDocV4["elements"][number], { kind: "line" }>;
  host.appendChild(section("Line"));
  const viewBox = [
    numberInput(element.viewBox[0], () => undefined, { min: 0, minExclusive: true, step: 1 }, "setLineGeometry"),
    numberInput(element.viewBox[1], () => undefined, { min: 0, minExclusive: true, step: 1 }, "setLineGeometry"),
  ];
  const points = textareaInput(element.points, () => undefined, "setLineGeometry");
  let curveTouched = false;
  const curve = select(CURVE_OPTIONS, element.curve ?? "", () => { curveTouched = true; }, "setLineGeometry");
  host.appendChild(row("ViewBox W", viewBox[0]!));
  host.appendChild(row("ViewBox H", viewBox[1]!));
  host.appendChild(row("Points", points));
  host.appendChild(row("Curve", curve));
  host.appendChild(button("Apply geometry", () => {
    const width = parseNumberInputValue(viewBox[0]!.value, { min: 0, minExclusive: true, step: 1 });
    const height = parseNumberInputValue(viewBox[1]!.value, { min: 0, minExclusive: true, step: 1 });
    if (width === undefined || height === undefined) return;
    if (!linePointsWithinViewBox(points.value, [width, height])) return;
    const current = currentDoc(ctx.bridge).elements.find((candidate) => candidate.id === element.id);
    if (current?.kind !== "line") return;
    const selected = curve.value as LineCurveMode | "";
    const initialSelection = element.curve ?? "";
    const patch = curveTouched || selected !== initialSelection
      ? selected === "" ? null : selected
      : undefined;
    ctx.dispatch(lineGeometryCommands(element.id, [width, height], points.value, current.curve, patch));
  }, "setLineGeometry"));
  const arrow = element.arrow ?? [null, null];
  const currentArrow = (): [typeof arrow[0], typeof arrow[1]] | null => {
    const current = currentDoc(ctx.bridge).elements.find((candidate) => candidate.id === element.id);
    return current?.kind === "line" ? (current.arrow ?? [null, null]) : null;
  };
  host.appendChild(row("Start", select(END_OPTIONS, arrow[0] ?? "none", (value) => {
    const latest = currentArrow();
    if (latest === null) return;
    ctx.dispatch(arrowCommands(element.id, [toEnd(value), latest[1] ?? null]));
  }, "setLineArrow")));
  host.appendChild(row("End", select(END_OPTIONS, arrow[1] ?? "none", (value) => {
    const latest = currentArrow();
    if (latest === null) return;
    ctx.dispatch(arrowCommands(element.id, [latest[0] ?? null, toEnd(value)]));
  }, "setLineArrow")));
}
