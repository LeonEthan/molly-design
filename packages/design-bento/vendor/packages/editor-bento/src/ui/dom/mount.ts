/**
 * C2-A edit surface — 浮动工具栏/面板挂载（GD-4c Wave C2 ticket #12；浏览器侧）。
 *
 * 由 BentoVisualBridge 构造器在浏览器环境调用（Node 路径惰性跳过；幂等防双
 * boot）。零 patch 接入：selection 懒读 window.bento.selection（bridge 构造
 * 早于 window.bento 赋值）、canonical 状态走 bridge.snapshot()、终态手势
 * 全部经 bridge.dispatch()。poll 只在 selection/revision/单元格锚点/文本作用域
 * 变化时重渲染；pagehide 清理定时器。
 *
 * 布局：fixed 左下角浮动条（不侵入 .ed-stage / 右侧属性面板 / 导出 isolateSlide
 * 宿主 #a0a-shot-host）；全部样式内联注入（c2a- 前缀，Offline shell 自足）。
 */
import type { BentoVisualBridge } from "../../bridge.ts";
import type { BentoElementV4, BentoFillV4, VisualCommandV4 } from "contracts";
import { currentDoc, hostSelection, type PanelContext } from "./context.ts";
import { renderCreatePanel, selectedElement } from "./create-delete.ts";
import { renderTextPanel } from "./text.ts";
import { renderTransformPanel, renderGroupSelection, renderZOrderPanel } from "./transform.ts";
import { renderLinePanel } from "./line.ts";
import { renderImagePanel } from "./image.ts";
import { renderCanvasPanel } from "./canvas.ts";
import { renderBackgroundFillPanel, renderElementFillPanel } from "./fill.ts";
import { renderCommonStylePanel } from "./style.ts";
import { renderShapePanel } from "./shape.ts";
import { renderIconPanel } from "./icon.ts";
import { renderFontPanel } from "./font.ts";
import { renderTablePanel, type TableCellAnchor } from "./table.ts";
import { renderChartPanel } from "./chart.ts";
import {
  groupGestureCommands,
  nextGroupId,
  ungroupGestureCommands,
} from "../gestures.ts";
import { deleteElementCommand } from "../create-delete.ts";

/** 面板样式（内联注入，无外部 CSS 依赖）。 */
const SURFACE_CSS = `
.c2a-surface{position:fixed;left:12px;bottom:12px;z-index:2147483000;width:min(380px,calc(100vw - 240px));max-height:min(760px,calc(100vh - 64px));overflow:auto;background:#ffffff;border:1px solid #d8dde3;border-radius:10px;box-shadow:0 8px 24px rgba(15,23,42,.14);font:12px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1a1d24;padding:8px 10px 10px;box-sizing:border-box;}
.c2a-surface *{box-sizing:border-box;}
.c2a-surface [hidden]{display:none!important;}
.c2a-section{font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280;margin:10px 0 4px;}
.c2a-row{display:flex;align-items:center;gap:6px;margin:3px 0;}
.c2a-label{width:84px;flex:0 0 auto;color:#4b5563;}
.c2a-btn{font:inherit;padding:3px 8px;border:1px solid #c9d2dc;border-radius:6px;background:#f8fafc;cursor:pointer;}
.c2a-btn:hover:not(:disabled){background:#eef2f6;}
.c2a-btn:disabled{opacity:.45;cursor:default;}
.c2a-strip{display:flex;flex-wrap:wrap;gap:4px;margin:4px 0;}
.c2a-select,.c2a-number,.c2a-text{font:inherit;padding:2px 6px;border:1px solid #c9d2dc;border-radius:6px;min-width:0;width:auto;}
.c2a-text{width:150px;}
.c2a-number{width:64px;}
.c2a-textarea{font:inherit;width:100%;min-height:44px;padding:3px 6px;border:1px solid #c9d2dc;border-radius:6px;resize:vertical;}
.c2a-color{width:86px;height:22px;padding:2px 6px;border:1px solid #c9d2dc;border-radius:6px;background:none;}
.c2a-check{accent-color:#3564e6;}
.c2a-gridwrap{max-width:100%;overflow:auto;}
.c2a-grid{border-collapse:collapse;margin:4px 0;}
.c2a-grid td{padding:1px;}
.c2a-gridcell{font:inherit;width:70px;padding:2px 4px;border:1px solid #d8dde3;border-radius:4px;}
.c2a-gridheader{font-weight:700;background:#f1f5f9;}
.c2a-surface-head{display:flex;align-items:center;gap:6px;}
.c2a-surface-title{font-weight:700;font-size:12px;flex:1;}
.c2a-close{margin-left:auto;border:none;background:none;cursor:pointer;font:inherit;color:#6b7280;}
`;

