import { normalizeFileDiff, type FileDiff } from '@molly/shared';

export type SessionDiffChangeEntry = {
  filePath: string;
  add?: number;
  del?: number;
};

export type SessionDiffSummary = {
  changeEntries: SessionDiffChangeEntry[];
  changeFilePaths: string[];
  diffFilePathsByTurn: Record<string, string[]>;
  diffEntriesByTurn: Record<string, SessionDiffChangeEntry[]>;
  fileDiffsByTurn: Record<string, FileDiff[]>;
};

type SessionHistoryDiffLike = {
  id: string;
  fileDiff?: unknown;
};

export const EMPTY_SESSION_DIFF_SUMMARY: SessionDiffSummary = {
  changeEntries: [],
  changeFilePaths: [],
  diffFilePathsByTurn: {},
  diffEntriesByTurn: {},
  fileDiffsByTurn: {},
};

export const areStringArraysEqual = (
  left: readonly string[],
  right: readonly string[]
): boolean => {
  if (left === right) {
    return true;
  }
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
};

const areChangeEntriesEqual = (
  left: SessionDiffChangeEntry[],
  right: SessionDiffChangeEntry[]
): boolean => {
  if (left === right) {
    return true;
  }
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    const leftEntry = left[index];
    const rightEntry = right[index];
    if (
      !leftEntry ||
      !rightEntry ||
      leftEntry.filePath !== rightEntry.filePath ||
      leftEntry.add !== rightEntry.add ||
      leftEntry.del !== rightEntry.del
    ) {
      return false;
    }
  }
  return true;
};

const areDiffFilePathsByTurnEqual = (
  left: Record<string, string[]>,
  right: Record<string, string[]>
): boolean => {
  if (left === right) {
    return true;
  }
  const leftKeys = Object.keys(left).toSorted();
  const rightKeys = Object.keys(right).toSorted();
  if (!areStringArraysEqual(leftKeys, rightKeys)) {
    return false;
  }
  for (const key of leftKeys) {
    const leftPaths = left[key];
    const rightPaths = right[key];
    if (!leftPaths || !rightPaths || !areStringArraysEqual(leftPaths, rightPaths)) {
      return false;
    }
  }
  return true;
};

const areDiffEntriesByTurnEqual = (
  left: Record<string, SessionDiffChangeEntry[]>,
  right: Record<string, SessionDiffChangeEntry[]>
): boolean => {
  if (left === right) {
    return true;
  }
  const leftKeys = Object.keys(left).toSorted();
  const rightKeys = Object.keys(right).toSorted();
  if (!areStringArraysEqual(leftKeys, rightKeys)) {
    return false;
  }
  for (const key of leftKeys) {
    const leftEntries = left[key];
    const rightEntries = right[key];
    if (!leftEntries || !rightEntries || !areChangeEntriesEqual(leftEntries, rightEntries)) {
      return false;
    }
  }
  return true;
};

const areFileDiffsByTurnEqual = (
  left: Record<string, FileDiff[]>,
  right: Record<string, FileDiff[]>
): boolean => {
  if (left === right) {
    return true;
  }
  const leftKeys = Object.keys(left).toSorted();
  const rightKeys = Object.keys(right).toSorted();
  if (!areStringArraysEqual(leftKeys, rightKeys)) {
    return false;
  }
  for (const key of leftKeys) {
    const leftDiffs = left[key];
    const rightDiffs = right[key];
    if (!leftDiffs || !rightDiffs || JSON.stringify(leftDiffs) !== JSON.stringify(rightDiffs)) {
      return false;
    }
  }
  return true;
};

export const areSessionDiffSummariesEqual = (
  left: SessionDiffSummary,
  right: SessionDiffSummary
): boolean =>
  areChangeEntriesEqual(left.changeEntries, right.changeEntries) &&
  areStringArraysEqual(left.changeFilePaths, right.changeFilePaths) &&
  areDiffFilePathsByTurnEqual(left.diffFilePathsByTurn, right.diffFilePathsByTurn) &&
  areDiffEntriesByTurnEqual(left.diffEntriesByTurn, right.diffEntriesByTurn) &&
  areFileDiffsByTurnEqual(left.fileDiffsByTurn, right.fileDiffsByTurn);

export const isSessionDiffSummaryEmpty = (summary: SessionDiffSummary): boolean =>
  summary.changeEntries.length === 0 &&
  Object.keys(summary.diffEntriesByTurn).length === 0 &&
  Object.keys(summary.fileDiffsByTurn).length === 0;

const sortChangeEntries = (entries: SessionDiffChangeEntry[]): SessionDiffChangeEntry[] =>
  entries.toSorted((left, right) => left.filePath.localeCompare(right.filePath));

export const buildSessionDiffSummary = (
  history: SessionHistoryDiffLike[] | null | undefined
): SessionDiffSummary => {
  const diffFilePathsByTurn: Record<string, string[]> = {};
  const diffEntriesByTurn: Record<string, SessionDiffChangeEntry[]> = {};
  const fileDiffsByTurn: Record<string, FileDiff[]> = {};

  if (history) {
    for (const entry of history) {
      const rawDiffs = entry.fileDiff;
      if (!Array.isArray(rawDiffs)) {
        continue;
      }

      const normalizedDiffs = rawDiffs.flatMap((rawDiff) => {
        const normalized = normalizeFileDiff(rawDiff);
        return normalized === undefined ? [] : [normalized];
      });
      if (normalizedDiffs.length > 0) {
        fileDiffsByTurn[entry.id] = normalizedDiffs;
      }

      const turnStatsByPath = new Map<string, { add: number; del: number }>();
      for (const fileDiff of normalizedDiffs) {
        const existing = turnStatsByPath.get(fileDiff.filePath);
        if (existing) {
          existing.add += fileDiff.add;
          existing.del += fileDiff.del;
        } else {
          turnStatsByPath.set(fileDiff.filePath, { add: fileDiff.add, del: fileDiff.del });
        }
      }

      if (turnStatsByPath.size > 0) {
        const turnEntries = sortChangeEntries(
          Array.from(turnStatsByPath.entries()).map(([filePath, stats]) => ({
            filePath,
            add: stats.add,
            del: stats.del,
          }))
        );
        diffEntriesByTurn[entry.id] = turnEntries;
        diffFilePathsByTurn[entry.id] = turnEntries.map((turnEntry) => turnEntry.filePath);
      }
    }
  }

  if (Object.keys(diffEntriesByTurn).length === 0 && Object.keys(fileDiffsByTurn).length === 0) {
    return EMPTY_SESSION_DIFF_SUMMARY;
  }

  return {
    changeEntries: [],
    changeFilePaths: [],
    diffFilePathsByTurn,
    diffEntriesByTurn,
    fileDiffsByTurn,
  };
};
