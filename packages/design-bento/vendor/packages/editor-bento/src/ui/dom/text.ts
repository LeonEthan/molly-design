/**
 * C2-A edit surface — text 面板（GD-4c Wave C2 ticket #12；浏览器侧薄 DOM；
 * 命令来自 ui/text-style.ts 纯映射）。
 *
 * 作用域选择器：Element（元素级 setStyle：opacity/wrap/textDirection/
 * letterSpacing/lineHeightPx/marginTop/align）| Paragraph（段级 setText 重建）
 * | Run（run 级 setText 整写——冻结裁决 D2 诚实路线）。终态手势才 dispatch：
 * input 只是表单值，change 才提交。作用域状态由 mount 按元素持久
 * （revision 刷新后仍停留在用户选择的 run/段）。
 */
import { button, checkbox, colorInput, numberInput, parseNumberInputValue, row, section, select, textInput, textareaInput } from "./primitives.ts";
import { elementStyleCommands, paragraphStyleCommands, plainTextCommandsIfChanged, runStyleCommands, runTextCommands, type RunStylePatch } from "../text-style.ts";
import { currentDoc, shortenText } from "./context.ts";
import type { PanelContext } from "./context.ts";
import { fontFamilyCommands } from "../font.ts";
import { colorCommands } from "../style.ts";
import { renderTextGradientPanel } from "./style.ts";
import { renderFontFamilyControls } from "./font-family.ts";
import { resolveStaticV1TextStyle, type BentoDocV4, type BentoTextElementV4, type BentoTextParagraphV4, type BentoTextRunV4 } from "contracts";

export type TextScopeTarget =
  | { kind: "element" }
  | { kind: "paragraph"; p: number }
  | { kind: "run"; p: number; r: number };

const H_ALIGNS = ["left", "center", "right", "justify", "distributed"] as const;

function parseListLineHeight(value: string): number | `${number}px` | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  if (/^(?:\d+(?:\.\d*)?|\.\d+)px$/.test(trimmed) && Number.parseFloat(trimmed) > 0) return trimmed as `${number}px`;
  const number = parseNumberInputValue(trimmed, { min: 0, minExclusive: true, max: 100 });
  return number !== undefined ? number : undefined;
}

/** 作用域选项（run/段均在 canonical 里存在；每段都有可编辑 composite 面）。 */
export function textScopeTargets(element: BentoTextElementV4): { value: string; target: TextScopeTarget; label: string }[] {
  const targets: { value: string; target: TextScopeTarget; label: string }[] = [
    { value: "element", target: { kind: "element" }, label: "Element" },
  ];
  element.text.paragraphs.forEach((paragraph, p) => {
    paragraph.runs.forEach((run, r) => {
      targets.push({
        value: `r:${p}:${r}`,
        target: { kind: "run", p, r },
        label: `p${p + 1} r${r + 1} ${shortenText(run.text)}`,
      });
    });
    targets.push({ value: `p:${p}`, target: { kind: "paragraph", p }, label: `Paragraph ${p + 1}` });
  });
  return targets;
}

