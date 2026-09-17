/**
 * CapabilityManifest 身份模型 v2（GD-1 统一 skill 合同：docs/generic-design-mvp-plan.md
 * §8 GD-1 + docs/gd-0-inventory.md §3.2）：能力面 = 统一 skill 列表——每项以自声明身份
 * （VENDOR.lock）+ 内容 hash pin，聚合 capabilityHash 进 job-report/trace。
 * v2 取代 b-2 验收合同 §2.1 的 v1「vertical + platformSkills」二元结构（历史出处，
 * 不再兼容）：pack.json/packVersion 身份机制与 lease 双挂载合并视图一并删除。
 * 类型唯一事实源在此；构建/校验算法在 agent-runtime。
 */

export interface CapabilityComponentFile {
  /** 以各自组件根为起点的相对路径（单一命名空间；每 skill 单一挂载点，无合并视图）。 */
  path: string;
  sha256: string;
}

export interface CapabilityComponentPin {
  id: string;
  /** 排序 `path sha256` 行拼接的 sha256（全文件，含身份声明文件自身）。 */
  contentHash: string;
  files: CapabilityComponentFile[];
}

export type SkillSelection = "default" | "optional";

export interface SkillPin extends CapabilityComponentPin {
  /** version = VENDOR.lock treeSha256。 */
  version: string;
  /** default = 每个 job 必选；optional = 仅当 JobSpec 显式选择。 */
  selection: SkillSelection;
}

export interface CapabilityManifest {
  schemaVersion: 2;
  /** 本 job 实际选中的 skill pin；数组顺序 = 白名单登记顺序（capabilityHash 输入的一部分）。 */
  skills: SkillPin[];
  /** sha256(canonicalJson({schemaVersion:2, skills:[{id,version,contentHash,selection}]}))。 */
  capabilityHash: string;
}
