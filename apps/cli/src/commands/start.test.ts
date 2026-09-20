import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStartShutdownController } from './start-shutdown';
import type { Logger } from '@/utils/logger';

function createTestLogger(): Logger {
  let logger: Logger;
  logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
    setLevel: vi.fn(),
    setDebug: vi.fn(),
    child: vi.fn(() => logger),
    close: vi.fn(async () => {}),
  };
  return logger;
}

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolvePromise: (() => void) | null = null;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve: () => {
      resolvePromise?.();
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('start command embedded-only options', () => {
  it('rejects the retired CLI selector before starting the service', async () => {
    const { startCommand } = await import('./start');
    const stderr: string[] = [];
    startCommand.exitOverride().configureOutput({ writeErr: (text) => stderr.push(text) });
    await expect(
      startCommand.parseAsync(['--cli-types', 'codex'], { from: 'user' })
    ).rejects.toMatchObject({ code: 'commander.unknownOption' });
    expect(stderr.join('')).toContain('--cli-types');
    expect(startCommand.helpInformation()).not.toContain('--cli-types');
  });
});

describe('start shutdown controller', () => {
  it('exits with 0 after graceful shutdown completes', async () => {
    const logger = createTestLogger();
    const exits: number[] = [];
    let cleanedUp = false;
    let telemetryFlushed = false;

    const controller = createStartShutdownController({
      signals: ['SIGINT'],
      logger,
      shutdown: async () => {
        cleanedUp = true;
      },
      flushTelemetry: async () => {
        telemetryFlushed = true;
      },
      exit: (code) => {
        exits.push(code);
      },
      timeoutMs: 1_000,
    });

    await controller.shutdown('SIGINT');

    expect(cleanedUp).toBe(true);
    expect(telemetryFlushed).toBe(true);
    expect(exits).toEqual([0]);
    expect(logger.info).toHaveBeenCalledWith('\nReceived SIGINT, shutting down gracefully...');
  });

  it('preserves explicit lifecycle exit code after graceful shutdown', async () => {
    const logger = createTestLogger();
    const exits: number[] = [];

    const controller = createStartShutdownController({
      signals: ['SIGINT'],
      logger,
      shutdown: async () => {},
      flushTelemetry: async () => {},
      exit: (code) => {
        exits.push(code);
      },
      timeoutMs: 1_000,
    });

    await controller.shutdown({ exitCode: 43, reason: 'machine upgrade requested' });

    expect(exits).toEqual([43]);
    expect(logger.info).toHaveBeenCalledWith(
      '\nShutting down gracefully (machine upgrade requested)...'
    );
  });

  it('forces exit on a repeated signal while shutdown is still pending', async () => {
    const logger = createTestLogger();
    const exits: number[] = [];
    const cleanup = createDeferred();

    const controller = createStartShutdownController({
      signals: ['SIGINT'],
      logger,
      shutdown: () => cleanup.promise,
      flushTelemetry: async () => {},
      exit: (code) => {
        exits.push(code);
      },
      timeoutMs: 1_000,
    });

    const firstShutdown = controller.shutdown('SIGINT');
    await Promise.resolve();

    await controller.shutdown('SIGINT');

    expect(exits).toEqual([130]);
    expect(logger.warn).toHaveBeenCalledWith(
      'Received SIGINT while shutdown is still in progress; forcing exit...'
    );

    cleanup.resolve();
    await firstShutdown;

    expect(exits).toEqual([130]);
  });

  it('forces exit when graceful shutdown exceeds the timeout', async () => {
    vi.useFakeTimers();

    const logger = createTestLogger();
    const exits: number[] = [];
    const cleanup = createDeferred();

    const controller = createStartShutdownController({
      signals: ['SIGINT'],
      logger,
      shutdown: () => cleanup.promise,
      flushTelemetry: async () => {},
      exit: (code) => {
        exits.push(code);
      },
      timeoutMs: 1_000,
    });

    const shutdownPromise = controller.shutdown('SIGINT');
    await vi.advanceTimersByTimeAsync(1_000);

    expect(exits).toEqual([130]);
    expect(logger.warn).toHaveBeenCalledWith(
      'Graceful shutdown did not finish within 1000ms; forcing exit...'
    );

    cleanup.resolve();
    await shutdownPromise;

    expect(exits).toEqual([130]);
  });
});
