/**
 * 通用 design job 输入合同（docs/gd-3-acceptance.md §2.1 冻结 v1，GD-3b；
 * #46 扩成 kind 判别联合 — solution.md §7.2）。
 * 本包只持类型，零行为、零依赖。
 *
 * DesignJobSpec = 产品输入唯一事实源（不含任何运维参数——运维参数是
 * agent-runtime 的 RunJobOptions）。CLI 分别投影两者。
 *
 * - prompt：非空；原始 UTF-8 字节保存（authoring/prompt.txt）并参与输入 hash。
 * - references：顺序 = CLI 出现顺序（不按名称排序）；运行期解析为
 *   { logicalName, sha256, bytes }（bytes = 文件字节长度 number，非字节内容）。
 *   产品路径用 upload id 字符串（DesignJobSpec<string>）。
 * - optionalSkills：id 去重并排序后参与输入身份；必须在 capability 白名单。
 */

import type { ElementId } from "./commands.ts";

/** 素材引用：host 侧路径（仅 runner 解析；executor 永不见 host path）。 */
export type AssetRef = { path: string };

/** 可选 skill 引用：id 必须在 capability 白名单（selection:"optional"）。 */
export type SkillRef = { id: string };

/** 断点恢复引用：job 身份 = jobDir；checkpointId 须匹配落盘 checkpoint.json。 */
export type CheckpointRef = { jobDir: string; checkpointId: string };

export type JobSpecBase = {
  prompt: string;
  optionalSkills?: SkillRef[];
  fromCheckpoint?: CheckpointRef;
};

export type GenerateDesignJobSpec<Reference = AssetRef> = JobSpecBase & {
  kind: "generate";
  references: Reference[];
};

export type EditVisualDocumentJobSpec = JobSpecBase & {
  kind: "edit_visual_document";
  selection: ElementId[];
};

export type RegenerateDesignJobSpec = JobSpecBase & {
  kind: "regenerate_design";
  keep: ElementId[];
  replace: ElementId[];
};

export type RegenerateAssetJobSpec = JobSpecBase & {
  kind: "regenerate_asset";
  assetRef: string;
};

export type UpdateDesignLanguageJobSpec = JobSpecBase & {
  kind: "update_design_language";
};

export type DesignJobSpec<Reference = AssetRef> =
  | GenerateDesignJobSpec<Reference>
  | EditVisualDocumentJobSpec
  | RegenerateDesignJobSpec
  | RegenerateAssetJobSpec
  | UpdateDesignLanguageJobSpec;