/** run 级控件（text/latex + bold/italic/u/s/sup-sub/color/fontSize/backgroundColor/fontFamily/href）。 */
function runControls(host: HTMLElement, ctx: PanelContext, target: Extract<TextScopeTarget, { kind: "run" }>, element: BentoTextElementV4): void {
  const run: BentoTextRunV4 | undefined = element.text.paragraphs[target.p]?.runs[target.r];
  if (run === undefined) return;
  const commit = (patch: RunStylePatch) => {
    const current = currentDoc(ctx.bridge).elements.find((candidate) => candidate.id === element.id);
    if (current?.kind !== "text") return;
    ctx.dispatch(runStyleCommands(current, target.p, target.r, patch));
  };
  const display = resolveStaticV1TextStyle({
    color: run.color ?? element.text.color,
    fontSize: run.fontSize ?? element.text.fontSize,
    fontFamily: run.fontFamily ?? element.text.fontFamily,
    lineHeight: element.text.lineHeight,
  });
  const displayFamily = display.fontFamily;
  host.appendChild(section("Run style"));
  host.appendChild(row("Run text", textareaInput(run.text, (value) => {
    const current = currentDoc(ctx.bridge).elements.find((candidate) => candidate.id === element.id);
    if (current?.kind !== "text") return;
    ctx.dispatch(runTextCommands(current, target.p, target.r, value));
  }, "setText")));
  host.appendChild(row("Bold", checkbox(run.bold === true, (checked) => commit({ bold: checked }), "setText")));
  host.appendChild(row("Italic", checkbox(run.italic === true, (checked) => commit({ italic: checked }), "setText")));
  host.appendChild(row("Underline", checkbox(run.underline === true, (checked) => commit({ underline: checked }), "setText")));
  host.appendChild(row("Strikethrough", checkbox(run.strikethrough === true, (checked) => commit({ strikethrough: checked }), "setText")));
  host.appendChild(row("Sup / Sub", select([
    { value: "", label: "— none —" },
    { value: "sup", label: "superscript" },
    { value: "sub", label: "subscript" },
  ], run.baselineShift ?? "", (value) => commit({ baselineShift: value === "" ? null : (value as "sup" | "sub") }), "setText")));
  host.appendChild(row("Run color", colorInput(display.color, (value) => commit({ color: value }), "setText")));
  host.appendChild(row("Run size", numberInput(display.fontSize, (value) => commit({ fontSize: value }), { min: 0, minExclusive: true, step: 1 }, "setText")));
  host.appendChild(row("Run bg", colorInput(run.backgroundColor ?? "#FFFFFF", (value) => commit({ backgroundColor: value }), "setText")));
  renderFontFamilyControls({
    host,
    label: "Run font",
    initial: displayFamily,
    onCommit: (family) => commit({ fontFamily: family }),
    command: "setText",
    readCurrent: () => {
      const current = currentDoc(ctx.bridge).elements.find((candidate) => candidate.id === element.id);
      const currentRun = current?.kind === "text" ? current.text.paragraphs[target.p]?.runs[target.r] : undefined;
      return currentRun?.fontFamily ?? (current?.kind === "text" ? current.text.fontFamily : undefined);
    },
    prefix: "ed-a1a2-run",
  });
  host.appendChild(row("Link", textInput(run.href ?? "", (value) => commit({ href: value.trim() === "" ? null : value.trim() }), "setText")));
  host.appendChild(row("LaTeX", textInput(run.latex ?? "", (value) => commit({ latex: value.trim() === "" ? null : value }), "setText")));
}

