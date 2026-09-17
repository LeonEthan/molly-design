/**
 * C2-A edit surface — DOM 原语（GD-4c Wave C2 ticket #12；浏览器侧、薄薄一层）。
 *
 * 只做 DOM 装配：控件带稳定 `data-c2a-command="<commandType>"` 选择器
 * （verify Test 4/#15 以真实手势驱动同一批构件）；样式类前缀 `c2a-` 全部
 * 由 mount 注入的样式表定义（无外部 CSS 依赖，Offline shell 内自足）。
 * 本模块零状态映射逻辑（全部在 src/ui/*.ts 纯模块）——控件只把用户值
 * 交给调用方回调，回调调用 pure builder 产命令。
 */

/** 控件挂 data-c2a-command（终态手势的命令类型可测锚点）。 */
function withCommand<T extends HTMLElement>(node: T, command?: string): T {
  if (command !== undefined) node.dataset.c2aCommand = command;
  return node;
}

/** 通用标签行容器（.c2a-row）。 */
export function row(labelText: string, control: HTMLElement): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "c2a-row";
  // Stable semantic pointer for Test-4 evidence: the label is part of the
  // project-side control contract, not a positional DOM guess.
  wrap.dataset.c2aLabel = labelText;
  const lab = document.createElement("span");
  lab.className = "c2a-label";
  lab.textContent = labelText;
  wrap.append(lab, control);
  return wrap;
}

/** 分段标题。 */
export function section(title: string): HTMLElement {
  const head = document.createElement("div");
  head.className = "c2a-section";
  head.textContent = title;
  return head;
}

/** 按钮。 */
export function button(labelText: string, onClick: () => void, command?: string): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "c2a-btn";
  btn.textContent = labelText;
  btn.addEventListener("click", (event) => {
    event.preventDefault();
    onClick();
  });
  return withCommand(btn, command);
}

/** 选择器。 */
export function select(
  options: readonly { value: string; label: string }[],
  value: string,
  onChange: (value: string) => void,
  command?: string,
): HTMLSelectElement {
  const sel = document.createElement("select");
  sel.className = "c2a-select";
  for (const option of options) {
    const el = document.createElement("option");
    el.value = option.value;
    el.textContent = option.label;
    sel.appendChild(el);
  }
  sel.value = value;
  sel.addEventListener("change", () => onChange(sel.value));
  return withCommand(sel, command);
}

/** Frozen static-v1 color vocabulary: six-digit RGB with optional two-digit alpha. */
const HEX_COLOR = /^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/;

/** Parse a terminal color value without normalizing or inventing an alpha channel. */
export function parseHexColor(value: string): string | undefined {
  return HEX_COLOR.test(value) ? value : undefined;
}

/** 颜色输入（change 即终态手势提交）。 */
export function colorInput(value: string, onChange: (value: string) => void, command?: string): HTMLInputElement {
  const input = document.createElement("input");
  // Native color inputs cannot display or edit the frozen HEX8 form in a
  // portable way. Keep the stable class/command anchor, but use a text field
  // so the canonical spelling (including alpha) remains visible and lossless.
  input.type = "text";
  input.inputMode = "text";
  input.autocomplete = "off";
  input.className = "c2a-color";
  input.value = value;
  let lastCommitted = input.value;
  input.addEventListener("change", () => {
    const parsed = parseHexColor(input.value);
    if (parsed === undefined || input.value === lastCommitted) return;
    onChange(parsed);
    // A text-backed color input also receives the browser's native blur-change
    // after an explicit terminal change.  Do not replay the same valid color
    // into a second kernel batch when focus leaves the field.
    lastCommitted = input.value;
  });
  return withCommand(input, command);
}

const DECIMAL_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
export type NumberInputOptions = {
  min?: number;
  max?: number;
  /** Strict domain boundaries; HTML min/max remain inclusive hints. */
  minExclusive?: boolean;
  maxExclusive?: boolean;
  /** Spinner increment hint only; canonical values are not quantized. */
  step?: number;
};

/** Parse a terminal decimal number and enforce its explicit range contract. */
export function parseNumberInputValue(
  raw: string,
  opts: NumberInputOptions = {},
): number | undefined {
  const value = raw.trim();
  if (value.length === 0 || !DECIMAL_NUMBER.test(value)) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  if (opts.min !== undefined && (!Number.isFinite(opts.min) || (opts.minExclusive ? parsed <= opts.min : parsed < opts.min))) return undefined;
  if (opts.max !== undefined && (!Number.isFinite(opts.max) || (opts.maxExclusive ? parsed >= opts.max : parsed > opts.max))) return undefined;
  return parsed;
}

/** 数字输入（change 即终态手势提交；空值/非法/越界 → 忽略，绝不 dispatch）。 */
export function numberInput(
  value: number | undefined,
  onChange: (value: number) => void,
  opts: NumberInputOptions = {},
  command?: string,
): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "number";
  input.className = "c2a-number";
  if (opts.min !== undefined) input.min = String(opts.min);
  if (opts.max !== undefined) input.max = String(opts.max);
  if (opts.step !== undefined) input.step = String(opts.step);
  if (value !== undefined && Number.isFinite(value)) input.value = String(value);
  let lastCommitted = input.value;
  input.addEventListener("change", () => {
    const parsed = parseNumberInputValue(input.value, opts);
    if (parsed === undefined) return;
    // Playwright/DOM callers may dispatch the terminal change explicitly, after
    // which the browser can emit another native change on blur.  Keep one
    // semantic commit per user gesture, matching textareaInput's guard.
    if (input.value === lastCommitted) return;
    onChange(parsed);
    lastCommitted = input.value;
  });
  return withCommand(input, command);
}

/** 文本输入（change 提交）。 */
export function textInput(value: string, onChange: (value: string) => void, command?: string): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "c2a-text";
  input.value = value;
  let lastCommitted = input.value;
  input.addEventListener("change", () => {
    // An explicit terminal change can be followed by the browser's native
    // blur-change for the same value.  Keep one semantic commit per gesture,
    // just like numberInput/textareaInput, so leaving the field is trace/
    // revision-neutral and cannot create a duplicate setText batch.
    if (input.value === lastCommitted) return;
    onChange(input.value);
    lastCommitted = input.value;
  });
  return withCommand(input, command);
}

/** 多行文本（change/blur 提交；表格/图表单元格文本）。值未变时忽略 blur-change：
 * 提交后若面板把焦点让出，textarea 原生 change 会再触发一次（Test 4 实测 ui-6→ui-7
 * 幽灵 setTableCellText 批次）——与 lastCommitted 相等即跳过。配合 mount 的“焦点
 * 期不重建面板”守卫，编辑中绝不销毁/重发。 */
export function textareaInput(value: string, onChange: (value: string) => void, command?: string): HTMLTextAreaElement {
  const area = document.createElement("textarea");
  area.className = "c2a-textarea";
  area.value = value;
  area.rows = 1;
  let lastCommitted = value;
  area.addEventListener("change", () => {
    if (area.value === lastCommitted) return; // blur 触发的原样 change → 不产生命令。
    onChange(area.value);
    lastCommitted = area.value;
  });
  return withCommand(area, command);
}

/** 布尔开关（change 提交）。 */
export function checkbox(checked: boolean, onChange: (checked: boolean) => void, command?: string): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "c2a-check";
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked));
  return withCommand(input, command);
}
