/**
 * Provenance 台账记录（docs/a1b-2-acceptance.md §2.4）。
 * /job/provenance.jsonl 的行格式；egress-proxy 登记（imagegen）、runner 播种
 * （brief-upload）与回收读取共用同一形状——一个含义一个地方。
 */

export interface ProvenanceRecord {
  /** 资产内容 hash（canonical `asset:<sha256>` 引用中的 sha256 部分）。 */
  assetHash: string;
  /** 来源：imagegen = proxy 生成登记；brief-upload = runner 播种的固定素材。 */
  source: "imagegen" | "brief-upload";
  /** imagegen 时的上游 provider 标识（本阶段恒 "local-proxy"，审计记录实际）。 */
  provider?: string;
  /** imagegen 时的实际模型（audit 记录实际值）。 */
  model?: string;
  /** imagegen 操作；brief-upload 无此字段。 */
  operation?: "generate" | "edit";
  /** prompt/instruction 的 sha256（不记明文）。 */
  promptHash?: string;
  /** edit 的输入资产 hash 列表（必须全部已登记）。 */
  inputAssetHashes?: string[];
  /** ISO 时间戳。 */
  registeredAt: string;
}

/** 从 provenance 行集构建 checker assetRegistry（registered hash 集合）。 */
export function assetRegistryFrom(records: Iterable<ProvenanceRecord>): Set<string> {
  const set = new Set<string>();
  for (const r of records) set.add(r.assetHash);
  return set;
}
