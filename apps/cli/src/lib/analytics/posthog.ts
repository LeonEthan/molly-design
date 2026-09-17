import type { AnalyticsSamplingTier } from '@molly/shared';

// Public Molly has no product telemetry. Keep this small interface for
// local callers that record optional diagnostic events without network I/O.
export function initCliAnalytics(_opts?: { distinctId?: string; release?: string }): void {}

export function isCliAnalyticsEnabled(): boolean {
  return false;
}

export function captureCli(
  _eventName: string,
  _properties?: Record<string, unknown>,
  _opts?: { tier?: AnalyticsSamplingTier; sampleRate?: number; distinctId?: string }
): void {}

export async function flushCliAnalytics(_timeoutMs?: number): Promise<void> {}
