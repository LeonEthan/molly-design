/**
 * common.flip 家族（GD-4c Wave C1 ticket #8；matrix common.flip 行 adapter，
 * renderContract "实测 E2：原生路径零渲染效果（s-flip 元素 transform:''）；渲染
 * 必须由 adapter frame 层负责"；spike fill-common-canvas/notes.md "frame 层
 * transform: rotate(Rdeg) scale(±1,±1)，scale 先在元素局部坐标系生效，
 * 与 PowerPoint flip 语义一致"）。装饰器在 applyElementFrame 之后把
 * scale(±1,±1) 追加进 frame transform（rotate(...) scale(...) 顺序：
 * CSS 最右函数先在局部坐标系生效），与 rotation/opacity/shadow/选择/变换手柄
 * 全留在原生 frame。既有内容渲染面不动、可与 text.rich/image.crop-shape 装饰器
 * 与 frameRenderer 任意组合。
 *
 * Node-safe：DOM 只在函数体内（sealed shell 消费）。
 */
import type { FrameHostElement, FrameHostRenderContext } from "../boot/frame-host.ts";

interface FlipFrameElement extends FrameHostElement {
  flip?: [boolean, boolean];
}

/** transform.flip 装饰器：在 frame 现有 rotate 之后追加 scale(±1,±1)。 */
export function renderFlipDecorator(
  element: FrameHostElement,
  frameNode: HTMLElement,
  _ctx: FrameHostRenderContext,
): void {
  const flip = (element as FlipFrameElement).flip;
  if (!flip) return;
  const sx = flip[0] === true ? -1 : 1;
  const sy = flip[1] === true ? -1 : 1;
  const base = frameNode.style.transform ?? "";
  frameNode.style.transform = base ? `${base} scale(${sx},${sy})` : `scale(${sx},${sy})`;
}