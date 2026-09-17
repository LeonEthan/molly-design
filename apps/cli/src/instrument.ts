import { flushCliAnalytics } from './lib/analytics/posthog';

export { flushCliAnalytics };

// OSS Molly does not report diagnostics to a product service.
export async function flushErrorReporting(_timeoutMs?: number): Promise<void> {}

export async function flushTelemetry(timeoutMs?: number): Promise<void> {
  await Promise.all([flushErrorReporting(timeoutMs), flushCliAnalytics(timeoutMs)]);
}

export function captureException(
  _error: unknown,
  _context?: { component?: string; extra?: Record<string, unknown> }
): Promise<void> {
  return Promise.resolve();
}

export function captureMessage(
  _message: string,
  _context?: { component?: string; level?: 'info' | 'warning' | 'error'; extra?: Record<string, unknown> }
): Promise<void> {
  return Promise.resolve();
}

export function isErrorReportingEnabled(): boolean {
  return false;
}
