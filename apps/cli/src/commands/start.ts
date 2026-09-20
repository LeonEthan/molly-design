import { Command } from 'commander';
import chalk from 'chalk';
import os from 'os';
import { randomUUID } from 'node:crypto';
import { version } from '@/pkg';
import { Logger, createHybridLogger, getLogger } from '../utils/logger';
import { registerProcessCleanup, reportError, unregisterProcessCleanup } from '../utils/telemetry';
import { MollyFleet } from '@/lib/molly-fleet';
import { MachineId } from '@molly/shared';
import { CliRuntimeStateReporter } from '@/lib/cli-runtime-state';
import { formatErrorMessage } from '@/utils/format-error';
import { createStartShutdownController } from './start-shutdown';
import { getOrCreateStableMachineIdAsync } from '@/utils/const';
import {
  applyLocalPlatformEnv,
  getCliPlatformKind,
  loadOrCreateLocalIdentity,
  migrateLegacyLocalDataDir,
} from '@/lib/cli-platform';
import { normalizeCurrentProcessResourceProfile } from '@/utils/process-resource-profile';
import { startEventLoopLagMonitor } from '@/utils/event-loop-lag-monitor';
import { flushTelemetry } from '@/instrument';
import { getRuntimeDiagnostics } from '@/utils/runtime-diagnostics';
import {
  EXIT_CODE_SUPERVISOR_CONTRACT_MISMATCH,
  type MachineProcessLifecycleAction,
  resolveMachineLifecycleCapability,
} from '@/lib/machine-lifecycle';
import {
  type LocalSupervisorIdentity,
  registerLocalSupervisorControl,
  resolveLocalSupervisorIdentity,
  scrubLocalSupervisorCapabilityEnv,
  toRuntimeSupervisorIdentity,
} from '@/lib/local-supervisor-control';
import {
  acquireLocalCliHostLease,
  type LocalCliHostLease,
} from '@molly/shared/node/local-cli-host-lease';
import { traceAsync } from '@/utils/trace-span';
import {
  captureAgentServiceEvent,
  captureCliActivePing,
  captureCliActiveUser,
  ACTIVE_PING_MIN_INTERVAL_MS,
} from './analytics-events';
import { createLocalCloudPort } from '@molly/platform';

interface StartOptions {
  debug?: boolean;
  machineName?: string;
  heartbeatLog?: boolean;
}

const EXIT_CODE_ALREADY_RUNNING = 3;

/**
 * 统一的 start 命令
 */