/** 段级控件（paragraph alignment/line-height/margin/list + list-item style）。 */
function paragraphControls(host: HTMLElement, ctx: PanelContext, target: Extract<TextScopeTarget, { kind: "paragraph" }>, element: BentoTextElementV4): void {
  const paragraph = element.text.paragraphs[target.p];
  if (paragraph === undefined) return;
  const currentParagraph = (): BentoTextParagraphV4 | undefined => {
    const current = currentDoc(ctx.bridge).elements.find((candidate) => candidate.id === element.id);
    return current?.kind === "text" ? current.text.paragraphs[target.p] : undefined;
  };
  const dispatchCurrent = (patch: Parameters<typeof paragraphStyleCommands>[2]): void => {
    const current = currentDoc(ctx.bridge).elements.find((candidate) => candidate.id === element.id);
    if (current?.kind !== "text") return;
    ctx.dispatch(paragraphStyleCommands(current, target.p, patch));
  };
  host.appendChild(section("Paragraph style"));
  host.appendChild(row("Align", select(
    [{ value: "", label: "— inherit —" }, ...H_ALIGNS.map((align) => ({ value: align, label: align }))],
    paragraph.align ?? "",
    (value) => {
      dispatchCurrent({ align: value === "" ? null : (value as (typeof H_ALIGNS)[number]) });
    },
    "setText",
  )));
  host.appendChild(row("Line height", textInput(
    paragraph.lineHeight === undefined ? "" : String(paragraph.lineHeight),
    (value) => {
      if (value.trim() === "") {
        dispatchCurrent({ lineHeight: null });
        return;
      }
      const parsed = parseListLineHeight(value);
      if (parsed !== undefined) dispatchCurrent({ lineHeight: parsed });
    },
    "setText",
  )));
  host.appendChild(button("Clear line height", () => dispatchCurrent({ lineHeight: null }), "setText"));

  const margin = paragraph.margin ?? {};
  for (const key of ["top", "left", "right"] as const) {
    host.appendChild(row(`Margin ${key}`, numberInput(margin[key], (value) => {
      const currentMargin = currentParagraph()?.margin ?? {};
      dispatchCurrent({ margin: { ...currentMargin, [key]: value } });
    }, { step: 1 }, "setText")));
  }
  host.appendChild(button("Clear paragraph margin", () => dispatchCurrent({ margin: null }), "setText"));

  const list = paragraph.list;
  host.appendChild(section("List"));
  host.appendChild(row("List enabled", checkbox(list !== undefined, (checked) => {
    const currentList = currentParagraph()?.list;
    dispatchCurrent({ list: checked ? (currentList ?? { ordered: false, marker: "disc", indent: 0 }) : null });
  }, "setText")));
  if (list !== undefined) {
    const ordered = select(
      [{ value: "false", label: "unordered" }, { value: "true", label: "ordered" }],
      String(list.ordered === true),
      (value) => {
        const currentList = currentParagraph()?.list ?? list;
        dispatchCurrent({ list: { ...currentList, ordered: value === "true" } });
      },
      "setText",
    );
    const marker = textInput(list.marker ?? (list.ordered ? "decimal" : "disc"), (value) => {
      const currentList = currentParagraph()?.list ?? list;
      dispatchCurrent({ list: { ...currentList, marker: value.trim() || undefined } });
    }, "setText");
    const indent = numberInput(list.indent ?? 0, (value) => {
      const currentList = currentParagraph()?.list ?? list;
      dispatchCurrent({ list: { ...currentList, indent: value } });
    }, { min: 0, step: 1 }, "setText");
    host.appendChild(row("Ordered", ordered));
    host.appendChild(row("Marker", marker));
    host.appendChild(row("Indent", indent));

    const itemStyle = list.style ?? {};
    host.appendChild(section("List item style"));
    const itemAlign = select(
      [{ value: "", label: "— inherit —" }, ...H_ALIGNS.map((align) => ({ value: align, label: align }))],
      itemStyle.align ?? "",
      (value) => {
        const currentList = currentParagraph()?.list ?? list;
        const currentStyle = currentList.style ?? {};
        dispatchCurrent({ list: { ...currentList, style: { ...currentStyle, align: value === "" ? undefined : value as (typeof H_ALIGNS)[number] } } });
      },
      "setText",
    );
    const itemLineHeight = textInput(itemStyle.lineHeight === undefined ? "" : String(itemStyle.lineHeight), (value) => {
      const currentList = currentParagraph()?.list ?? list;
      const currentStyle = currentList.style ?? {};
      const trimmed = value.trim();
      if (trimmed === "") {
        const { lineHeight: _lineHeight, ...rest } = currentStyle;
        dispatchCurrent({ list: { ...currentList, style: rest } });
        return;
      }
      const parsed = parseListLineHeight(trimmed);
      if (parsed !== undefined) dispatchCurrent({ list: { ...currentList, style: { ...currentStyle, lineHeight: parsed } } });
    }, "setText");
    const itemLetterSpacing = numberInput(itemStyle.letterSpacing, (value) => {
      const currentList = currentParagraph()?.list ?? list;
      const currentStyle = currentList.style ?? {};
      dispatchCurrent({ list: { ...currentList, style: { ...currentStyle, letterSpacing: value } } });
    }, { step: 0.5 }, "setText");
    const itemMarginTop = numberInput(itemStyle.marginTop, (value) => {
      const currentList = currentParagraph()?.list ?? list;
      const currentStyle = currentList.style ?? {};
      dispatchCurrent({ list: { ...currentList, style: { ...currentStyle, marginTop: value } } });
    }, { step: 1 }, "setText");
    const itemMarginLeft = numberInput(itemStyle.marginLeft, (value) => {
      const currentList = currentParagraph()?.list ?? list;
      const currentStyle = currentList.style ?? {};
      dispatchCurrent({ list: { ...currentList, style: { ...currentStyle, marginLeft: value } } });
    }, { step: 1 }, "setText");
    const itemMarker = textInput(itemStyle.marker ?? "", (value) => {
      const currentList = currentParagraph()?.list ?? list;
      const currentStyle = currentList.style ?? {};
      dispatchCurrent({ list: { ...currentList, style: { ...currentStyle, marker: value.trim() || undefined } } });
    }, "setText");
    host.appendChild(row("Item align", itemAlign));
    host.appendChild(row("Item line height", itemLineHeight));
    host.appendChild(row("Item spacing", itemLetterSpacing));
    host.appendChild(row("Item margin top", itemMarginTop));
    host.appendChild(row("Item margin left", itemMarginLeft));
    host.appendChild(row("Item marker", itemMarker));
  }
}

