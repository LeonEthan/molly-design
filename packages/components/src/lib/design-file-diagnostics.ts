/** Redact credential-like strings and private paths from displayed diagnostics. */
const DESIGN_TEXT_PATH =
  /(^|[\s"'`(=,:;[\]])((?:\/(?:[\w.@+-]+(?:\s+(?=[\w.@+-]+[\\/])[\w.@+-]+)*\/)+[\w.@+-]*)|(?:[A-Za-z]:\\(?:[\w.@+-]+(?:\s+(?=[\w.@+-]+[\\/])[\w.@+-]+)*\\)*[\w.@+-]*))/g;
const DESIGN_TEXT_CREDENTIAL =
  /(?:\b(?:sk|pk|ghp|gho|ghs|ghr|github_pat|xox[abprs])[-_][A-Za-z0-9_-]{8,}|\bBearer\s+[A-Za-z0-9._-]{8,}|\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|secret|password|authorization)\b\s*[:=]\s*(?:(?:Bearer|Basic|Token)\s+)?\S+)/gi;

export const redactDesignText = (text: string): string =>
  text.replace(DESIGN_TEXT_PATH, '$1[path]').replace(DESIGN_TEXT_CREDENTIAL, '[redacted]');
