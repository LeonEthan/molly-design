import { UPDATE_CHECK_UNANSWERED, type ElectronUpdaterPhase } from '@molly/shared';

export { UPDATE_CHECK_UNANSWERED };

export type UpdaterCheckPresentation =
  | { kind: 'check' }
  | { kind: 'checking' }
  | { kind: 'up_to_date' }
  | { kind: 'downloading'; percent: number | null }
  | { kind: 'ready'; error: string | null }
  | { kind: 'error'; message: string };

export function shouldApplyUpdaterSnapshot(pushesSinceRequest: number): boolean {
  return pushesSinceRequest === 0;
}

function readPercent(percent: number | undefined): number | null {
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return null;
  return Math.round(Math.min(100, Math.max(0, percent)));
}

export function readUpdaterCheckPresentation(
  state: {
    phase: ElectronUpdaterPhase;
    percent?: number;
    error?: string;
  } | null
): UpdaterCheckPresentation | null {
  if (!state || state.phase === 'disabled') return null;
  switch (state.phase) {
    case 'checking':
      return { kind: 'checking' };
    case 'up_to_date':
      return { kind: 'up_to_date' };
    case 'downloading':
      return { kind: 'downloading', percent: readPercent(state.percent) };
    case 'downloaded':
      return { kind: 'ready', error: state.error?.trim() || null };
    case 'error':
      return { kind: 'error', message: state.error?.trim() || '' };
    default:
      return { kind: 'check' };
  }
}