function textContentPlain(element: BentoTextElementV4): string {
  return element.text.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join("")).join("\n");
}

/** 元素级控件（text content/style setText + setStyle 面）。 */
function elementControls(host: HTMLElement, ctx: PanelContext, element: BentoTextElementV4): void {
  const content = element.text;
  const currentContent = (): BentoTextElementV4["text"] | undefined => {
    const current = currentDoc(ctx.bridge).elements.find((candidate) => candidate.id === element.id);
    return current?.kind === "text" ? current.text : undefined;
  };
  host.appendChild(section("Element style"));
  host.appendChild(row("Text", textareaInput(textContentPlain(element), (value) => {
    const current = currentDoc(ctx.bridge).elements.find((candidate) => candidate.id === element.id);
    if (current?.kind !== "text") return;
    ctx.dispatch(plainTextCommandsIfChanged(current, value));
  }, "setText")));
  host.appendChild(row("Color", colorInput(content.color ?? "#000000", (value) => {
    ctx.dispatch(colorCommands(element.id, value));
  }, "setStyle")));
  const lineHeight = numberInput(content.lineHeight, (value) => {
    // lineHeight and lineHeightPx are mutually exclusive in canonical.  Keep
    // this control honest by requiring the user to clear the fixed-px mode
    // first; the next poll then presents an active ratio control.
    if (content.lineHeightPx !== undefined) return;
    ctx.dispatch(elementStyleCommands(element.id, { lineHeight: value }));
  }, { min: 0, minExclusive: true, max: 100, step: 0.05 }, "setStyle");
  if (content.lineHeightPx !== undefined) {
    lineHeight.disabled = true;
    lineHeight.title = "Clear line height px before setting a ratio";
  }
  host.appendChild(row("Line height", lineHeight));
  host.appendChild(row("Font size", numberInput(content.fontSize, (value) => {
    ctx.dispatch(elementStyleCommands(element.id, { fontSize: value }));
  }, { min: 0, minExclusive: true, step: 1 }, "setStyle")));
  host.appendChild(row("Background", colorInput(content.backgroundColor ?? "#FFFFFF", (value) => {
    ctx.dispatch(elementStyleCommands(element.id, { backgroundColor: value }));
  }, "setStyle")));
  host.appendChild(row("Bold", checkbox(content.bold === true, (checked) => {
    ctx.dispatch(elementStyleCommands(element.id, { bold: checked }));
  }, "setStyle")));
  host.appendChild(row("Italic", checkbox(content.italic === true, (checked) => {
    ctx.dispatch(elementStyleCommands(element.id, { italic: checked }));
  }, "setStyle")));
  renderFontFamilyControls({
    host,
    label: "Font family",
    initial: element.text.fontFamily,
    onCommit: (family) => {
      ctx.dispatch(fontFamilyCommands(element.id, family));
    },
    command: "setStyle",
    readCurrent: () => {
      const current = currentDoc(ctx.bridge).elements.find((candidate) => candidate.id === element.id);
      return current?.kind === "text" ? current.text.fontFamily : undefined;
    },
    prefix: "ed-a1a2-element",
  });
  host.appendChild(row("Wrap", checkbox(content.wrap !== false, (checked) => {
    ctx.dispatch(elementStyleCommands(element.id, { wrap: checked }));
  }, "setStyle")));
  host.appendChild(row("Text direction", select([
    { value: "horizontal", label: "horizontal" },
    { value: "vertical", label: "vertical" },
  ], content.textDirection ?? "horizontal", (value) => {
    ctx.dispatch(elementStyleCommands(element.id, { textDirection: value === "horizontal" ? null : "vertical" }));
  }, "setStyle")));
  host.appendChild(row("Letter spacing", numberInput(content.letterSpacing, (value) => {
    ctx.dispatch(elementStyleCommands(element.id, { letterSpacing: value }));
  }, { min: -1000, max: 1000, step: 0.5 }, "setStyle")));
  const lineHeightPx = numberInput(content.lineHeightPx, (value) => {
    ctx.dispatch(elementStyleCommands(element.id, { lineHeightPx: value }));
  }, { min: 0, minExclusive: true, step: 1 }, "setStyle");
  if (content.lineHeight !== undefined) {
    lineHeightPx.disabled = true;
    lineHeightPx.title = "Clear line height ratio before setting fixed pixels";
  }
  host.appendChild(row("Line height px", lineHeightPx));
  host.appendChild(row("Margin top", numberInput(content.marginTop, (value) => {
    ctx.dispatch(elementStyleCommands(element.id, { marginTop: value }));
  }, { step: 1 }, "setStyle")));
  host.appendChild(row("Align H", select(
    H_ALIGNS.map((align) => ({ value: align, label: align })),
    content.align?.[0] ?? "left",
    (value) => {
      const latest = currentContent();
      if (latest === undefined) return;
      ctx.dispatch(elementStyleCommands(element.id, {
        align: [value as (typeof H_ALIGNS)[number], latest.align?.[1] ?? "middle"],
      }));
    },
    "setStyle",
  )));
  host.appendChild(row("Align V", select(
    [{ value: "top", label: "top" }, { value: "middle", label: "middle" }, { value: "bottom", label: "bottom" }],
    content.align?.[1] ?? "middle",
    (value) => {
      const latest = currentContent();
      if (latest === undefined) return;
      ctx.dispatch(elementStyleCommands(element.id, {
        align: [latest.align?.[0] ?? "left", value as "top" | "middle" | "bottom"],
      }));
    },
    "setStyle",
  )));
  const clearLineHeight = button("Clear line height", () => ctx.dispatch(elementStyleCommands(element.id, { lineHeight: null })), "setStyle");
  clearLineHeight.disabled = content.lineHeight === undefined || content.lineHeightPx !== undefined;
  host.appendChild(clearLineHeight);
  const clearLineHeightPx = button("Clear line height px", () => ctx.dispatch(elementStyleCommands(element.id, { lineHeightPx: null })), "setStyle");
  clearLineHeightPx.disabled = content.lineHeightPx === undefined || content.lineHeight !== undefined;
  host.appendChild(clearLineHeightPx);
}

/**
 * 文本面板。savedScope / onScopeChange 由 mount 持久（revision 刷新后 Scope 不丢）。
 */
export function renderTextPanel(
  host: HTMLElement,
  ctx: PanelContext,
  savedScope: string,
  onScopeChange: (value: string) => void,
): void {
  const element = ctx.element as Extract<BentoDocV4["elements"][number], { kind: "text" }>;
  if (element.kind !== "text" || element.text === undefined) return;
  const targets = textScopeTargets(element);
  const current = targets.some((target) => target.value === savedScope) ? savedScope : "element";
  host.appendChild(section("Text"));
  host.appendChild(row("Scope", select(
    targets.map(({ value, label }) => ({ value, label })),
    current,
    (value) => onScopeChange(value),
    "setText",
  )));
  const target = targets.find((candidate) => candidate.value === current)?.target ?? { kind: "element" as const };
  if (target.kind === "element") {
    elementControls(host, ctx, element);
    renderTextGradientPanel(host, ctx);
  }
  else if (target.kind === "paragraph") paragraphControls(host, ctx, target, element);
  else runControls(host, ctx, target, element);
}
