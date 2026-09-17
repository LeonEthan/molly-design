import { afterEach, expect, it, vi } from 'vitest';
import { createCancellationDrain } from './cancellation-drain';
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
afterEach(() => vi.useRealTimers());
it('retains execution ownership after failed termination and releases only on a successful retry', async () => {
  vi.useFakeTimers();
  const raw = deferred();
  const exited = deferred();
  const signals: string[] = [];
  let denied = true;
  const drain = createCancellationDrain({
    pending: raw.promise,
    timeoutMs: 5000,
    terminate: async () => {
      if (denied) throw Error('denied');
      await exited.promise;
    },
    onFailure: () => {
      signals.push('retry-available');
    },
  });
  void drain.completion.then(() => signals.push('released'));
  await vi.advanceTimersByTimeAsync(5000);
  expect(signals).toEqual(['retry-available']);
  denied = false;
  const retry = drain.retry();
  await vi.advanceTimersByTimeAsync(60000);
  expect(signals).toEqual(['retry-available']);
  exited.resolve();
  expect(await retry).toBe(true);
  await drain.completion;
  expect(signals).toEqual(['retry-available', 'released']);
});
it('allows actual request completion to settle a failed stop without another termination', async () => {
  vi.useFakeTimers();
  const raw = deferred();
  const signals: string[] = [];
  const drain = createCancellationDrain({
    pending: raw.promise,
    timeoutMs: 5000,
    terminate: async () => {
      throw Error('denied');
    },
    onFailure: () => signals.push('failure'),
  });
  await vi.advanceTimersByTimeAsync(5000);
  raw.resolve();
  await drain.completion;
  expect(await drain.retry()).toBe(true);
  expect(signals).toEqual(['failure']);
});
