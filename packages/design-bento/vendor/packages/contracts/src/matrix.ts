/**
 * Capability matrix：类型、fail-closed 解析与派生视图（GD-4b Wave B1）。
 *
 * matrix 是支持声明的唯一事实源（docs/gd-4-acceptance.md §1）；人读文档、skill、
 * validator 词表、VisualCommand 命令面与 projector dispatch 都从它对账/派生。
 * 冻结件 packages/contracts/capability-matrix/v1.json（sha256 见
 * FROZEN_MATRIX_SHA256）的字节门禁在 capability-matrix/loader.ts（node 侧 IO；
 * 本模块保持 browser-safe——vendored 单文件壳会拷贝 src/ 进浏览器 bundle）。
 *
 * 结构校验实现合同 §1 完整性规则的机器可查子集：枚举封闭、capabilityId 唯一、
 * 非 active 行 canonicalPath/activeSince 为 null、active 行必填列（7/8/12/15 与
 * 证据）非空、failureCode 码token ∈ DIAGNOSTIC_CODES 且 E010（target-only 码位）
 * 不得被行引用。17 字段填充纪律（逐字段非空等）在 v1 冻结时校验，冻结字节
 * 由 hash 门禁保护，此处不重复。
 * 本文件除错误类外零行为；除 node 无关的纯计算外零依赖。
 */

import { DIAGNOSTIC_CODES } from "./diagnostics.ts";
import type { BentoElementKindV4 } from "./bentodoc-v4.ts";

// ---- matrix schema（17 字段，gd-4-acceptance §1） ----

export type CapabilityFamily =
  | "text"
  | "font"
  | "shape"
  | "line"
  | "image"
  | "icon"
  | "table"
  | "chart"
  | "fill"
  | "common"
  | "canvas";

export type CapabilityTargetState = "target" | "excluded";
/** v1 冻结结果 = active 108 + excluded 8，零 target-only（枚举仍保留该状态）。 */
export type CapabilityProfileState = "active" | "target-only" | "excluded";
export type CapabilityImplementation = "native" | "adapter" | "hybrid" | "none";

export interface CapabilityMatrixRow {
  capabilityId: string;
  family: CapabilityFamily;
  pptdPath: string;
  targetState: CapabilityTargetState;
  profileState: CapabilityProfileState;
  /** 首个承诺该能力的 profile 版本；未 active 为 null。 */
  activeSince: string | null;
  /** BentoDoc v4 唯一语义落点；非 active 为 null；可推导状态记 "derived:<来源>"。 */
  canonicalPath: string | null;
  implementation: CapabilityImplementation;
  vendorEvidence: string;
  importContract: string;
  renderContract: string;
  editContract: string;
  roundTripContract: string;
  exportContract: string;
  failureCode: string;
  fixtureRefs: string[];
  evidenceRefs: string[];
}

export interface CapabilityMatrix {
  matrixSchemaVersion: 1;
  activeProfileVersion: string;
  vendorCommit: string;
  frozenAt: string;
  rows: CapabilityMatrixRow[];
}

/**
 * Frozen Test-4 edit applicability.  Applicability is not a second proof
 * list: it is the one shared contract used to derive the N/A and proven
 * partitions from the active matrix.  Canonical/edit text remains owned by
 * each matrix row; this table contains only the ownership decision and its
 * auditable reason.
 */
export interface CapabilityEditApplicability {
  capabilityId: string;
  reason: "derived" | "read-only" | "composite-owner";
  ownerCapabilityIds: readonly string[];
}

export const EDIT_APPLICABILITY: readonly CapabilityEditApplicability[] = [
  { capabilityId: "common.elementId", reason: "read-only", ownerCapabilityIds: ["common.bounds"] },
  { capabilityId: "common.elementType", reason: "read-only", ownerCapabilityIds: ["common.createDelete"] },
  { capabilityId: "common.theme", reason: "derived", ownerCapabilityIds: ["common.color"] },
  { capabilityId: "common.styleInheritance", reason: "derived", ownerCapabilityIds: ["text.lineHeight"] },
  { capabilityId: "font.fallback", reason: "derived", ownerCapabilityIds: ["font.familyUniform"] },
  { capabilityId: "font.measurement", reason: "derived", ownerCapabilityIds: ["font.familyUniform"] },
  { capabilityId: "image.pipeline", reason: "derived", ownerCapabilityIds: ["image.crop", "image.cropShape", "image.fit"] },
  { capabilityId: "table.cellTextStyleRef", reason: "derived", ownerCapabilityIds: ["table.cellText", "table.cellTextProps", "table.styleRef"] },
  { capabilityId: "table.rowOverColumn", reason: "composite-owner", ownerCapabilityIds: ["table.styleSlots"] },
  { capabilityId: "chart.seriesDefaults", reason: "composite-owner", ownerCapabilityIds: ["chart.encode"] },
] as const;

/** 冻结件内容 sha256（loader 对字节 fail closed）。 */
export const FROZEN_MATRIX_SHA256 = "a96c9959ba6beeb66aca16fa8f48da3993b394ea526ca979c5949aab8e2dfd48";

