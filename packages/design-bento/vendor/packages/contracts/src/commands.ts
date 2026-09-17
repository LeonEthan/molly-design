/**
 * 命令公共类型的 v3 保留面：ElementId、仍被 v4 命令面复用的三个命令
 * （setBounds/setAsset/setZOrder）、ApplyError/ApplyFailure 与
 * VisualDocumentSnapshot。setAsset 直接写完整 src（"asset:<sha256>" 或
 * "media/..."），inverse 因此总能合法表达旧值。
 * 本文件只含类型，零行为、零依赖。
 */

import type { BentoBounds } from "./bentodoc.ts";

export type ElementId = string;

export interface SetBoundsCommand {
  type: "setBounds";
  targetId: ElementId;
  bounds: BentoBounds;
}

export interface SetAssetCommand {
  type: "setAsset";
  targetId: ElementId;
  /** 新图像源："asset:<sha256hex>"（内容寻址，字节由 adapter/workspace 持有）
   *  或 "media/..." 相对引用。携带完整 src 使 inverse 永远合法（旧值可为任一生效形态）。 */
  src: string;
}

export interface SetZOrderCommand {
  type: "setZOrder";
  targetId: ElementId;
  index: number;
}

export type ApplyErrorCode =
  | "INVALID_BATCH"
  | "STALE_BASE_REVISION"
  | "TARGET_NOT_FOUND"
  | "INVALID_COMMAND";

export interface ApplyError {
  code: ApplyErrorCode;
  message: string;
  commandIndex?: number;
  commandType?: string;
  targetId?: ElementId;
}

export interface ApplyFailure {
  ok: false;
  revision: number;
  error: ApplyError;
}

declare const visualSnapshotBrand: unique symbol;
export type VisualDocumentSnapshot = string & {
  readonly [visualSnapshotBrand]: true;
};
