/**
 * C2-A edit surface — create/delete 面板（GD-4c Wave C2 ticket #12；
 * 浏览器侧薄 DOM；命令全部来自 ui/create-delete.ts 纯映射）。
 *
 * 创建条：7 型入口（image 走文件选择 → pickImageFile → 内容寻址 key →
 * imageCreateElementCommand）；选中时 Delete 按钮 → deleteElementCommand
 * （多选批量 → 单一 batch）。registerAsset 经 context.ts host facade
 * （#16：window.bento 读取只允许出现在该模块）。
 */
import { button, section } from "./primitives.ts";
import { pickImageFile } from "./image.ts";
import {
  createElementCommand,
  deleteElementCommand,
  imageCreateElementCommand,
} from "../create-delete.ts";
import { nextElementId } from "../defaults.ts";
import { hostSelection, type PanelContext } from "./context.ts";
import type { BentoDocV4, VisualCommandV4 } from "contracts";

const CREATE_KINDS = ["text", "shape", "line", "icon", "table", "chart"] as const;

/** Delete commands sample the host selection at the terminal click. */
export function deleteCurrentSelectionCommands(): VisualCommandV4[] {
  return hostSelection().map((id) => deleteElementCommand(id)[0]);
}

/** 删除按钮（单/多选；batch 一条 deleteElement per id）。 */
function deleteButtons(host: HTMLElement, ctx: PanelContext, selectedIds: readonly string[]): void {
  if (selectedIds.length === 0) return;
  host.appendChild(section(`Delete (${selectedIds.length})`));
  const deleteButton = button("Delete selected", () => {
    const commands = deleteCurrentSelectionCommands();
    if (commands.length === 0) return;
    ctx.dispatch(commands);
  }, "deleteElement");
  deleteButton.dataset.c2aCapability = "common.createDelete";
  host.appendChild(deleteButton);
}

/** image 创建：pickImageFile（sha256 内容寻址 + 宿主 registerAsset，与替换共用）。 */
function pickImage(host: HTMLElement, ctx: PanelContext, canvas: { width: number; height: number }): void {
  const imageButton = button("Image…", () => {
    pickImageFile((assetKey) => {
      ctx.dispatch(imageCreateElementCommand(nextElementId("img"), canvas, `asset:${assetKey}`));
    });
  }, "createElement");
  imageButton.dataset.c2aCapability = "common.createDelete";
  imageButton.dataset.c2aKind = "image";
  host.appendChild(imageButton);
}

/**
 * 创建/删除面：始终渲染创建条（画布尺寸来自 canonical inspect），
 * selectedIds 决定删除区。
 */
export function renderCreatePanel(host: HTMLElement, ctx: PanelContext, selectedIds: readonly string[]): void {
  const canvas = (ctx.bridge.inspect() as { width: number; height: number }) ?? { width: 1000, height: 800 };
  host.appendChild(section("New element"));
  const strip = document.createElement("div");
  strip.className = "c2a-strip";
  for (const kind of CREATE_KINDS) {
    const createButton = button(kind[0]!.toUpperCase() + kind.slice(1), () => {
      const id = nextElementId(kind.slice(0, 3));
      const command = createElementCommand(kind, id, canvas)[0];
      ctx.dispatch([command]);
    }, "createElement");
    createButton.dataset.c2aCapability = "common.createDelete";
    createButton.dataset.c2aKind = kind;
    strip.appendChild(createButton);
  }
  host.appendChild(strip);
  pickImage(host, ctx, canvas);
  deleteButtons(host, ctx, selectedIds);
}

/** 选中元素实体（canonical 快照查找；未选 = undefined）。 */
export function selectedElement(
  doc: BentoDocV4,
  ids: readonly string[],
): BentoDocV4["elements"][number] | undefined {
  if (ids.length !== 1) return undefined;
  return doc.elements.find((element) => element.id === ids[0]);
}