export const startCommand = new Command('start')
  .description('Start agent service in native mode')
  .option('--machine-name <name>', 'Machine name to register (defaults to hostname)')
  .option('--debug', 'enable debug output')
  .option('--heartbeat-log', 'output current timestamp every 5 seconds')
  .action(async (options: StartOptions) => {
    createHybridLogger({ level: options.debug ? 'debug' : 'info' });
    const logger = getLogger('start');
    const commandActionStartedAt = Date.now();
    logger.debug(
      `[startup] Start action entered processUptimeMs=${Math.round(process.uptime() * 1_000)}`
    );
    const identityResolution = resolveLocalSupervisorIdentity();
    if (identityResolution.status === 'invalid') {
      logger.error(
        `Refusing supervised start: ${identityResolution.reason}. Restart the supervising host with a matching lody release.`
      );
      process.exit(EXIT_CODE_SUPERVISOR_CONTRACT_MISMATCH);
    }
    const supervisorIdentity =
      identityResolution.status === 'supervised' ? identityResolution.identity : null;
    const machineLifecycleCapability = resolveMachineLifecycleCapability(
      supervisorIdentity?.launchMode
    );
    const unregisterStartupSupervisorControl = registerLocalSupervisorControl({
      identity: supervisorIdentity,
      logger,
      shutdown: () => process.exit(0),
    });
    scrubLocalSupervisorCapabilityEnv();
    await traceAsync(logger, 'startup.process_resource_profile', undefined, async () =>
      normalizeCurrentProcessResourceProfile(logger)
    );
    for (const diagnostic of getRuntimeDiagnostics(version)) {
      logger.info(diagnostic);
    }

    if (options.heartbeatLog) {
      logger.info('Heartbeat log mode enabled. Press Ctrl+C to stop.');
      const interval = setInterval(() => {
        logger.info(`heartbeat: ${new Date().toISOString()}`);
      }, 5000);

      const stopHeartbeat = () => {
        clearInterval(interval);
        process.exit(0);
      };
      process.on('SIGINT', stopHeartbeat);
      process.on('SIGTERM', stopHeartbeat);

      await new Promise<void>(() => {});
      return;
    }

    let foregroundHostLease: LocalCliHostLease | null = null;
    if (!supervisorIdentity) {
      const leaseResult = await acquireLocalCliHostLease({
        instanceId: randomUUID(),
        mode: 'foreground',
      });
      if (leaseResult.status === 'occupied') {
        const owner = leaseResult.record
          ? `${leaseResult.record.mode} process ${leaseResult.record.pid}`
          : 'another local CLI host';
        logger.error(`Cannot start: ${owner} already owns the local agent runtime.`);
        process.exit(EXIT_CODE_ALREADY_RUNNING);
      }
      foregroundHostLease = leaseResult.lease;
    }

    try {
      getCliPlatformKind();
    } catch (error) {
      logger.error(formatErrorMessage(error));
      process.exit(1);
    }
    applyLocalPlatformEnv();
    await migrateLegacyLocalDataDir(logger);
    logger.info('Starting in local platform mode (no account, no cloud services).');

    const machineNameOverride = options.machineName?.trim();
    const defaultMachineName = machineNameOverride || os.hostname();
    const runtimeStateReporter = new CliRuntimeStateReporter({
      supervisor: toRuntimeSupervisorIdentity(supervisorIdentity),
      trackBackendConnectionAge: false,
    });
    runtimeStateReporter.setStartupStage('bootstrap');

    runtimeStateReporter.setStartupStage('auth');
    const localIdentity = await loadOrCreateLocalIdentity(logger);
    const token = '';
    const userId = localIdentity.userId;
    const machineId = await getOrCreateStableMachineIdAsync();
    const machineName = defaultMachineName;
    const authMethod = 'local_platform';

    runtimeStateReporter.setMachineId(machineId as MachineId);
    logger.debug(
      `[startup] Authentication ready method=${authMethod} actionDurationMs=${
        Date.now() - commandActionStartedAt
      }`
    );

    try {
      await startAgentService(
        options,
        token,
        userId,
        machineName,
        machineId,
        logger,
        runtimeStateReporter,
        authMethod,
        foregroundHostLease,
        supervisorIdentity,
        machineLifecycleCapability,
        unregisterStartupSupervisorControl
      );
    } catch (error) {
      captureAgentServiceEvent('agent_service_startup_failed', {
        failure_stage: runtimeStateReporter.snapshot().startupStage ?? 'unknown',
      });
      runtimeStateReporter.upsertIssue({
        code: 'service_start_failed',
        severity: 'fatal',
        recoverable: false,
        message: formatErrorMessage(error),
      });
      await reportError('start', error, {
        message: 'Service error',
        logger,
      });
      await flushTelemetry();
      process.exit(1);
    }
  });

/**
 * 启动代理服务（前台模式）
 */
