/**
 * C2-B gesture routing（GD-4c Wave C2 ticket #13；docs/gd-4-progress.md Wave
 * C2 item 2：所有终态手势路由到 VisualCommand）。
 *
 * Node-safe 纯映射：native 手势输入 → 精确 VisualCommandV4 批。vendor patch
 * 路由 hunks（canvas.ts commitFrames、panels.ts group/ungroup/weightSelect）
 * 消费同一批构件——命令面单一来源，Node 测试与浏览器同一代码路径。
 *
 * ## Commit-site 分类（store.commit / 模型直写站点审计，gd-4-acceptance §4
 * Test 4 命令 trace 的立场）
 *
 * final-gesture（MUST 产生 VisualCommand 批；已路由）：
 * - 画布拖拽 move/resize/rotate（canvas commitFrames）→ frameGestureCommands：
 *   bounds 变更 → setBounds、rotation 变更 → setRotation、未变帧零命令
 * - 画布内联文本编辑提交（canvas 文本编辑）→ setText（+条件 setBounds）
 * - 面板数字行（setNum x/y/w/h）→ setBounds；rotation → setRotation；
 *   opacity → setStyle；text color final → setStyle；z-order step/reorder → setZOrder
 * - image 替换 → registerAsset + setAsset；四边 crop Apply → setImageCrop
 * - 本模块：⌘G/⇧⌘G → setGroupId 批
 * - C2-A 面板（create/delete、flip、cropShape、table 文本/合并/拆分、chart 数据、
 *   line、text-style run/段）→ 各具名命令
 *
 * transient-preview（MAY store-local / DOM-local；reproject 覆盖；零命令）：
 * - pointer-move 拖拽中的中间帧（final 只在 dragEnd 提交）
 * - 颜色/字号 input 未 final 的 CSS preview（setTextColor 非 final 分支）
 * - 画布文本编辑 Escape → 不提交、re-render 恢复 canonical
 * - C2-A 表单值（change 之前）
 *
 * selection 状态（非 canonical；零命令）：
 * - store.select（点选 / selecto 拖框 / shift 多选）与 expandGroups（点选组员
 *   → 选整组）：只改宿主 selection，不失 canonical、不进 trace。
 *
 * 点名范围之外的残留站点（matrix 各行 editContract 的分行义务，登记不拾遗）：
 * - native 元素行 fontSize/lineHeight/align/fill-style/gradient/…（text.* 行
 *   "GD-4c 接 VisualCommand"）
 * - editor Delete 键 / duplicate / paste（common.createDelete C23 全入口接管）；
 *   native table 单元格 dblclick 提交（adapter 格网；C2-A 面板经
 *   setTableCellText）；Page Setup W/H（canvas.size 行）
 */
import type { VisualCommandV4 } from "contracts";
import { groupCommands } from "./transform.ts";

/** 组手势的宿主元素视图（native/v4 共形：id + 可选 groupId）。 */
export interface GroupCandidate {
  id: string;
  groupId?: string | null;
}

let groupSequence = 0;

/** Allocate a deterministic, collision-free flat group label from the current
 * canonical element set.  DOM and keyboard group controls share this seam. */
export function nextGroupId(all: readonly GroupCandidate[]): string {
  const used = new Set(all.map((element) => element.groupId).filter((id): id is string => typeof id === "string"));
  let candidate = "";
  do {
    groupSequence += 1;
    candidate = `grp-${groupSequence.toString(36)}`;
  } while (used.has(candidate));
  return candidate;
}

/**
 * ⌘G 组（common.group 行，hybrid）：同一组标签批量 setGroupId。
 * native 语义：<2 元素不组（no-op，零命令——调用方不得 dispatch）。
 */
export function groupGestureCommands(ids: readonly string[], groupId: string): VisualCommandV4[] {
  if (ids.length < 2) return [];
  return ids.map((id) => groupCommands(id, groupId)[0]);
}

/**
 * ⇧⌘G 离组：选中元素所属各组的全部成员 setGroupId → null（含未选中但同组的
 * 成员——native ungroup 语义：整组离组）。无选中组 → 零命令。
 */
export function ungroupGestureCommands(
  selected: readonly GroupCandidate[],
  all: readonly GroupCandidate[],
): VisualCommandV4[] {
  const gids = new Set(selected.map((el) => el.groupId).filter((group): group is string => Boolean(group)));
  if (gids.size === 0) return [];
  return all
    .filter((el) => typeof el.groupId === "string" && gids.has(el.groupId))
    .map((el) => groupCommands(el.id, null)[0]);
}

/** 画布拖拽结束的一帧（Moveable drag/resize/rotate；native commitDomFrames 读回）。 */
export interface GestureFrame {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
}

/** 手势前的宿主元素状态（commitFrames 时 store.element 仍是手势前值）。 */
export interface FramePriorState {
  bounds: [number, number, number, number];
  rotation?: number;
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

/**
 * 画布终态帧手势（canvas commitFrames；common.bounds/rotation 行）：逐帧比较
 * 手势前状态——bounds 变更 → setBounds；rotation 变更 → setRotation；未变/元素
 * 缺失 → 零命令（final gesture 不产生空批，transient/同值不落 canonical）。
 * 旋转手柄（Moveable rotate/rotateGroup）经同一路由进 kernel（旁路封堵）。
 */
export function frameGestureCommands(
  frames: readonly GestureFrame[],
  priorOf: (id: string) => FramePriorState | undefined,
): VisualCommandV4[] {
  const commands: VisualCommandV4[] = [];
  for (const frame of frames) {
    const prior = priorOf(frame.id);
    if (!prior) continue; // native 语义：元素缺失即跳过
    const bounds: [number, number, number, number] = [
      round1(frame.x), round1(frame.y), round1(frame.w), round1(frame.h),
    ];
    const boundsChanged = bounds.some((value, index) => value !== round1(prior.bounds[index]!));
    if (boundsChanged) {
      commands.push({ type: "setBounds", targetId: frame.id, bounds });
    }
    const rotation = round1(frame.rotation);
    if ((prior.rotation ?? 0) !== rotation) {
      commands.push({ type: "setRotation", targetId: frame.id, rotation });
    }
  }
  return commands;
}
