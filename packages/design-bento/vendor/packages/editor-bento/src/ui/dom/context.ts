/**
 * C2-A edit surface — 面板上下文（GD-4c Wave C2 ticket #12；浏览器侧）。
 *
 * 零 vendor 依赖：面板只读写 canonical（bridge.snapshot() 解析）与
 * VisualCommandV4（bridge.dispatch）。`element` 是当前选中元素的 canonical
 * 快照（render 帧采样）；`dispatch` 是唯一写路径（终态手势才调用）。
 *
 * 宿主 window 面（GD-4c Wave C2 ticket #16）：项目侧对 window.bento 的全部
 * 读取收敛在本模块 facade（hostSelection/hostRegisterAsset）——patch 的
 * main.ts 组合根定义该宿主面；c2d Test 6 静态扫描 pin：src 内任何 .bento
 * 代码访问只允许出现在本文件，且键不在 {selection, registerAsset} 即违规
 * （新宿主键必须同时进本 interface 与 c2d 测试的允许清单）。
 */
import type { BentoColorStop, BentoDocV4, VisualCommandV4 } from "contracts";
import type { BentoVisualBridge } from "../../bridge.ts";
import { button, colorInput, numberInput, parseHexColor, parseNumberInputValue, type NumberInputOptions } from "./primitives.ts";

/** Semantic equality lives in the Structured Edit module; re-exported here for existing callers. */
export { semanticEqual } from "kernel";

export interface PanelContext {
  bridge: BentoVisualBridge;
  /** 当前选中元素（渲染帧采的 canonical 快照；越帧后需重新读取）。 */
  element: BentoDocV4["elements"][number];
  /** 终态手势 → 精确命令批（fail-soft：被 kernel 拒绝的批次静默忽略）。 */
  dispatch(commands: readonly VisualCommandV4[]): void;
}

/** 重读当前 canonical（面板每次手势后经 bridge 刷新）。
 * bridge.revision 仅在提交的 apply/undo/redo 上变化，故按 (bridge, revision) 记忆化：
 * 同一 revision 内 2-4 次 currentDoc 只付一次 parse；调用方只读不改返回值。 */
let docMemo: { bridge: BentoVisualBridge; revision: number; doc: BentoDocV4 } | null = null;

export function currentDoc(bridge: BentoVisualBridge): BentoDocV4 {
  const revision = bridge.revision;
  if (docMemo !== null && docMemo.bridge === bridge && docMemo.revision === revision) {
    return docMemo.doc;
  }
  const doc = JSON.parse(bridge.snapshot()) as BentoDocV4;
  docMemo = { bridge, revision, doc };
  return doc;
}

/**
 * A merge-refused composite commit must not pretend success.  The conflict
 * note surfaces the refusal the same way the chart data editor does: hidden
 * whenever a new commit attempt starts, shown only when the three-way merge
 * fails closed on a concurrent-edit conflict.  These editors carry no
 * draft-pending wedge, so the 200ms poll rebuilds the panel with a fresh
 * base once focus leaves the surface; the note is the refusal's evidence
 * until then.
 */
export function compositeConflictNote(flag: string, message: string): HTMLElement {
  const note = document.createElement("div");
  note.className = "c2a-row";
  note.dataset[flag] = "true";
  note.style.color = "#b91c1c";
  note.textContent = message;
  note.hidden = true;
  return note;
}

// ---- 复合编辑器共享控件（gradient stops / staged crop；调用方保持各自 DOM 顺序） ----

/** gradientStopsEditor 的装配件；调用方按各自（journey 锚定的）DOM 顺序挂载。 */
export interface GradientStopsEditor {
  stopHost: HTMLElement;
  addStop: HTMLButtonElement;
  removeStop: HTMLButtonElement;
  /** Live DOM read of the staged stops; null when any input is invalid. */
  readStopsDraft(): BentoColorStop[] | null;
}

/**
 * Shared gradient stop-list mechanism: position/color input arrays, the
 * fail-closed draft read, and +Stop/−Stop with the two-stop floor.  DOM shape
 * (host class, per-input classes/dataset, row layout, added-stop color) stays
 * caller-supplied because browser journeys and c2a tests pin those selectors.
 * Add/remove read the live DOM draft rather than a stale local array so an
 * in-flight stop edit is never silently discarded by a structural gesture.
 */
