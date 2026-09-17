/**
 * Checker / Export 公共类型（docs/a1a-3-acceptance.md §2，solution.md §10/§4.2）。
 * 入 contracts 避免 workspace → quality 反向依赖（advisor 裁决）。
 * 本文件只含类型，零行为、零依赖。
 */

import type { BentoBounds } from "./bentodoc.ts";

// ---- CheckerIssue（solution.md §10 schema 全字段） ----

export type CheckerSeverity = "error" | "warning" | "info";
export type CheckerEvaluator = "deterministic" | "model" | "human";
/** enforcement 强度 advisory < requires_review < block_export；与 severity 不互推。 */
export type CheckerEnforcement = "advisory" | "requires_review" | "block_export";

export interface CheckerIssue {
  code: string;
  severity: CheckerSeverity;
  evaluator: CheckerEvaluator;
  /** 只能由规则表查表得到；evaluator 不得自行决定或升级。 */
  enforcement: CheckerEnforcement;
  ruleSetVersion: string;
  elementIdOrPath?: string;
  bounds?: BentoBounds;
  message: string;
  fixHint?: string;
  evidenceRefs?: string[];
}

// ---- CheckerReport + fingerprint（§4.2 A1 最小形态，缺一不通过） ----

export interface CheckerFingerprint {
  /** canonicalJson(doc) 的 sha256 hex。 */
  contentHash: string;
  /** 引用资产 hash，字典序排序（确定性）。 */
  assetHashes: string[];
  ruleSetVersion: string;
  /** Chromium/字体/viewport/DPR/shell+projector 内容 hash；结构检查阶段未知时 null。 */
  renderProfileHash: string | null;
}

/** 确定性 report：不含时间戳（跨运行 byte-identical 纪律）。
 *  GD-3a：report 描述单一文档，moduleId/moduleIds/policyVersion 身份字段删除。 */
export interface CheckerReport {
  issues: CheckerIssue[];
  fingerprint: CheckerFingerprint;
}

// ---- ExportReport（合同 §3；GD-2b：moduleId 字段删除，导出身份 = 文档本身） ----

export interface ExportReport {
  encoding?: { format: 'jpeg'; quality: number; background: string; outputHash: string };
  targetSize: { width: number; height: number };
  actualSize: { width: number; height: number };
  /** PNG 文件字节 sha256（只记录，不作跨机断言）。 */
  pngHash: string;
  /** 解码后 RGBA 像素 sha256（同机确定性断言依据）。 */
  rgbaHash: string;
  renderProfile: {
    chromium: string;
    viewport: { width: number; height: number };
    deviceScaleFactor: number;
    /** 渲染壳内容 hash（单文件 bundle 已内联投影器源码，故同时覆盖 projector）。 */
    shellSha256?: string;
    /** 字体指纹：结构化 family 使用位置、workspace source hash、loaded
     * FontFace/CSS @font-face range 与 canvas 度量证据（renderProfileHash 输入）。 */
    fontFingerprint?: string;
    /** 断网证据（合同 §5 场景 3）。 */
    egress?: {
      externalRequests: number;
      denied: { transport: string; url: string; reason: string }[];
      probeUrl: string;
      probeRejected: boolean;
    };
    /** 资源包络采集（b-5 §2.4）：load = shell 导航开始→bento ready；shot = 截图
     *  调用起止；heap 两点采集，消费方取 max(afterLoad, afterShot)。 */
    timings?: {
      loadMs: number;
      shotMs: number;
      jsHeapAfterLoadMB: number;
      jsHeapAfterShotMB: number;
    };
  };
  checkerReport: CheckerReport;
}
