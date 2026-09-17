/**
 * Checkpoint 原子文件与恢复引用（docs/a1b-3-acceptance.md §2.3 冻结 v1.1）。
 * `<jobDir>/checkpoint.json` 的形状；runtime 写、verify 断言。本包只持类型，零行为。
 *
 * GD-3b（docs/gd-3-acceptance.md §2.3）：输入 hash 腿取代旧整目录腿——
 * inputHash = sha256(canonical JSON（原始 prompt UTF-8 + 有序 reference 身份
 * {logicalName, sha256, bytes} + 排序后 optional skill ids）)。capability 腿独立。
 *
 * 纪律：
 * - 路径均为 jobDir 相对；leaseCwd 恒 "/work"（§0 cwd 逐字一致不变量）。
 * - checkpointId = cp<单调序号>-<sha256(canonical JSON of 除 checkpointId 外全部字段) 前 12 hex>
 *   （hash 不含自身）。
 * - *Hash/*Lines 均指记录时刻前 N 行原始字节 / 前 N 字节的 sha256（append-only 连续性判据）。
 */

export interface CheckpointFile {
  checkpointId: string;
  /** 记录时刻 revision store 的 current（事件流重放须等于它）。 */
  workspaceRevisionId: string;
  /** 该 revision 快照 manifest.json 字节的 sha256。 */
  workspaceManifestHash: string;
  /** jobDir 相对的 pi session 目录（如 "work/sessions"）；恢复时须恰含一个 session 文件。 */
  sessionDir: string;
  /** jobDir 相对的 session jsonl 文件（恰一文件判定的记录值）。 */
  sessionFile: string;
  /** 记录时刻 session 文件前 N 字节数（N = 当时文件全长）。 */
  sessionPrefixBytes: number;
  /** 前 sessionPrefixBytes 字节的 sha256。 */
  sessionPrefixHash: string;
  /** 记录时刻 effects.jsonl 前 effectsIndexLines 行原始字节的 sha256。 */
  effectsIndexHash: string;
  effectsIndexLines: number;
  /** 记录时刻 provenance.jsonl 前 provenanceLines 行原始字节的 sha256。 */
  provenanceHash: string;
  provenanceLines: number;
  /** lease 容器 workdir；恒 "/work"（§0 不变量：resume 的 cwd 不匹配则 -c 找不到会话）。 */
  leaseCwd: "/work";
  /** 输入身份 hash（GD-3b §2.3）：prompt + 有序 reference 身份 + 排序 optional
   *  skill ids 的 canonical JSON sha256；fromCheckpoint 的输入须逐字节同源。 */
  inputHash: string;
  /** === jobDir/capability-manifest.json 的 capabilityHash（B-4；写点自读，调用方不传）。 */
  capabilityHash: string;
}

/** runJob 的恢复入口（合同 §2.3）：job 身份 = jobDir；checkpointId 须匹配落盘文件。
 *  GD-3b：类型唯一事实源 = job.ts 的 CheckpointRef。 */
export type { CheckpointRef } from "./job.ts";
