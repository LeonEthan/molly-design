/**
 * C2-C bypass-sealing guard（GD-4c Wave C2 ticket #14；docs/gd-4-acceptance.md
 * §3.3 exit condition 5：native store 无独立持久化出口，旁路全部 fail closed）。
 *
 * Node-safe 纯模块：patch 的 bypass hunks（main.ts 组合根的 session/serialize/
 * collab/updates 接管、editor.ts 的 autosave/save/copy-export 接管）消费同一
 * 决策表面——Node 单元测试与浏览器端同一代码路径。设计原则：
 *
 * - 封闭世界：被点名的 native 持久化/collab 出口是被审查清单（见 NATIVE_EXIT_
 *   POLICY 每行的 contingency，指向具体 vendor 调用点），集合即合同点名集合；
 *   sealExit 对未知 kind 具名拒绝（程序员错误），绝不静默放行。
 * - fail closed：每次旁路调用都抛具名 SealedExitError——绝不产出字节、绝不
 *   打开网络、绝不写 IndexedDB/localStorage 文档态。
 * - sanctioned 与 sealed 不相交：kernel dispatch（唯一写路径）与 a1a2.save
 *   POST（唯一持久化路径）在 SANCTIONED_PERSIST_PATHS 里显式声名单，集合测试
 *   断言两者永不相交——接错一条 sanctioned 路径即红。
 * - 独立来源：集合与 gd-4-acceptance §3.3.5 点名（save/autosave/IndexedDB/
 *   serializeFile/SyncSession/BroadcastChannel）+ ticket #14 审计行（loadDoc
 *   直写 replaceDoc、update manifest 网络自更新）一一对应，测试以合同文本 pin。
 */

/** 稳定前缀：probe/tests/UI 用它把 sealed rejection 与普通错误区分开。 */
export const SEALED_PREFIX = "a1a2 sealed exit";

/**
 * 被点名的 native 持久化/collab 出口（封闭世界；新增必须同时进 NATIVE_EXIT_
 * POLICY 与合同 pin 测试）。
 */
export type SealedExitKind =
  | "native-save-copy" // Editor.save(true) → saveFile(save picker/download) — "Save a copy…"
  | "native-export" // savePresentationPackage/ReaderCopy/EditorCopy/Template → serializeAuto + writeUpdatedFileAs
  | "autosave" // Editor.wireAutosave → IndexedDB putRecovery/addVersion + file write-back
  | "serialize-file" // window.bento.serialize → serializeFile(projected store) full .bento.html
  | "collab-session" // SyncSession(BroadcastChannel bento-sync-*) + stampInto(collab) + relay transports
  | "native-load-doc" // window.bento.loadDoc → store.replaceDoc outside kernel
  | "update-network"; // checkForUpdates manifest fetch + buildUpdatedFile/applyUpdate

/**
 * 决策表（规格工件）：每行写明它封埋的 vendor 出口；空壳行由 T1 拒绝。经
 * `satisfies` 保证与 SealedExitKind 封闭世界严格一致。fail-closed 是集合的
 * 不变量（每个 kind 都封），不是逐行枚举的数据——`closed` 字段会被类型系统
 * 固化，不携带信息，故不存。
 */
export const NATIVE_EXIT_POLICY = {
  "native-save-copy": {
    contingency: "Editor.save(true) -> saveFile: showSaveFilePicker/downloadFile of the projected store",
  },
  "native-export": {
    contingency: "savePresentationPackage/saveReaderCopy/saveEditorCopy/saveAsTemplate -> serializeAuto + writeUpdatedFileAs",
  },
  autosave: {
    contingency: "Editor.wireAutosave -> IndexedDB putRecovery/addVersion + hasFileHandle write-back",
  },
  "serialize-file": {
    contingency: "window.bento.serialize -> serializeFile(store.doc): full .bento.html bytes of the projected store",
  },
  "collab-session": {
    contingency: "SyncSession constructor (BroadcastChannel bento-sync-*), stampInto(collab.sync), relay transports",
  },
  "native-load-doc": {
    contingency: "window.bento.loadDoc -> store.replaceDoc outside the kernel (canonical divergence)",
  },
  "update-network": {
    contingency: "checkForUpdates release-manifest fetch + buildUpdatedFile/applyUpdate serialization",
  },
} as const satisfies Record<SealedExitKind, { contingency: string }>;

/** 封闭世界枚举（顺序无关；T1 与合同点名集合逐一比对）。 */
export const SEALED_EXIT_KINDS: readonly SealedExitKind[] = Object.keys(
  NATIVE_EXIT_POLICY,
) as SealedExitKind[];

/** 运行时 kind 校验（sealExit 对未知字符串具名拒绝）。 */
export function isKnownSealedExitKind(value: string): value is SealedExitKind {
  return (SEALED_EXIT_KINDS as readonly string[]).includes(value);
}

/**
 * 唯一允许的持久化路径（与 sealed 集合不相交，T4 断言）：kernel dispatch 是
 * 唯一写路径（VisualCommand → kernel → canonical），a1a2.save POST 是唯一
 * 落盘路径（committed canonical → workspace revision）。
 */
export const SANCTIONED_PERSIST_PATHS = [
  "kernel-apply-batch",
  "a1a2-save-post",
] as const;

export function isSanctionedPersistPath(path: string): boolean {
  return (SANCTIONED_PERSIST_PATHS as readonly string[]).includes(path);
}

/** named sealed rejection（class 使 isSealedExit 的 instanceof 分支独立于前缀）。 */
export class SealedExitError extends Error {
  readonly kind: SealedExitKind;

  constructor(kind: SealedExitKind, message: string) {
    super(message);
    this.name = "SealedExitError";
    this.kind = kind;
  }
}

/** 只构建 message 不抛错（UI 提示/console.warn 用；sealExit 才负责 throw）。 */
export function sealExitMessage(kind: SealedExitKind, detail?: string): string {
  return `${SEALED_PREFIX}: ${kind}${detail ? ` — ${detail}` : ""}`;
}

/** fail-closed 强制执行：抛 named SealedExitError；未知 kind 是程序员错误。 */
export function sealExit(kind: SealedExitKind, detail?: string): never {
  if (!isKnownSealedExitKind(kind)) {
    throw new Error(
      `${SEALED_PREFIX}: unknown sealed exit kind "${kind}" — add it to NATIVE_EXIT_POLICY and the contract pin test, or the seal is hollow`,
    );
  }
  throw new SealedExitError(kind, sealExitMessage(kind, detail));
}

/** 分类器（strict instanceof；探针/UI 同一 bundle 同一 realm 内捕获判断）。 */
export function isSealedExit(error: unknown): error is SealedExitError {
  return error instanceof SealedExitError;
}