// ---- fail-closed 解析 ----

export class MatrixInvalidError extends Error {
  readonly code = "MATRIX_INVALID";
  readonly violations: readonly string[];

  constructor(violations: readonly string[]) {
    super(`capability matrix invalid: ${violations.join("; ")}`);
    this.name = "MatrixInvalidError";
    this.violations = violations;
  }
}

const FAMILIES: readonly CapabilityFamily[] = [
  "text",
  "font",
  "shape",
  "line",
  "image",
  "icon",
  "table",
  "chart",
  "fill",
  "common",
  "canvas",
];
const TARGET_STATES: readonly CapabilityTargetState[] = ["target", "excluded"];
const PROFILE_STATES: readonly CapabilityProfileState[] = ["active", "target-only", "excluded"];
const IMPLEMENTATIONS: readonly CapabilityImplementation[] = ["native", "adapter", "hybrid", "none"];

const FAILURE_CODE_TOKEN = /PPTD-[ED]\d{3}/g;

/**
 * 解析并校验 matrix 字节（纯函数；字节内容与 hash 门禁由调用方 loader 负责）。
 * 任一结构违规即抛 MatrixInvalidError（fail closed，不产出部分结果）。
 */
export function parseCapabilityMatrix(bytes: Uint8Array | string): CapabilityMatrix {
  let parsed: unknown;
  try {
    parsed = JSON.parse(typeof bytes === "string" ? bytes : new TextDecoder().decode(bytes));
  } catch (error) {
    throw new MatrixInvalidError([`not valid JSON: ${(error as Error).message}`]);
  }

  const violations: string[] = [];
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new MatrixInvalidError(["root must be an object"]);
  }
  const root = parsed as Record<string, unknown>;

  if (root.matrixSchemaVersion !== 1) {
    violations.push(`matrixSchemaVersion must be 1, got ${JSON.stringify(root.matrixSchemaVersion)}`);
  }
  for (const key of ["activeProfileVersion", "vendorCommit", "frozenAt"] as const) {
    if (typeof root[key] !== "string" || (root[key] as string).length === 0) {
      violations.push(`${key} must be a non-empty string`);
    }
  }
  if (!Array.isArray(root.rows) || root.rows.length === 0) {
    violations.push("rows must be a non-empty array");
  }
  if (violations.length > 0) throw new MatrixInvalidError(violations);

  const rows: CapabilityMatrixRow[] = [];
  const seenIds = new Set<string>();
  for (const [index, raw] of (root.rows as unknown[]).entries()) {
    const rowViolations = validateRow(raw, seenIds, index);
    violations.push(...rowViolations);
    rows.push(raw as CapabilityMatrixRow);
  }
  if (violations.length > 0) throw new MatrixInvalidError(violations);

  return {
    matrixSchemaVersion: 1,
    activeProfileVersion: root.activeProfileVersion as string,
    vendorCommit: root.vendorCommit as string,
    frozenAt: root.frozenAt as string,
    rows,
  };
}

function validateRow(raw: unknown, seenIds: Set<string>, index: number): string[] {
  const at = `rows[${index}]`;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return [`${at} must be an object`];
  const row = raw as Record<string, unknown>;
  const violations: string[] = [];

  const id = row.capabilityId;
  if (typeof id !== "string" || !/^[a-z]+(\.[a-z][a-zA-Z0-9]*)+$/.test(id)) {
    violations.push(`${at}.capabilityId malformed: ${JSON.stringify(id)}`);
    return violations;
  }
  if (seenIds.has(id)) violations.push(`duplicate capabilityId ${id}`);
  seenIds.add(id);

  if (!FAMILIES.includes(row.family as CapabilityFamily)) {
    violations.push(`${id}: unknown family ${JSON.stringify(row.family)}`);
  }
  if (!TARGET_STATES.includes(row.targetState as CapabilityTargetState)) {
    violations.push(`${id}: unknown targetState ${JSON.stringify(row.targetState)}`);
  }
  if (!PROFILE_STATES.includes(row.profileState as CapabilityProfileState)) {
    violations.push(`${id}: unknown profileState ${JSON.stringify(row.profileState)}`);
  }
  if (!IMPLEMENTATIONS.includes(row.implementation as CapabilityImplementation)) {
    violations.push(`${id}: unknown implementation ${JSON.stringify(row.implementation)}`);
  }

  const active = row.profileState === "active";
  if (row.targetState === "excluded" && row.profileState !== "excluded") {
    violations.push(`${id}: targetState=excluded requires profileState=excluded`);
  }
  // 非 active 行：canonicalPath/activeSince 为 null（合同 §1 字段表）。
  if (!active && row.canonicalPath !== null) {
    violations.push(`${id}: canonicalPath must be null when not active`);
  }
  if (!active && row.activeSince !== null) {
    violations.push(`${id}: activeSince must be null when not active`);
  }
  // active 行必填列（合同 §1：7/8/12/15 或证据为空则整份 profile 不得发布）。
  if (active) {
    if (typeof row.canonicalPath !== "string" || row.canonicalPath.length === 0) {
      violations.push(`${id}: active row requires non-empty canonicalPath`);
    }
    if (row.implementation === "none") {
      violations.push(`${id}: active row requires a real implementation, got "none"`);
    }
    for (const key of ["editContract", "failureCode", "vendorEvidence"] as const) {
      if (typeof row[key] !== "string" || (row[key] as string).length === 0) {
        violations.push(`${id}: active row requires non-empty ${key}`);
      }
    }
    if (!Array.isArray(row.fixtureRefs) || row.fixtureRefs.length === 0) {
      violations.push(`${id}: active row requires fixture evidence`);
    }
    if (!Array.isArray(row.evidenceRefs) || row.evidenceRefs.length === 0) {
      violations.push(`${id}: active row requires evidence refs`);
    }
    if (typeof row.activeSince !== "string" || row.activeSince.length === 0) {
      violations.push(`${id}: active row requires activeSince`);
    }
  }

  // failureCode 闭包：码 token 必须 ∈ DIAGNOSTIC_CODES；无码行须显式"无独立码"。
  const failureCode = typeof row.failureCode === "string" ? row.failureCode : "";
  const tokens = [...new Set(failureCode.match(FAILURE_CODE_TOKEN) ?? [])];
  if (tokens.length === 0) {
    if (!failureCode.includes("无独立码")) {
      violations.push(`${id}: failureCode carries no diagnostic code and no "无独立码" marker`);
    }
  } else {
    for (const token of tokens) {
      if (!(token in DIAGNOSTIC_CODES)) {
        violations.push(`${id}: failureCode references unknown diagnostic code ${token}`);
      }
      // E010 为 target-only 码位；v1 零 target-only 行，任何行不得引用。
      if (token === "PPTD-E010") {
        violations.push(`${id}: failureCode references reserved PPTD-E010 (no target-only rows in v1)`);
      }
    }
  }

  for (const key of ["fixtureRefs", "evidenceRefs"] as const) {
    if (!Array.isArray(row[key]) || (row[key] as unknown[]).some((ref) => typeof ref !== "string")) {
      violations.push(`${id}: ${key} must be an array of strings`);
    }
  }
  return violations;
}

