/**
 * 稳定诊断码（验收合同 §5，属合同，不得漂移）。
 *
 * severity 编码在码本身（PPTD-{E|D}nnn），本表是 code → severity 的唯一事实源；
 * Diagnostic 不重复存 severity（一个含义一个地方，可查表推导）。
 * 本文件只含类型与常量表，零行为、零依赖。
 */

export type DiagnosticSeverity = "E" | "D";

export const DIAGNOSTIC_CODES = {
  "PPTD-E001": { severity: "E", summary: "manifest/page 不是合法 YAML 或缺必填字段" },
  "PPTD-E002": { severity: "E", summary: "画布尺寸必须为正有限整数对" },
  "PPTD-E003": { severity: "E", summary: "elementType 不在子集（chart/未知）" },
  "PPTD-E004": { severity: "E", summary: "远程 URL / script / 事件 / iframe / foreignObject / 音视频" },
  "PPTD-E005": { severity: "E", summary: "引用媒体文件不存在或路径逃逸 media/" },
  "PPTD-E006": { severity: "E", summary: "bounds 缺失/畸形/越出画布" },
  // GD-4 起退役（REPORT §5：语义并入 E010/E013）；码位保留——v1 import 历史行为不追改，
  // v4 路径不得再产出本码。
  "PPTD-E007": { severity: "E", summary: "富文本标签（v1 子集排除）" },
  "PPTD-E008": { severity: "E", summary: "$ theme 引用悬空" },
  "PPTD-E009": {
    severity: "E",
    summary: "table grid 结构违规（rows/cols 非正整数、cells 数量不符、坐标越界/重复、覆盖不全、cellId 空或含 #）",
  },
  // GD-4 起退役（REPORT §5：零静默损失下"丢弃并记录"不再合法，crop 由 image.crop 行
  // 建模）；码位保留——v1 import 历史行为不追改，v4 路径不得再产出本码。
  "PPTD-D101": {
    severity: "D",
    // 与 golden（test/golden/crop.expected.json）message 逐字一致：message 唯一事实源在此，
    // importer 引用本常量而非硬编码。
    summary: "image crop geometry is not modeled in BentoDoc v1; crop discarded",
  },
  // ---- GD-4 新增（spikes/bento-static-closure/REPORT.md §5 冻结码表） ----
  "PPTD-E010": {
    severity: "E",
    // v1 无 target-only 行（零行使用），码位按 REPORT §5 保留。
    summary: "target-only 能力输入（方向全集但 Active Profile 未闭合；message 带 capabilityId）",
  },
  "PPTD-E011": { severity: "E", summary: "excluded 能力输入（产品范围外，具名拒绝）" },
  "PPTD-E012": {
    severity: "E",
    summary: "未登记字体（fontFamily 栈内非 generic family 未登记，含 latin/ea 双 face）",
  },
  "PPTD-E013": { severity: "E", summary: "非法值/词表外枚举（path 指明字段）" },
  "PPTD-E014": {
    severity: "E",
    summary:
      "结构违规（table merge 越界/重叠、chart 数据完整性/混排/DAG、shape path 语法、元素引用悬空、嵌套 group 等）",
  },
} as const satisfies Record<string, { severity: DiagnosticSeverity; summary: string }>;

export type DiagnosticCode = keyof typeof DIAGNOSTIC_CODES;

export interface Diagnostic {
  code: DiagnosticCode;
  /** YAML 路径，如 "pages[0].elements[2].bounds"。 */
  path: string;
  message: string;
}
