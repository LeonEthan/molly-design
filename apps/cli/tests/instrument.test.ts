import { afterEach, expect, it, vi } from 'vitest';
import {
  captureException,
  captureMessage,
  flushTelemetry,
  isErrorReportingEnabled,
} from '../src/instrument';
import {
  captureCli,
  initCliAnalytics,
  isCliAnalyticsEnabled,
} from '../src/lib/analytics/posthog';

const originalFetch = globalThis.fetch;
const originalKey = process.env.MOLLY_POSTHOG_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.MOLLY_POSTHOG_KEY;
  else process.env.MOLLY_POSTHOG_KEY = originalKey;
});

it('does not send product telemetry even when an ambient PostHog key exists', async () => {
  const fetchSpy = vi.fn();
  globalThis.fetch = fetchSpy as typeof fetch;
  process.env.MOLLY_POSTHOG_KEY = 'ambient-test-key';

  initCliAnalytics();
  captureCli('session/started', { sessionId: 'synthetic' });
  await captureException(new Error('synthetic'));
  await captureMessage('synthetic');
  await flushTelemetry();

  expect(isCliAnalyticsEnabled()).toBe(false);
  expect(isErrorReportingEnabled()).toBe(false);
  expect(fetchSpy).not.toHaveBeenCalled();
});
