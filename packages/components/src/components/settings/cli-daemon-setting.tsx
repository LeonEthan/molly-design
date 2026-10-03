import { Loader2, MoreHorizontal, Play, RotateCcw, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ElectronCliState } from '@molly/shared';
import { cn } from '@/lib/utils';
import { Button } from '@/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { useElectronCliDaemon } from '@/hooks/use-electron-cli-daemon';
import { CompactRow } from './compact-layout';

const PHASE_TONE: Record<ElectronCliState['phase'], string> = {
  starting: 'bg-status-warning',
  running: 'bg-status-success',
  degraded: 'bg-status-warning',
  reconnecting: 'bg-status-warning',
  offline: 'bg-status-danger',
  fatal: 'bg-status-danger',
  stopping: 'bg-status-warning',
  stopped: 'bg-muted-foreground/50',
};

/**
 * "Background service" row for Settings → Advanced → System: shows the local CLI
 * daemon status with Restart up front and the rarely needed Terminate in the ⋯ menu.
 * Controls show in-place loading while their action is in flight.
 */
export function CliDaemonSetting() {
  const { t } = useTranslation();
  const { phase, isRestarting, isTerminating, restart, terminate } = useElectronCliDaemon();

  const phaseLabels: Record<ElectronCliState['phase'], string> = {
    starting: t('sidebar.cli.starting', 'Starting'),
    running: t('sidebar.cli.running', 'Running'),
    degraded: t('sidebar.cli.degraded', 'Degraded'),
    reconnecting: t('sidebar.cli.reconnecting', 'Reconnecting'),
    offline: t('sidebar.cli.offline', 'Offline'),
    fatal: t('sidebar.cli.fatal', 'Fatal'),
    stopping: t('sidebar.cli.stopping', 'Stopping'),
    stopped: t('sidebar.cli.stopped', 'Stopped'),
  };

  const busy = isRestarting || isTerminating;
  const isStopped = phase === 'stopped';

  return (
    <div id="cli-daemon" className="scroll-mt-24">
      <CompactRow
        label={t('settings.general.cliDaemon.label', 'Background service')}
        helper={t(
          'settings.general.cliDaemon.helper',
          "Powers Molly's design work on this computer. Restart it if Molly stops responding."
        )}
        alignTop
      >
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
            <span className={cn('h-1.5 w-1.5 rounded-full', PHASE_TONE[phase])} />
            {phaseLabels[phase]}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs"
            disabled={busy}
            onClick={() => void restart()}
          >
            {isRestarting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : isStopped ? (
              <Play className="h-3.5 w-3.5" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
            {isStopped ? t('sidebar.cli.start', 'Start') : t('sidebar.cli.restart', 'Restart')}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground"
                aria-label={t('settings.general.cliDaemon.moreActions')}
                disabled={busy || isStopped}
              >
                {isTerminating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <MoreHorizontal className="h-3.5 w-3.5" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                variant="destructive"
                icon={<Square className="h-3.5 w-3.5" />}
                onSelect={() => void terminate()}
              >
                {t('sidebar.cli.terminate', 'Terminate')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CompactRow>
    </div>
  );
}
