/**
 * C2-A edit surface — text family 纯映射（GD-4c Wave C2 ticket #12）。
 *
 * Node-safe：state（元素/run/段索引/样式 patch）→ 精确 VisualCommandV4。
 * 冻结裁决 D2 诚实路线——run/段级编辑重建完整 BentoTextContentV4 经 setText
 * 整写（命令面无"部分-run"命令，不得发明）；元素级 adapter 字段经 setStyle。
 * 越界 run/段索引具名拒绝（不静默近似）；rebuild 纯净（不改入参）。
 */
import type {
  BentoTextContentV4,
  BentoTextElementV4,
  BentoTextParagraphV4,
  BentoTextRunV4,
  VisualCommandV4,
  VisualStylePatchV4,
} from "contracts";

/** run 级可编辑字段（BentoTextRunV4 的子集；bold 等原生行也走同一重建面，
 *  保证 run 级视觉与 canonical 单一写路径）。null = 删除字段。 */
export type RunStylePatch = {
  [K in keyof Pick<
    BentoTextRunV4,
    "text" | "bold" | "italic" | "underline" | "strikethrough" | "color" | "fontSize" | "fontFamily" | "backgroundColor" | "baselineShift" | "href" | "latex"
  >]?: BentoTextRunV4[K] | null;
};

/** 段级可编辑字段（paragraph alignment/line-height/margin/list 行）；null = 删除。 */
export type ParagraphStylePatch = {
  [K in keyof Pick<BentoTextParagraphV4, "align" | "lineHeight" | "margin" | "list">]?: BentoTextParagraphV4[K] | null;
};

const RUN_KEYS = new Set<keyof BentoTextRunV4>([
  "text", "bold", "italic", "underline", "strikethrough", "color", "fontSize",
  "fontFamily", "backgroundColor", "baselineShift", "href", "latex",
]);

/**
 * 重建整段内容：目标 run 应用 patch（null = 删除字段），其余逐字节不变。
 * 纯函数：不改入参；越界索引抛错（fail-closed）。
 */
export function rebuildTextContentRun(
  content: BentoTextContentV4,
  paragraphIndex: number,
  runIndex: number,
  patch: RunStylePatch,
): BentoTextContentV4 {
  if (!content.paragraphs[paragraphIndex]) throw new Error(`text-style: 段索引越界（${paragraphIndex}）`);
  if (!content.paragraphs[paragraphIndex]!.runs[runIndex]) throw new Error(`text-style: run 索引越界（${runIndex}）`);
  const rebuilt = structuredClone(content);
  const run = rebuilt.paragraphs[paragraphIndex]!.runs[runIndex]!;
  for (const [key, value] of Object.entries(patch) as Array<[keyof BentoTextRunV4, unknown]>) {
    if (!RUN_KEYS.has(key)) throw new Error(`text-style: 未知 run 字段 ${String(key)}`);
    if (value === null || value === undefined) delete run[key];
    else (run as unknown as Record<string, unknown>)[key as string] = structuredClone(value);
  }
  return rebuilt;
}

/** run 级样式编辑 → setText 整写命令（D2 诚实路线；命令面唯一）。 */
export function runStyleCommands(
  element: BentoTextElementV4,
  paragraphIndex: number,
  runIndex: number,
  patch: RunStylePatch,
): VisualCommandV4[] {
  return [{
    type: "setText",
    targetId: element.id,
    text: rebuildTextContentRun(element.text, paragraphIndex, runIndex, patch),
  }];
}

/** Plain run text (including embedded line breaks) → setText full-content write. */
export function runTextCommands(
  element: BentoTextElementV4,
  paragraphIndex: number,
  runIndex: number,
  text: string,
): VisualCommandV4[] {
  return runStyleCommands(element, paragraphIndex, runIndex, { text });
}

/**
 * Read the lossless plain-text projection used by the element textarea.
 * Paragraph boundaries are represented by one newline; run boundaries are
 * presentation metadata and therefore do not add characters.
 */
export function plainTextValue(content: BentoTextContentV4): string {
  return content.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join("" )).join("\n");
}

/** Element plain-text editor; kernel maps newlines to canonical paragraphs. */
export function plainTextCommands(id: string, text: string): VisualCommandV4[] {
  return [{ type: "setText", targetId: id, text }];
}

/**
 * Element plain-text terminal commit with a canonical no-op guard.
 *
 * The textarea can be recreated after a successful commit (for example when
 * a font registration reprojects the panel).  Its DOM-local blur guard then
 * has no memory of the earlier commit.  Compare against the current canonical
 * content at the command boundary so that a stale native blur cannot create a
 * second revision-equal setText batch.
 */
export function plainTextCommandsIfChanged(
  element: BentoTextElementV4,
  text: string,
): VisualCommandV4[] {
  return plainTextValue(element.text) === text ? [] : plainTextCommands(element.id, text);
}

/** 段级编辑（text.paragraphAlign/paragraphLineHeight 行）→ setText 整写。 */
export function paragraphStyleCommands(
  element: BentoTextElementV4,
  paragraphIndex: number,
  patch: ParagraphStylePatch,
): VisualCommandV4[] {
  if (!element.text.paragraphs[paragraphIndex]) throw new Error(`text-style: 段索引越界（${paragraphIndex}）`);
  const rebuilt = structuredClone(element.text);
  const paragraph = rebuilt.paragraphs[paragraphIndex]!;
  for (const [key, value] of Object.entries(patch) as Array<[keyof BentoTextParagraphV4, unknown]>) {
    if (value === null || value === undefined) delete paragraph[key];
    else (paragraph as unknown as Record<string, unknown>)[key as string] = structuredClone(value);
  }
  return [{ type: "setText", targetId: element.id, text: rebuilt }];
}

/** 元素级样式 → setStyle（common.opacity/text.* 行；adapter 字段同面）。 */
export function elementStyleCommands(id: string, patch: VisualStylePatchV4): VisualCommandV4[] {
  return [{ type: "setStyle", targetId: id, patch: structuredClone(patch) }];
}
