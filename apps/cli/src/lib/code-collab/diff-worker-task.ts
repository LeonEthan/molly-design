import { computeLineCounts } from './diff-line-counts';

export type DiffWorkerTaskInput = {
  readonly kind: 'line-count';
  readonly oldText: string | null;
  readonly newText: string | null;
};

export type DiffWorkerTaskResult = {
  readonly kind: 'line-count';
  readonly lineCounts: [number, number];
};

export async function runDiffWorkerTask(input: DiffWorkerTaskInput): Promise<DiffWorkerTaskResult> {
  return { kind: input.kind, lineCounts: computeLineCounts(input.oldText, input.newText) };
}
