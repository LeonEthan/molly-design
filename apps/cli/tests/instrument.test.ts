import { afterEach, expect, it } from 'vitest';
import {
  captureException,
  captureMessage,
  flushTelemetry,
  isErrorReportingEnabled,
} from '../src/instrument';

const originalFetch = globalThis.fetch;
const originalKey = process.env.MOLLY_POSTHOG_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.MOLLY_POSTHOG_KEY;
  else process.env.MOLLY_POSTHOG_KEY = originalKey;
});

it('does not send product telemetry even when an ambient PostHog key exists', async () => {
  const requests: unknown[] = [];
  globalThis.fetch = async (...args) => {
    requests.push(args);
    throw new Error('Unexpected product telemetry request');
  };
  process.env.MOLLY_POSTHOG_KEY = 'ambient-test-key';

  await captureException(new Error('synthetic'));
  await captureMessage('synthetic');
  await flushTelemetry();

  expect(isErrorReportingEnabled()).toBe(false);
  expect(requests).toEqual([]);
});