// ---- 派生视图（全部从已解析 matrix 重算，不二次存储） ----

export interface CapabilityMatrixView {
  matrix: CapabilityMatrix;
  activeRows: readonly CapabilityMatrixRow[];
  excludedCapabilityIds: readonly string[];
  targetOnlyCapabilityIds: readonly string[];
  /** capabilityId → implementation；projector dispatch（GD-4c）的矩阵派生依据。 */
  implementationByCapabilityId: ReadonlyMap<string, CapabilityImplementation>;
  /** capabilityId → 行内引用的诊断码集合。 */
  failureCodesByCapabilityId: ReadonlyMap<string, readonly DiagnosticCodeToken[]>;
  /** BentoDoc v4 元素词表，从 common.elementType 行 canonicalPath 严格解析（fail closed）。 */
  elementKinds: readonly BentoElementKindV4[];
}

export type DiagnosticCodeToken = keyof typeof DIAGNOSTIC_CODES;

const KIND_ROW_ID = "common.elementType";
const KIND_CANONICAL_PATH = /^elements\[\]\.kind（v4 词表 (\d+) 型：([a-z/]+)）$/;

export function capabilityMatrixView(matrix: CapabilityMatrix): CapabilityMatrixView {
  const activeRows = matrix.rows.filter((row) => row.profileState === "active");
  const implementationByCapabilityId = new Map(
    matrix.rows.map((row) => [row.capabilityId, row.implementation]),
  );
  const failureCodesByCapabilityId = new Map(
    matrix.rows.map((row) => [
      row.capabilityId,
      [...new Set((row.failureCode.match(FAILURE_CODE_TOKEN) ?? []))] as DiagnosticCodeToken[],
    ]),
  );

  const kindRow = matrix.rows.find((row) => row.capabilityId === KIND_ROW_ID);
  if (!kindRow || typeof kindRow.canonicalPath !== "string") {
    throw new MatrixInvalidError([`missing row ${KIND_ROW_ID} for element kind vocabulary`]);
  }
  const match = KIND_CANONICAL_PATH.exec(kindRow.canonicalPath);
  if (!match) {
    throw new MatrixInvalidError([
      `${KIND_ROW_ID}: canonicalPath does not match the v4 kind vocabulary pattern: ${kindRow.canonicalPath}`,
    ]);
  }
  const kinds = match[2]!.split("/");
  if (kinds.length !== Number(match[1])) {
    throw new MatrixInvalidError([
      `${KIND_ROW_ID}: declared ${match[1]} kinds but enumerated ${kinds.length}`,
    ]);
  }

  return {
    matrix,
    activeRows,
    excludedCapabilityIds: matrix.rows.filter((row) => row.profileState === "excluded").map((row) => row.capabilityId),
    targetOnlyCapabilityIds: matrix.rows.filter((row) => row.profileState === "target-only").map((row) => row.capabilityId),
    implementationByCapabilityId,
    failureCodesByCapabilityId,
    elementKinds: kinds as BentoElementKindV4[],
  };
}
