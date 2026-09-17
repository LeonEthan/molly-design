/**
 * Revision 磁盘 envelope 类型（docs/gd-2-acceptance.md §2.1 冻结 v1，GD-2a 硬切）。
 * 本包只持类型，零行为。校验与落盘在 authoring。
 *
 * manifest/meta 是 DesignRevision 领域聚合（authoring/revisions.ts）的磁盘序列化
 * 投影，非领域模型本身。design snapshot 只持推导锚点（canvas + visualDocument 指针），
 * 不复制 assets/authoring 清单（可推导状态不重复存储）。
 */

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** 序列化投影：内容寻址清单（通用机制，形状不变）。 */
export interface RevisionManifest {
  files: {
    document: string;
    assets: Record<string, string>;
    meta: string;
    authoring: Record<string, string>;
  };
}

/** 序列化投影：schemaVersion 硬切 2；schemaVersion 1（businessSnapshot 壳）字节具名拒绝。 */
export interface RevisionMeta {
  schemaVersion: 2;
  parentRevisionId: string | null;
  traceId: string;
  design: DesignSnapshot;
}

export interface DesignSnapshot {
  canvas: { width: number; height: number };
  /**
   * bento-doc/v4 = GD-4 Active Profile canonical（GD-4b 起）；bento-doc/v3 仅旧
   * revision 读路径（v3→v4 显式迁移属 authoring，B2）。新写入一律 v4。
   */
  visualDocument: { format: "bento-doc/v3" | "bento-doc/v4"; artifactId: "document" };
}
