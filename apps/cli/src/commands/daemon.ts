import { Command } from 'commander';
import chalk from 'chalk';
import { fetchCliRuntimeState } from '@molly/cli-supervisor';
import {
  inspectLocalCliHost,
  type LocalCliHostRecord,
} from '@molly/shared/node/local-cli-host-lease';
import { version } from '@/pkg';
import { stopDaemonProcess } from './daemon-stop';
import { MOLLY_LOG_DIR, readPidFileRecord, spawnDaemonRunnerAndAwaitReady } from './daemon-shared';
import { flushTelemetry } from '@/instrument';
import { fetchLocalProbeHealth } from '@/lib/local-probe-health';
import { getCliPlatformKind } from '@/lib/cli-platform';
import { buildDaemonStartPassthroughArgs, type DaemonStartOptions } from './daemon-start-options';
import { formatDaemonConnectivityStatus } from './daemon-status-format';
import { readLatestLogTail } from '@/utils/log-files';

async function exitDaemonCommand(code: number): Promise<void> {
  process.exitCode = code;
  await flushTelemetry();
  process.exit(code);
}

type StartResult =
  | { status: 'started'; pid: number }
  | { status: 'missing_child_pid' }
  | { status: 'ownership_conflict'; pid: number; ownerMode?: string | undefined }
  | { status: 'startup_error'; pid: number; message: string }
  | { status: 'runner_exited'; pid: number }
  | { status: 'startup_timeout'; pid: number };

type StartReadinessResult =
  | { status: 'ready' }
  | { status: 'host_running'; host: LocalCliHostRecord }
  | { status: 'probe_running'; existingPid: number; phase: string };

async function checkDaemonStartReadiness(): Promise<StartReadinessResult> {
  const existingHost = await inspectLocalCliHost();
  if (existingHost) return { status: 'host_running', host: existingHost };

  const existingState = await fetchCliRuntimeState({ timeoutMs: 1000 });
  if (existingState) {
    return {
      status: 'probe_running',
      existingPid: existingState.pid,
      phase: existingState.phase,
    };
  }

  return { status: 'ready' };
}

async function startDaemonProcess(passthroughArgs: string[]): Promise<StartResult> {
  const result = await spawnDaemonRunnerAndAwaitReady(passthroughArgs);
  switch (result.status) {
    case 'ready':
      return { status: 'started', pid: result.pid };
    case 'occupied':
      return {
        status: 'ownership_conflict',
        pid: result.ownerPid ?? result.runnerPid,
        ownerMode: result.ownerMode,
      };
    case 'error':
      return { status: 'startup_error', pid: result.runnerPid, message: result.message };
    case 'missing_child_pid':
      return { status: 'missing_child_pid' };
    case 'runner_exited':
      return { status: 'runner_exited', pid: result.runnerPid };
    case 'timeout':
      return { status: 'startup_timeout', pid: result.runnerPid };
    default: {
      const unreachable: never = result;
      return unreachable;
    }
  }
}

function printStartTips(): void {
  console.log(`Use ${chalk.yellow('molly daemon status')} to check status`);
  console.log(`Use ${chalk.yellow('molly daemon stop')} to stop`);
  console.log(`Use ${chalk.yellow('molly daemon logs')} to view logs`);
}

// Prints the user-facing message for a blocked start (pid-file or probe already
// running) and exits non-zero. Returns true when it handled a blocked state, so
// the caller can bail; false means the daemon is clear to start.
async function reportDaemonStartBlocked(
  readiness: StartReadinessResult,
  opts: { restart: boolean }
): Promise<boolean> {
  if (readiness.status === 'host_running') {
    const subject = opts.restart ? 'Another daemon' : 'Daemon';
    console.log(
      `${subject} cannot start because the local agent Host is owned by ${readiness.host.mode} process ${readiness.host.pid}.`
    );
    await exitDaemonCommand(1);
    return true;
  }
  if (readiness.status === 'probe_running') {
    console.log(
      `A lody instance is already running on the probe port (PID ${readiness.existingPid}).`
    );
    console.log(`Stop it first, or use ${chalk.yellow('molly daemon status')} to check its state.`);
    await exitDaemonCommand(1);
    return true;
  }
  return false;
}

