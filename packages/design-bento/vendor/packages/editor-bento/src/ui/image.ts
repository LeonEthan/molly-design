/**
 * C2-D edit surface — image family 纯映射（GD-4c Wave C2 ticket #16：patch
 * panels.ts buildImageProps 的 replace + 四边裁剪语义整体移入项目侧）。
 *
 * Node-safe：state → 精确 VisualCommandV4。四边裁剪是 adapter 自有编辑面
 * （image.crop 行 v4 语义：比例正=inset 负=outset）；换图是 image.src 行的
 * 内容寻址整写。DOM 装配在 ui/dom/image.ts，mount 经 bridge 构造挂载。
 */
import type { BentoImageFitModeV4, VisualCommandV4 } from "contracts";

/** 四边裁剪标签（image.crop 行；l/t/r/b 顺序 = v4 crop 元组序）。 */
export const CROP_EDGES = ["l", "t", "r", "b"] as const;

/** 四边比例 [left, top, right, bottom]，正=inset 负=outset。 */
export type CropRatios = [number, number, number, number];

/**
 * 裁剪整写（image.crop 行）：面板直传四边比例或 null 清除可选字段；
 * l+r<1 / t+b<1 的违反由 kernel 具名拒绝（面板不预判——命令面单一校验点）。
 */
export function imageCropCommands(id: string, crop: CropRatios | null): VisualCommandV4[] {
  return [{ type: "setImageCrop", targetId: id, crop }];
}

/** 换图（image.src 行）：内容寻址引用 → setAsset 整写（前置 registerAsset）。 */
export function replaceImageCommands(id: string, assetKey: string): VisualCommandV4[] {
  return [{ type: "setAsset", targetId: id, src: `asset:${assetKey}` }];
}

/** image.fit → exact setImageFit command. */
export function imageFitCommands(id: string, fit: BentoImageFitModeV4): VisualCommandV4[] {
  return [{ type: "setImageFit", targetId: id, fit }];
}

/**
 * Strictly parse the four crop inputs. A crop is one complete gesture: a
 * blank, malformed, or non-finite edge invalidates the whole gesture instead
 * of silently converting it to a different crop. Pair-degeneracy remains the
 * kernel's single semantic validator (left+right/top+bottom must stay < 1).
 */
export function parseCropRatios(raw: readonly string[]): CropRatios | null {
  if (raw.length !== 4) return null;
  const crop: CropRatios = [0, 0, 0, 0];
  for (let index = 0; index < crop.length; index += 1) {
    const value = raw[index]?.trim() ?? "";
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    crop[index] = parsed;
  }
  if (crop[0] + crop[2] >= 1 || crop[1] + crop[3] >= 1) return null;
  return crop;
}
