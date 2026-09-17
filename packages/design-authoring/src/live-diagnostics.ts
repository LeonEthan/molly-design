/**
 * Molly-facing diagnostic codes. Frozen vendored tables stay PPTD-E*; this
 * package maps them at the authoring boundary instead of forking vendor.
 */

import type {
  FrozenAuthoringValidationResult,
  FrozenDiagnostic,
  FrozenDiagnosticCode,
  ImportIssue,
  LiveDiagnostic,
  LiveDiagnosticCode,
  ValidationResult,
} from './contracts.ts';

const FROZEN_PREFIX = 'PPTD-';
export const LIVE_DIAGNOSTIC_PREFIX = 'MOLLY-';

export function liveDiagnosticCode(
  code: FrozenDiagnosticCode | LiveDiagnosticCode | string
): LiveDiagnosticCode {
  if (!code.startsWith(FROZEN_PREFIX)) return code as LiveDiagnosticCode;
  return `${LIVE_DIAGNOSTIC_PREFIX}${code.slice(FROZEN_PREFIX.length)}` as LiveDiagnosticCode;
}

export function liveDiagnostics(
  diagnostics: readonly FrozenDiagnostic[] | readonly LiveDiagnostic[]
): LiveDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    ...diagnostic,
    code: liveDiagnosticCode(diagnostic.code),
  }));
}

export function liveValidationResult(
  result: FrozenAuthoringValidationResult | ValidationResult
): ValidationResult {
  return { ...result, diagnostics: liveDiagnostics(result.diagnostics) };
}

export function liveImportIssues(issues: readonly ImportIssue[]): ImportIssue[] {
  return issues.map((issue) => ({ ...issue, code: liveDiagnosticCode(issue.code) }));
}
