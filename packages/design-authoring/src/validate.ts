/** YAML validation boundary. File and frozen-byte readers share the same projection validator. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import type { FrozenDiagnostic, FrozenDiagnosticCode, FrozenAuthoringValidationResult, ValidationResult } from './contracts.ts';
import { liveValidationResult } from './live-diagnostics.ts';
import { validateYaml } from './canvas-format.ts';
import { validateProductBoundaryFile, validateProductBoundarySnapshot } from './product-boundary.ts';
export interface ValidateOptions { projectRoot: string }
interface Ctx {
  diagnostics: FrozenDiagnostic[];
  projectRoot?: string;
  snapshot?: ReadonlyMap<string, Uint8Array>;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function report(ctx: Ctx, code: FrozenDiagnosticCode, file: string, yamlPath: string, message: string): void {
  ctx.diagnostics.push({code, path: `${file}#${yamlPath}`, message});
}

/** 读取并解析 YAML；失败产出 E001（path 落在文件本身）并返回 undefined。 */
function loadYaml(ctx: Ctx, absPath: string, file: string): unknown {
  let text: string;
  try {
    text = readFileSync(absPath, "utf8");
  } catch {
    report(ctx, "PPTD-E001", file, "", `文件不可读：${file}`);
    return undefined;
  }
  return parseYamlText(ctx, text, file);
}

/** Snapshot variant: parse immutable bytes; missing bytes = E001 file unreadable. Never touches FS. */
function loadYamlBytes(ctx: Ctx, bytes: Uint8Array | undefined, file: string): unknown {
  if (bytes === undefined) {
    report(ctx, "PPTD-E001", file, "", `文件不可读：${file}`);
    return undefined;
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8").decode(bytes);
  } catch {
    report(ctx, "PPTD-E001", file, "", `文件不可读：${file}`);
    return undefined;
  }
  return parseYamlText(ctx, text, file);
}

function parseYamlText(ctx: Ctx, text: string, file: string): unknown {
  try {
    return parse(text);
  } catch (err) {
    report(ctx, "PPTD-E001", file, "", `不是合法 YAML：${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
    return undefined;
  }
}



export function validate(entryPath: string, opts: ValidateOptions): ValidationResult {
  const ctx: Ctx = {
    diagnostics: [],
    projectRoot: opts.projectRoot,
  };
  const manifestFile = path.basename(entryPath);

  const productBoundary = validateProductBoundaryFile(entryPath);
  if (productBoundary !== null) return liveValidationResult(productBoundary);

  const raw = loadYaml(ctx, entryPath, manifestFile);
  return liveValidationResult(
    finishValidation(ctx, manifestFile, raw),
  );
}

/**
 * Snapshot variant of the validator. Inputs are a normalized relative entry
 * path plus the complete immutable byte snapshot; media
 * existence, and font-byte sniffing all read only the snapshot. Diagnostic
 * codes, paths, messages, and ordering match the filesystem variant.
 *
 * @internal composition seam for intake only. Focused authoring tests may use
 * it with immutable bytes; cross-package production callers and closure
 * producers must use intakeAuthoring instead.
 */
export function validateSnapshot(entryRel: string, snapshot: ReadonlyMap<string, Uint8Array>): ValidationResult {
  const ctx: Ctx = {
    diagnostics: [],
    snapshot,
  };
  const normEntry = path.posix.normalize(entryRel);
  const manifestFile = normEntry.split("/").pop() ?? normEntry;

  const productBoundary = validateProductBoundarySnapshot(normEntry, snapshot);
  if (productBoundary !== null) return liveValidationResult(productBoundary);

  const raw = loadYamlBytes(ctx, snapshot.get(normEntry), manifestFile);
  return liveValidationResult(
    finishValidation(ctx, manifestFile, raw),
  );
}

function finishValidation(
  ctx: Ctx,
  manifestFile: string,
  raw: unknown,
): FrozenAuthoringValidationResult {
  if (!isRecord(raw)) {
    if (raw !== undefined) report(ctx, "PPTD-E001", manifestFile, "", "design.yaml 必须是 YAML 映射");
    return { ok: false, diagnostics: ctx.diagnostics };
  }
  return validateYaml(raw, manifestFile, (rel) => {
    if (ctx.snapshot) return ctx.snapshot.get(rel);
    try { return new Uint8Array(readFileSync(path.resolve(ctx.projectRoot!, rel))); }
    catch { return undefined; }
  });
}