async function startAgentService(
  options: StartOptions,
  token: string,
  userId: string,
  machineName: string,
  machineId: string,
  logger: Logger,
  runtimeStateReporter: CliRuntimeStateReporter,
  authMethod: 'local_platform',
  foregroundHostLease: LocalCliHostLease | null,
  supervisorIdentity: LocalSupervisorIdentity | null,
  machineLifecycleCapability: ReturnType<typeof resolveMachineLifecycleCapability>,
  unregisterStartupSupervisorControl: () => void
): Promise<void> {
  // The startup listener protects authentication/bootstrap. From this point to
  // the graceful controller registration below there is no async yield.
  unregisterStartupSupervisorControl();
  logger.info(`Starting agent service...`);

  // `app/active` distinct_id is the machine_id (non-PII) for cross-client DAU.
  const serviceStartMs = Date.now();
  let activePingTimer: ReturnType<typeof setInterval> | null = null;
  const stopActivePing = () => {
    if (activePingTimer) {
      clearInterval(activePingTimer);
      activePingTimer = null;
    }
  };

  const startupStartMs = Date.now();
  logger.debug('Initializing workspace fleet...');
  runtimeStateReporter.setStartupStage('fleet-start');

  let processLifecycleTriggered = false;
  let triggerProcessLifecycleAction: ((action: MachineProcessLifecycleAction) => void) | null =
    null;

  const cloudPort = createLocalCloudPort({
    identity: { userId },
    workspaces: [],
    runtimeArtifactsBaseUrl:
      process.env.MOLLY_RUNTIME_BASE_URL ?? process.env.LODY_RUNTIME_BASE_URL,
  });

  let fleet: MollyFleet;
  try {
    fleet = new MollyFleet({
      logger,
      cliToken: token,
      userId,
      machineId: machineId as MachineId,
      machineName,
      runtimeStateReporter,
      cloudPort,
      machineLifecycleCapability,
      onProcessLifecycleAction: (action) => triggerProcessLifecycleAction?.(action),
    });
  } catch (error) {
    await cloudPort.dispose();
    throw error;
  }
  const eventLoopLagMonitor = startEventLoopLagMonitor(logger, { label: 'molly start' });
  const closeForegroundHostLease = async () => {
    const lease = foregroundHostLease;
    foregroundHostLease = null;
    await lease?.close();
  };
  registerProcessCleanup(async () => {
    eventLoopLagMonitor.stop();
    await fleet.shutdown();
    await closeForegroundHostLease();
  });
  const shutdownSignals: NodeJS.Signals[] =
    process.platform === 'win32'
      ? ['SIGINT', 'SIGTERM', 'SIGBREAK']
      : ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT'];
  let unregisterSupervisorControl = () => {};

  const shutdownController = createStartShutdownController({
    signals: shutdownSignals,
    logger,
    shutdown: async () => {
      unregisterSupervisorControl();
      unregisterProcessCleanup();
      stopActivePing();
      eventLoopLagMonitor.stop();
      await fleet.shutdown();
      await closeForegroundHostLease();
    },
    flushTelemetry: async () => {
      captureAgentServiceEvent('agent_service_shutdown', {
        uptime_ms: Date.now() - serviceStartMs,
        auth_method: authMethod,
      });
      await flushTelemetry();
    },
    exit: (code) => process.exit(code),
  });
  shutdownController.register();
  unregisterSupervisorControl = registerLocalSupervisorControl({
    identity: supervisorIdentity,
    logger,
    shutdown: (reason) => {
      void shutdownController.shutdown({ reason });
    },
  });

  triggerProcessLifecycleAction = (action) => {
    if (processLifecycleTriggered) return;
    processLifecycleTriggered = true;
    logger.info(
      `Machine lifecycle ${action.action} requested; shutting down worker with exit code ${action.exitCode}.`
    );
    void shutdownController.shutdown({
      exitCode: action.exitCode,
      reason: `machine ${action.action} requested`,
    });
  };

  try {
    logger.debug('Subscribing to workspaces and connecting agent runtimes...');
    const connectStartMs = Date.now();
    await fleet.start();
    logger.debug(`Workspace fleet started (${Date.now() - connectStartMs}ms)`);
    logger.debug(`Agent startup completed in ${Date.now() - startupStartMs}ms`);

    const startupSnapshot = runtimeStateReporter.snapshot();
    captureAgentServiceEvent('agent_service_started', {
      auth_method: authMethod,
      // Best-effort: the workspace subscription may still be populating right
      // after fleet.start(); connected rooms approximate workspace count.
      workspace_count: startupSnapshot.connectedRoomCount,
      startup_duration_ms: Date.now() - startupStartMs,
    });
    captureCliActiveUser({ auth_method: authMethod });

    // app/active_ping: emit while the service is doing work (>=1 active
    // session). >=60s interval (tier C), idle-stop (skipped when no active
    // session) so an idle daemon does not generate a steady ping stream.
    activePingTimer = setInterval(() => {
      const snapshot = runtimeStateReporter.snapshot();
      if ((snapshot.activeSessionCount ?? 0) <= 0) return;
      captureCliActivePing({
        active_context: 'cli_agent_service',
        active_session_count: snapshot.activeSessionCount,
        connected_room_count: snapshot.connectedRoomCount,
      });
    }, ACTIVE_PING_MIN_INTERVAL_MS);
    activePingTimer.unref?.();

    logger.success('✨ Local agent service is ready. Open Molly to create.');
    logger.info(`Press ${chalk.yellow('Ctrl+C')} to stop`);

    // 保持进程活跃
    await new Promise<void>(() => {});
  } catch (error) {
    unregisterSupervisorControl();
    runtimeStateReporter.upsertIssue({
      code: 'agent_service_failed',
      severity: 'fatal',
      recoverable: false,
      message: formatErrorMessage(error),
    });
    shutdownController.unregister();
    unregisterProcessCleanup();
    stopActivePing();
    eventLoopLagMonitor.stop();
    await fleet.shutdown().catch((err: unknown) => {
      logger.error('Cleanup failed:', err);
    });
    await closeForegroundHostLease();
    await reportError('start:agent', error, {
      message: 'Agent service failed to start',
      logger,
    });
    throw error;
  }
}