export function gradientStopsEditor(
  initialStops: readonly BentoColorStop[],
  opts: {
    hostClass: string;
    step: number;
    command?: string;
    /** Stop appended by "+ Gradient stop" (fill/text: white; table: black). */
    addedStop: BentoColorStop;
    onEdit?: () => void;
    /** Extra draft-validity gate (fill folds its angle input into the stop draft). */
    draftValid?: () => boolean;
    /** style/table accept surrounding whitespace in the hex field; fill does not. */
    trimColor?: boolean;
    decoratePosition?: (input: HTMLInputElement, index: number) => void;
    decorateColor?: (input: HTMLInputElement, index: number) => void;
    renderStop: (index: number, position: HTMLInputElement, color: HTMLInputElement) => HTMLElement | HTMLElement[];
    addStopClass?: string;
    removeStopClass?: string;
  },
): GradientStopsEditor {
  const numberOpts: NumberInputOptions = { min: 0, max: 1, step: opts.step };
  let stops = initialStops.map((stop) => ({ ...stop }));
  let positions: HTMLInputElement[] = [];
  let colors: HTMLInputElement[] = [];
  const readStopsDraft = (): BentoColorStop[] | null => {
    if (opts.draftValid !== undefined && !opts.draftValid()) return null;
    const next: BentoColorStop[] = [];
    for (let index = 0; index < positions.length; index += 1) {
      const position = parseNumberInputValue(positions[index]?.value ?? "", numberOpts);
      const rawColor = colors[index]?.value ?? "";
      const color = parseHexColor(opts.trimColor === true ? rawColor.trim() : rawColor);
      if (position === undefined || color === undefined) return null;
      next.push({ position, color });
    }
    return next;
  };
  const stopHost = document.createElement("div");
  stopHost.className = opts.hostClass;
  const renderStops = (): void => {
    stopHost.replaceChildren();
    positions = [];
    colors = [];
    for (const [index, stop] of stops.entries()) {
      const position = numberInput(stop.position, (value) => { stop.position = value; opts.onEdit?.(); }, numberOpts, opts.command);
      opts.decoratePosition?.(position, index);
      const color = colorInput(stop.color, (value) => { stop.color = value; opts.onEdit?.(); }, opts.command);
      opts.decorateColor?.(color, index);
      positions.push(position);
      colors.push(color);
      const rendered = opts.renderStop(index, position, color);
      if (Array.isArray(rendered)) stopHost.append(...rendered);
      else stopHost.appendChild(rendered);
    }
  };
  renderStops();
  const addStop = button("+ Gradient stop", () => {
    const draft = readStopsDraft();
    if (draft === null) return;
    stops = draft;
    stops.push({ ...opts.addedStop });
    opts.onEdit?.();
    renderStops();
    removeStop.disabled = stops.length <= 2;
  });
  if (opts.addStopClass !== undefined) addStop.classList.add(opts.addStopClass);
  const removeStop = button("Remove last stop", () => {
    if (stops.length <= 2) return;
    const draft = readStopsDraft();
    if (draft === null) return;
    stops = draft;
    stops.pop();
    opts.onEdit?.();
    renderStops();
    removeStop.disabled = stops.length <= 2;
  });
  if (opts.removeStopClass !== undefined) removeStop.classList.add(opts.removeStopClass);
  removeStop.disabled = stops.length <= 2;
  return { stopHost, addStop, removeStop, readStopsDraft };
}

/** Shared optional angle input + Reset angle button (linear gradients). */
export function gradientAngleControls(
  initial: number | undefined,
  command: string | undefined,
  onEdit?: () => void,
): { angle: HTMLInputElement; reset: HTMLButtonElement } {
  const angle = numberInput(initial, () => onEdit?.(), { min: 0, max: 360, maxExclusive: true, step: 1 }, command);
  const reset = button("Reset angle", () => { angle.value = ""; onEdit?.(); });
  return { angle, reset };
}

/**
 * The staged four-edge crop block shared by the image-fill editors.  Blank
 * inputs spell the omitted optional crop; callers parse at their terminal
 * gesture so an untouched Apply never materializes a byte-different
 * [0,0,0,0].  Row labels/wrappers stay caller-side (journeys pin them).
 */
export function stagedCropInputs(
  crop: readonly number[] | undefined,
  opts: { step?: number; command?: string; onEdit?: () => void } = {},
): HTMLInputElement[] {
  const initial: Array<number | undefined> = crop === undefined
    ? [undefined, undefined, undefined, undefined]
    : [...crop];
  const numberOpts: NumberInputOptions = opts.step === undefined ? {} : { step: opts.step };
  return initial.map((value) => numberInput(value, () => { opts.onEdit?.(); }, numberOpts, opts.command));
}

/** 模板字符串剪短（run 标签）。 */
export function shortenText(text: string, max = 14): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

// ---- 宿主 window 面 facade（Test 6 边界扫描的允许键集合） ----

/** main.ts a1a2 补丁定义 / 消费的宿主面（window.bento）——本项目侧只读两个键。 */
interface HostWindow {
  bento?: {
    /** 当前选中元素 id 列表（vendor 选择状态；非 canonical，零命令）。 */
    selection?: readonly string[];
    /** 资产字节登记（setAsset/createElement 前置；key = 调用方内容 sha256 hex）。
     * Existing composition roots return void; a newer host may return false to
     * explicitly reject the registration. */
    registerAsset?: (key: string, dataUri: string) => void | boolean;
  };
}

/** Lazy host lookup keeps Node/SSR imports safe; the bridge may boot before the
 * vendor composition root assigns window.bento. */
function hostWindow(): HostWindow | undefined {
  return typeof window === "undefined" ? undefined : (window as unknown as HostWindow);
}

/** 当前选中元素 id；contract 只要求非空 string，identity 不做 trim/重写。 */
export function hostSelection(): readonly string[] {
  const selection = hostWindow()?.bento?.selection;
  return Array.isArray(selection)
    ? selection.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
}

/** 登记资产字节；缺失、显式拒绝或宿主异常均 fail closed。 */
export function hostRegisterAsset(key: string, dataUri: string): boolean {
  const registerAsset = hostWindow()?.bento?.registerAsset;
  if (typeof registerAsset !== "function") return false;
  try {
    return registerAsset(key, dataUri) !== false;
  } catch {
    return false;
  }
}