export const daemonCommand = new Command('daemon')
  .description('Run lody as a background daemon service')
  .addCommand(
    new Command('start')
      .description('Start molly daemon in the background')
      .option('--auth <credential>', 'Connect with a CLI API key or machine connection token')
      .option('--machine-name <name>', 'Machine name to register (defaults to hostname)')
      .allowUnknownOption(true)
      .action(async (options: DaemonStartOptions, cmd: Command) => {
        const readiness = await checkDaemonStartReadiness();
        if (await reportDaemonStartBlocked(readiness, { restart: false })) {
          return;
        }

        getCliPlatformKind();
        if (options.auth) {
          console.error('--auth is not available on the local platform.');
          await exitDaemonCommand(1);
          return;
        }
        const passthroughArgs = buildDaemonStartPassthroughArgs(options, cmd.args);
        const result = await startDaemonProcess(passthroughArgs);
        if (result.status === 'missing_child_pid') {
          console.error('Failed to start daemon process');
          await exitDaemonCommand(1);
          return;
        }
        if (result.status === 'ownership_conflict') {
          console.error(
            `Another local agent Host won the startup race (${result.ownerMode ?? 'unknown'} process ${result.pid}).`
          );
          await exitDaemonCommand(1);
          return;
        }
        if (result.status === 'startup_error') {
          console.error(`Daemon startup (runner PID ${result.pid}) failed: ${result.message}`);
          await exitDaemonCommand(1);
          return;
        }
        if (result.status === 'runner_exited') {
          console.error(`Daemon runner (PID ${result.pid}) exited before its worker became ready.`);
          await exitDaemonCommand(1);
          return;
        }
        if (result.status === 'startup_timeout') {
          console.error(`Daemon worker (PID ${result.pid}) did not become ready in time.`);
          await exitDaemonCommand(1);
          return;
        }
        console.log(`Daemon started (PID ${result.pid})`);
        printStartTips();
        await exitDaemonCommand(0);
        return;
      })
  )
  .addCommand(
    new Command('stop').description('Stop the running molly daemon').action(async () => {
      const result = await stopDaemonProcess();
      if (result.status === 'not_running') {
        console.log('No daemon PID file found. Daemon is not running.');
        await exitDaemonCommand(0);
        return;
      }
      if (result.status === 'stale_pid_file') {
        console.log(`Daemon ownership is absent; ignoring stale PID record ${result.pid}.`);
        await exitDaemonCommand(0);
        return;
      }
      if (result.status === 'stopped') {
        console.log(`Daemon (PID ${result.pid}) accepted the authenticated shutdown request.`);
        console.log('Daemon stopped successfully.');
        await exitDaemonCommand(0);
        return;
      }
      if (result.status === 'timeout') {
        console.log(
          `Daemon (PID ${result.pid}) is still running. You may need to kill it manually: ${chalk.yellow(`kill -9 ${result.pid}`)}`
        );
        await exitDaemonCommand(1);
        return;
      }
      if (result.status === 'host_mismatch') {
        console.error(
          `Refusing to stop: the local agent Host is owned by ${result.host.mode} process ${result.host.pid}, not the recorded daemon (PID ${result.pid}).`
        );
        await exitDaemonCommand(1);
        return;
      }
      console.error(`Failed to stop daemon: ${result.errorMessage}`);
      await exitDaemonCommand(1);
      return;
    })
  )
  .addCommand(
    new Command('status').description('Show daemon status').action(async () => {
      const host = await inspectLocalCliHost();
      const runtimeState = await fetchCliRuntimeState();
      const runtimeBelongsToDaemon =
        host?.mode === 'daemon' &&
        runtimeState?.supervisor?.instanceId === host.instanceId &&
        runtimeState.supervisor.pid === host.pid &&
        runtimeState.supervisor.launchMode === 'daemon';
      if (host?.mode === 'daemon') {
        console.log(chalk.green('● Daemon is running'));
        console.log(`  PID:          ${host.pid}`);
        console.log(`  Phase:        ${runtimeBelongsToDaemon ? runtimeState.phase : 'starting'}`);
        if (runtimeBelongsToDaemon && runtimeState.startupStage) {
          console.log(`  Stage:        ${runtimeState.startupStage}`);
        }
        if (runtimeBelongsToDaemon && runtimeState.connectivity) {
          console.log(
            `  Connectivity: ${formatDaemonConnectivityStatus(runtimeState.connectivity)}`
          );
        }
        if (runtimeBelongsToDaemon && runtimeState.machineId) {
          console.log(`  Machine ID:   ${runtimeState.machineId}`);
        }
        if (runtimeBelongsToDaemon && runtimeState.activeSessionCount !== undefined) {
          console.log(`  Sessions:     ${runtimeState.activeSessionCount}`);
        }
        if (runtimeBelongsToDaemon && runtimeState.connectedRoomCount !== undefined) {
          console.log(`  Rooms:        ${runtimeState.connectedRoomCount}`);
        }
        if (runtimeBelongsToDaemon && runtimeState.issues.length > 0) {
          console.log(`  Issues:`);
          for (const issue of runtimeState.issues) {
            console.log(`    - [${issue.severity}] ${issue.message}`);
          }
        }
        await exitDaemonCommand(0);
        return;
      }

      if (host) {
        console.log(chalk.red('● Daemon is not running'));
        console.log(`  Local agent Host: ${host.mode} process ${host.pid}`);
        await exitDaemonCommand(1);
        return;
      }

      if (runtimeState) {
        console.log(chalk.yellow('● Daemon Host is absent, but an orphan runtime is responding'));
        console.log(`  Runtime PID: ${runtimeState.pid}`);
        await exitDaemonCommand(1);
        return;
      }

      const pidRecord = readPidFileRecord();
      const pid = pidRecord?.pid ?? null;
      if (pid) {
        console.log(chalk.red('● Daemon is not running (stale PID file)'));
      } else {
        console.log(chalk.red('● Daemon is not running'));
      }
      await exitDaemonCommand(1);
      return;
    })
  )
  .addCommand(
    new Command('logs')
      .description('Show daemon logs')
      .option('-n, --lines <count>', 'number of lines to show', '50')
      .action(async (options: { lines: string }) => {
        const lineCount = parseInt(options.lines, 10) || 50;

        try {
          const tail = await readLatestLogTail(MOLLY_LOG_DIR, lineCount);
          if (!tail) {
            console.log(`No log files found in ${MOLLY_LOG_DIR}`);
            await exitDaemonCommand(1);
            return;
          }
          console.log(
            chalk.dim(`--- ${MOLLY_LOG_DIR}/${tail.files.join(', ')} (last ${lineCount} lines) ---`)
          );
          console.log(tail.text);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`Failed to read log file: ${message}`);
          await exitDaemonCommand(1);
          return;
        }
        await exitDaemonCommand(0);
        return;
      })
  )
  .addCommand(
    new Command('restart')
      .description('Restart the molly daemon (stop if running, then start)')
      .allowUnknownOption(true)
      .action(async (_options: unknown, cmd: Command) => {
        const passthroughArgs = cmd.args;
        const runningProbeHealth = await fetchLocalProbeHealth();
        const versionMismatchHealth =
          runningProbeHealth && runningProbeHealth.cliVersion !== version
            ? runningProbeHealth
            : null;
        if (versionMismatchHealth) {
          console.log(
            `Running daemon uses lody v${versionMismatchHealth.cliVersion}; current CLI is v${version}. Restarting with current CLI.`
          );
        }

        const stopResult = await stopDaemonProcess();
        if (stopResult.status === 'not_running') {
          console.log('No daemon was running.');
        } else if (stopResult.status === 'stale_pid_file') {
          console.log(`Daemon ownership was absent; ignored stale PID record ${stopResult.pid}.`);
        } else if (stopResult.status === 'stopped') {
          console.log(
            `Daemon (PID ${stopResult.pid}) accepted the authenticated shutdown request.`
          );
          console.log('Daemon stopped successfully.');
        } else if (stopResult.status === 'timeout') {
          console.log(
            `Daemon (PID ${stopResult.pid}) is still running. You may need to kill it manually: ${chalk.yellow(`kill -9 ${stopResult.pid}`)}`
          );
          await exitDaemonCommand(1);
          return;
        } else if (stopResult.status === 'host_mismatch') {
          console.error(
            `Refusing to stop: the local agent Host is owned by ${stopResult.host.mode} process ${stopResult.host.pid}, not the recorded daemon (PID ${stopResult.pid}).`
          );
          await exitDaemonCommand(1);
          return;
        } else {
          console.error(`Failed to stop daemon: ${stopResult.errorMessage}`);
          await exitDaemonCommand(1);
          return;
        }

        console.log('Starting daemon...');
        const readiness = await checkDaemonStartReadiness();
        if (await reportDaemonStartBlocked(readiness, { restart: true })) {
          return;
        }
        const startResult = await startDaemonProcess(passthroughArgs);
        if (startResult.status === 'missing_child_pid') {
          console.error('Failed to start daemon process');
          await exitDaemonCommand(1);
          return;
        }
        if (startResult.status === 'ownership_conflict') {
          console.error(
            `Another local agent Host won the startup race (${startResult.ownerMode ?? 'unknown'} process ${startResult.pid}).`
          );
          await exitDaemonCommand(1);
          return;
        }
        if (startResult.status === 'startup_error') {
          console.error(
            `Daemon startup (runner PID ${startResult.pid}) failed: ${startResult.message}`
          );
          await exitDaemonCommand(1);
          return;
        }
        if (startResult.status === 'runner_exited') {
          console.error(
            `Daemon runner (PID ${startResult.pid}) exited before its worker became ready.`
          );
          await exitDaemonCommand(1);
          return;
        }
        if (startResult.status === 'startup_timeout') {
          console.error(`Daemon worker (PID ${startResult.pid}) did not become ready in time.`);
          await exitDaemonCommand(1);
          return;
        }
        console.log(`Daemon started (PID ${startResult.pid})`);
        printStartTips();
        await exitDaemonCommand(0);
        return;
      })
  );
