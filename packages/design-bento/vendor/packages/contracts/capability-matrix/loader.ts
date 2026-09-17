/**
 * Capability matrix 加载器（node 侧）：冻结 hash 门禁 + fail-closed 解析。
 *
 * 单独置于 src/ 之外：vendored 单文件壳构建会拷贝 contracts/src/*.ts 进浏览器
 * bundle（editor-bento/verify/verify.ts COPY_SOURCES），node:fs/crypto 不得进入
 * 该 import 图。消费方经子路径导入：`import { loadCapabilityMatrix } from "contracts/capability-matrix"`。
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { FROZEN_MATRIX_SHA256, parseCapabilityMatrix, type CapabilityMatrix } from "../src/matrix.ts";

export class MatrixHashMismatchError extends Error {
  readonly code = "MATRIX_HASH_MISMATCH";
  readonly expected: string;
  readonly actual: string;

  constructor(expected: string, actual: string) {
    super(`capability matrix content hash mismatch: expected ${expected}, got ${actual}`);
    this.name = "MatrixHashMismatchError";
    this.expected = expected;
    this.actual = actual;
  }
}

export interface LoadedCapabilityMatrix {
  matrix: CapabilityMatrix;
  /** 冻结件字节 sha256（已对 FROZEN_MATRIX_SHA256 校验通过）。 */
  sha256: string;
}

/** 计算字节 sha256 并对冻结值校验（fail closed，不匹配即抛 MatrixHashMismatchError）。 */
export function verifyCapabilityMatrixHash(bytes: Uint8Array, expected: string = FROZEN_MATRIX_SHA256): string {
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) throw new MatrixHashMismatchError(expected, actual);
  return actual;
}

/**
 * 读取冻结 matrix（默认包内 capability-matrix/v1.json），校验内容 hash 后解析。
 * 任何一步失败即抛错，不产出部分结果。
 */
export function loadCapabilityMatrix(path: string | URL = new URL("./v1.json", import.meta.url)): LoadedCapabilityMatrix {
  const bytes = readFileSync(path);
  const sha256 = verifyCapabilityMatrixHash(bytes);
  return { matrix: parseCapabilityMatrix(bytes), sha256 };
}
