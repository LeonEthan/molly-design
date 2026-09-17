/**
 * Canonical JSON 序列化（fixtures/README.md Golden 约定 + 验收合同 §7.4/§7.5）：
 * 对象键递归字典序、两空格缩进、文件末尾单个换行。
 * 同一输入两次输出 byte-identical；importer 的 golden 对比与 kernel snapshot 直接基于此函数。
 * 跨包共享纪律（一个含义一个地方）：唯一实现位于 contracts，自 A1a-2 起由 authoring 上移。
 */

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeysRecursively(value), null, 2) + "\n";
}

function sortKeysRecursively(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysRecursively);
  }
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = sortKeysRecursively(source[key]);
    }
    return sorted;
  }
  return value;
}
