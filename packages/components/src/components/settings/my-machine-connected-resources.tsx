import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Folder } from 'lucide-react';
import type { AgentConfigMeta, MachineId } from '@molly/shared';
import { useLocalProjectsAdmin } from '@/hooks/use-local-projects-admin';
import { Button } from '@/ui/button';

export type MachineConnectedProject = {
  key: string;
  name: string;
  rootPath: string;
};

type PresentedProject = MachineConnectedProject;

type MachineConnectedResourcesProps = {
  machineId: MachineId;
  configs: AgentConfigMeta[];
  preloadedProjects: MachineConnectedProject[];
  projectsLoading: boolean;
  readOnly?: boolean;
  onManageAgents: () => void;
};

/**
 * Keeps the already-loaded machine metadata visible while the heavier project
 * administration model catches up.
 */
export function MachineConnectedResources(props: MachineConnectedResourcesProps) {
  if (props.readOnly) {
    return (
      <MachineConnectedResourcesContent
        configs={props.configs}
        projects={props.preloadedProjects}
        projectsLoading={props.projectsLoading}
        readOnly
        onManageAgents={props.onManageAgents}
      />
    );
  }

  return <ManageableMachineConnectedResources {...props} />;
}

function ManageableMachineConnectedResources({
  machineId,
  configs,
  preloadedProjects,
  projectsLoading,
  onManageAgents,
}: MachineConnectedResourcesProps) {
  const { sections, isLoading } = useLocalProjectsAdmin();
  const adminProjects = useMemo(
    () => sections.find((section) => section.machineId === machineId)?.rows ?? [],
    [machineId, sections]
  );
  const projects: PresentedProject[] =
    adminProjects.length > 0
      ? adminProjects.map((row) => ({
          key: row.key,
          name: row.project.name,
          rootPath: row.project.rootPath,
        }))
      : preloadedProjects;

  return (
    <MachineConnectedResourcesContent
      configs={configs}
      projects={projects}
      projectsLoading={(isLoading || projectsLoading) && projects.length === 0}
      readOnly={false}
      onManageAgents={onManageAgents}
    />
  );
}

function MachineConnectedResourcesContent({
  configs,
  projects,
  projectsLoading,
  readOnly,
  onManageAgents,
}: {
  configs: AgentConfigMeta[];
  projects: PresentedProject[];
  projectsLoading: boolean;
  readOnly: boolean;
  onManageAgents: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-6 px-4 pb-4 pt-5">
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <Folder className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          <h3 className="text-xs font-semibold text-muted-foreground">
            {t('settings.machines.connectedFolders', 'Connected folders')}
          </h3>
        </div>
        {projectsLoading ? (
          <p className="text-xs text-muted-foreground">{t('common.loading', 'Loading...')}</p>
        ) : projects.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t('settings.machines.noConnectedFolders', 'No connected folders on this machine.')}
          </p>
        ) : (
          <div className="divide-y divide-border/50 rounded-lg border border-border/60">
            {projects.map((project) => {
              return (
                <div key={project.key} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{project.name}</div>
                    <div className="truncate font-mono text-[11px] text-muted-foreground">
                      {project.rootPath}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Bot className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            <h3 className="text-xs font-semibold text-muted-foreground">
              {t('settings.machines.connectedAgents', 'Connected agents')}
            </h3>
          </div>
          {!readOnly ? (
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onManageAgents}>
              {t('settings.machines.manageAgents', 'Manage in Agents')}
            </Button>
          ) : null}
        </div>
        {configs.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t('settings.machines.noConnectedAgents', 'No agents configured for this machine.')}
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {configs.map((config) => (
              <span
                key={config.id}
                className="rounded-md border border-border/60 bg-muted/30 px-2 py-1 text-xs"
              >
                {config.name}
              </span>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