let installed = false;
let timer = 0;
/**
 * 挂载编辑面板（幂等）。文档不存在的环境（Node）直接惰性跳过。
 * @param bridge 唯一写路径（dispatch → kernel → refreshView）。
 */
export function installEditSurface(bridge: BentoVisualBridge): void {
  if (typeof document === "undefined" || installed) return;
  installed = true;

  const style = document.createElement("style");
  style.textContent = SURFACE_CSS;
  document.head.appendChild(style);

  const host = document.createElement("div");
  host.className = "c2a-surface";
  const head = document.createElement("div");
  head.className = "c2a-surface-head";
  const title = document.createElement("span");
  title.className = "c2a-surface-title";
  title.textContent = "Edit tools";
  const close = document.createElement("button");
  close.className = "c2a-close";
  close.title = "Collapse";
  close.textContent = "▾";
  let collapsed = false;
  head.append(title, close);
  const content = document.createElement("div");
  host.append(head, content);
  document.body.appendChild(host);

  const textScope = new Map<string, string>();
  let cell: TableCellAnchor | null = null;
  let lastSignature = "";

  const dispatch = (commands: readonly VisualCommandV4[]): void => {
    if (commands.length === 0) return;
    const result = bridge.dispatch(commands);
    // fail-soft：kernel 拒绝的批次（用户手势非法）静默忽略，canonical 不变。
    void result;
  };

  /** 重读该元素当前 fill（越帧后旧 closure 不参与语义判断）。 */
  const fillReader = (id: string, kind: "table" | "shape" | "icon") => (): BentoFillV4 | undefined => {
    const current = currentDoc(bridge).elements.find((candidate) => candidate.id === id);
    return current !== undefined && current.kind === kind ? (current as { fill?: BentoFillV4 }).fill : undefined;
  };

  const render = (): boolean => {
    // 焦点守卫：surface 内可编辑控件（textarea/input/contenteditable，data-c2a-command）
    // 处于焦点时跳过重建——重建会销毁焦点元素，原生 blur-change 幽灵提交一个
    // 重复批次（Test 4 实测 ui-6→ui-7）。select 是例外：其 change 事件切换
    // composite mode（text scope/custom crop）时必须立即重建可见控件。
    const active = document.activeElement;
    const isEditControl =
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement ||
      active instanceof HTMLSelectElement ||
      (active instanceof HTMLElement && active.isContentEditable);
    if (
      isEditControl &&
      !(active instanceof HTMLSelectElement) &&
      active instanceof HTMLElement &&
      host.contains(active) &&
      active.dataset.c2aCommand !== undefined
    ) {
      return false;
    }
    let doc;
    try {
      doc = currentDoc(bridge);
    } catch {
      return false; // canonical 不可解析（过渡态）→ 保持现状，不抛错。
    }
    const selection = hostSelection();
    const element = selectedElement(doc, selection);
    // A chart-data grid is a local composite draft: row/column shape edits are
    // intentionally not canonical until its Apply gesture.  The 200ms poll
    // must not tear that draft down merely because a sibling revision landed;
    // the editor's three-way merge will re-read the latest canonical base at
    // Apply and fail closed on a real same-field/shape conflict.  Selection
    // changes still discard the old surface, so a draft cannot leak to a new
    // target.
    const pendingChartData = content.querySelector<HTMLElement>(
      '.c2a-chart-data-editor[data-c2a-draft-pending="true"]',
    );
    if (
      pendingChartData !== null &&
      element?.kind === "chart" &&
      pendingChartData.dataset.c2aChartDataEditor === element.id
    ) {
      return false;
    }
    const placeholder: BentoElementV4 = { id: selection[0] ?? "", kind: "shape", bounds: [0, 0, 0, 0], zIndex: 0, shapeName: "rect" };
    const ctx: PanelContext = { bridge, element: element ?? placeholder, dispatch };
    content.replaceChildren();

    // C2-D #16：canvas.size 项目侧 Page Setup；无选中元素时也保持可用。
    // 控件只构建 setCanvasSize，经 bridge.dispatch → kernel 写 canonical。
    renderCanvasPanel(content, doc, { dispatch, readDoc: () => currentDoc(bridge) });
    // Document-level persistent background and font registration controls share
    // the same bridge seam as element editors; no native Store writes occur.
    renderBackgroundFillPanel(content, doc.background, dispatch, () => currentDoc(bridge).background);
    renderCreatePanel(content, ctx, selection);
    renderFontPanel(content, ctx, doc);
    if (element !== undefined) renderZOrderPanel(content, ctx);

    if (element !== undefined && element.kind === "text") {
      const savedScope = textScope.get(element.id) ?? "element";
      renderTextPanel(content, ctx, savedScope, (value) => {
        textScope.set(element.id, value);
        render();
      });
      renderCommonStylePanel(content, ctx);
      renderTransformPanel(content, ctx);
    } else if (element !== undefined && element.kind === "table") {
      renderTablePanel(content, ctx, cell);
      renderElementFillPanel(content, element.fill, element.id, dispatch, fillReader(element.id, "table"));
      renderCommonStylePanel(content, ctx);
      renderTransformPanel(content, ctx);
    } else if (element !== undefined && element.kind === "chart") {
      renderChartPanel(content, ctx);
      renderTransformPanel(content, ctx);
    } else if (element !== undefined && element.kind === "image") {
      // C2-D #16：image 编辑面（replace + 四边裁剪）从 patch buildImageProps
      // 整体移入项目侧浮动面板——同一桥接挂载面，零 patch 语义。
      renderImagePanel(content, ctx);
      renderCommonStylePanel(content, ctx);
      renderTransformPanel(content, ctx);
    } else if (element !== undefined && (element.kind === "line" || element.kind === "shape" || element.kind === "icon")) {
      if (element.kind === "line") renderLinePanel(content, ctx);
      if (element.kind === "shape") {
        renderShapePanel(content, ctx);
        renderElementFillPanel(content, element.fill, element.id, dispatch, fillReader(element.id, "shape"));
      }
      if (element.kind === "icon") {
        renderIconPanel(content, ctx);
        renderElementFillPanel(content, element.fill, element.id, dispatch, fillReader(element.id, "icon"));
      }
      renderCommonStylePanel(content, ctx);
      renderTransformPanel(content, ctx);
    } else if (selection.length > 1) {
      renderGroupSelection(content, ctx, selection);
    }
    return true;
  };

  close.addEventListener("click", () => {
    collapsed = !collapsed;
    content.style.display = collapsed ? "none" : "";
    close.textContent = collapsed ? "▸" : "▾";
  });

  // 表格单元格锚点：渲染格网 td[data-r][data-c] 委托收集（成功手势的定位面）。
  document.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const td = target instanceof Element ? target.closest("td[data-r][data-c]") : null;
    if (!(td instanceof HTMLElement)) return;
    const frame = td.closest("[data-el-id]");
    if (!(frame instanceof HTMLElement)) return;
    const elId = frame.dataset.elId;
    if (!elId) return;
    cell = { elId, row: Number(td.dataset.r), col: Number(td.dataset.c) };
    render();
  }, true);

  // ⌘G/⇧⌘G are final gestures, not native Store mutations.  This capture
  // handler is installed before the vendor Editor listener and consumes the
  // adapted path's keyboard event before its bridge guard can return.  The
  // selected ids still come from the host selection facade; all durable state
  // is read from the semantic canonical and written through bridge.dispatch.
  document.addEventListener("keydown", (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "g") return;
    const inField =
      event.target instanceof Element &&
      event.target.closest('input, textarea, select, [contenteditable="true"]') !== null;
    if (inField) return;

    const doc = currentDoc(bridge);
    const all = doc.elements.map(({ id, groupId }) => ({ id, groupId }));
    const selected = all.filter((element) => hostSelection().includes(element.id));
    const commands = event.shiftKey
      ? ungroupGestureCommands(selected, all)
      : groupGestureCommands(selected.map((element) => element.id), nextGroupId(all));

    // Stop the vendor listener for both the successful and native no-op
    // cases.  In an adapted build the native PropsPanel is hidden, so letting
    // its handler continue would make ⌘G silently disappear or re-enter a
    // second mutation path if that guard ever changes.
    event.preventDefault();
    event.stopImmediatePropagation();
    if (commands.length > 0) bridge.dispatch(commands);
  }, true);

  // Delete/Backspace is a final createDelete gesture.  Capture it ahead of the
  // vendor canvas listener, but leave native text/form editing untouched.
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Delete" && event.key !== "Backspace") return;
    const target = event.target;
    if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]') !== null) return;
    const ids = hostSelection();
    if (ids.length === 0) return;
    let doc;
    try {
      doc = currentDoc(bridge);
    } catch {
      return;
    }
    const existing = new Set(doc.elements.map((element) => element.id));
    const commands = ids.filter((id) => existing.has(id)).map((id) => deleteElementCommand(id)[0]);
    if (commands.length === 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    dispatch(commands);
  }, true);

  const poll = (): void => {
    const signature = [
      hostSelection().join(","),
      String(bridge.revision),
      cell === null ? "" : `${cell.elId}:${cell.row}:${cell.col}`,
    ].join("|");
    if (signature === lastSignature) return;
    // A focused edit control may temporarily block render.  Keep the pending
    // signature uncommitted so the first poll after blur reprojects the latest
    // selection/revision instead of treating the skipped render as complete.
    if (render()) lastSignature = signature;
  };
  poll();
  timer = window.setInterval(poll, 200);

  window.addEventListener("pagehide", () => {
    if (timer !== 0) window.clearInterval(timer);
    timer = 0;
  });
}
