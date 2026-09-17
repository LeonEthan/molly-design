/**
 * validator 的输入/输出合同。
 *
 * ValidatedPptd 是名义（brand）类型：只能由 validator 的成功路径产出，
 * importer 只消费 ValidatedPptd，从而在类型层表达"importer 不校验、
 * 也不依赖 validator 内部"的边界。
 * ImportResult（GD-4b B2，solution.md §8.3）：import 唯一输出合同——成功即
 * 零降级（degradations 类型层钉死为空元组）；import 期具名拒绝走
 * status:"unsupported"，不产出伪可用文档。
 * 本文件只含类型，零行为、零依赖。
 */

import type { BentoDocV4 } from "./bentodoc-v4.ts";
import type { ElementId } from "./commands.ts";
import type { Diagnostic } from "./diagnostics.ts";
import type { PptdManifest, PptdPage } from "./pptd.ts";

/** 已加载的多文件 PPTD 项目（manifest + 按 manifest.pages 同序的页面）。 */
export interface PptdProject {
  manifest: PptdManifest;
  pages: PptdPage[];
}

declare const validatedPptdBrand: unique symbol;

/** 通过 validator（零 E 级诊断）的 PPTD 项目；importer 的唯一合法输入。 */
export type ValidatedPptd = PptdProject & {
  readonly [validatedPptdBrand]: "ValidatedPptd";
};

export type ValidationResult =
  | {
      ok: true;
      document: ValidatedPptd;
      /** 零 E 级；可能携带 D 级提示。 */
      diagnostics: Diagnostic[];
    }
  | {
      ok: false;
      /** 至少一条 E 级诊断；码 + path 稳定（合同 §5）。 */
      diagnostics: Diagnostic[];
    };

/**
 * 资产索引：media/ 相对路径 → 内容寻址 asset 键（"asset:<sha256>"）。
 * 由调用方（runner collect 阶段）在 import 前物化字节并构建；import 期把
 * image src / fill.image src / fonts[].src 固化为 asset: 引用（importContract）。
 */
export type AssetIndex = Record<string, ElementId>;

/** import 期具名拒绝条目（status:"unsupported" 时携带；code ∈ DIAGNOSTIC_CODES）。 */
export interface ImportIssue {
  /** 源 PPTD elementId（可归因到元素时携带）。 */
  sourceId?: string;
  /** PPTD YAML 路径，与 Diagnostic.path 同纪律。 */
  path: string;
  code: string;
  message: string;
}

export type ImportResult =
  | {
      status: "ok";
      document: BentoDocV4;
      /** PPTD elementId → canonical BentoElementId[]（solution.md §8.3）。 */
      sourceMap: Record<ElementId, readonly ElementId[]>;
      /** 取冻结 capability matrix 的 activeProfileVersion（contracts 常量不耦合 matrix 内容）。 */
      profileVersion: string;
      /** Active Profile 内零静默损失：成功即空（类型层钉死）。 */
      degradations: readonly [];
    }
  | {
      status: "unsupported";
      issues: readonly ImportIssue[];
    };
