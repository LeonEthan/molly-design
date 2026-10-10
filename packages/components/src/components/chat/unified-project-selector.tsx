import { useDeferredValue, useMemo, useRef, useState, type ReactNode } from 'react';
import type { LocalProjectId, MachineId } from '@molly/shared';
import { Check, CircleSlash2, FolderOpen, FolderPlus, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useVisibleLocalProjects } from '@/hooks/use-visible-local-projects';
import type { VisibleLocalProjectIndex } from '@/lib/visible-local-project-index';
import { cn } from '@/lib/utils';
import { ChevronDown } from '@/ui/icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { Input } from '@/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip';

export interface LocalProjectSelection {
  machineId: MachineId;
  localProjectId: LocalProjectId;
}

export type UnifiedProjectSelection =
  | { kind: 'none' }
  | ({ kind: 'local' } & LocalProjectSelection);

type UnifiedProjectOption = {
  value: string;
  label: string;
  description?: string;
  icon: ReactNode;
  selection: Exclude<UnifiedProjectSelection, { kind: 'none' }>;
  lastUsedAt?: number;
};

export const UNIFIED_PROJECT_OPTION_RENDER_LIMIT = 20;

export type UnifiedLocalProjectOption = {
  key: string;
  machineId: MachineId;
  localProjectId: LocalProjectId;
  name: string;
  rootPath: string;
  lastUsedAt?: number;
};

export function compareUnifiedProjectOptions(
  left: Pick<UnifiedProjectOption, 'label' | 'value' | 'lastUsedAt'>,
  right: Pick<UnifiedProjectOption, 'label' | 'value' | 'lastUsedAt'>
): number {
  if (left.lastUsedAt !== undefined && right.lastUsedAt !== undefined) {
    if (left.lastUsedAt !== right.lastUsedAt) return right.lastUsedAt - left.lastUsedAt;
  } else if (left.lastUsedAt !== undefined) {
    return -1;
  } else if (right.lastUsedAt !== undefined) {
    return 1;
  }
  const labelComparison = left.label.localeCompare(right.label);
  return labelComparison !== 0 ? labelComparison : left.value.localeCompare(right.value);
}

function selectUnifiedProjectOptionsForRender<
  TOption extends Pick<UnifiedProjectOption, 'label' | 'description' | 'selection'>,
>(options: readonly TOption[], query: string, limit?: number): TOption[] {
  if (limit !== undefined && limit <= 0) return [];
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visible: TOption[] = [];
  for (const option of options) {
    if (
      normalizedQuery &&
      !`${option.label} ${option.description ?? ''} ${option.selection.kind}`
        .toLocaleLowerCase()
        .includes(normalizedQuery)
    ) {
      continue;
    }
    visible.push(option);
  }
  if (limit === undefined || visible.length <= limit) return visible;

  return visible.slice(0, limit);
}

interface UnifiedProjectSelectorProps {
  value: UnifiedProjectSelection;
  onChange: (selection: UnifiedProjectSelection) => void;
  selectedMachineId: MachineId | null;
  className?: string;
  latestMessageAtByLocalProject?: ReadonlyMap<string, number>;
  onAddLocalProject: () => void;
}

export function buildUnifiedLocalProjectOptions({
  visibleLocalProjects,
  selectedMachineId,
  latestMessageAtByLocalProject,
}: {
  visibleLocalProjects: Pick<VisibleLocalProjectIndex, 'projects'>;
  selectedMachineId: MachineId | null;
  latestMessageAtByLocalProject?: ReadonlyMap<string, number>;
}): UnifiedLocalProjectOption[] {
  const visible: UnifiedLocalProjectOption[] = [];
  for (const entry of visibleLocalProjects.projects.values()) {
    if (entry.machineId !== selectedMachineId) continue;
    visible.push({
      key: entry.key,
      machineId: entry.machineId,
      localProjectId: entry.project.id,
      name: entry.project.name,
      rootPath: entry.project.rootPath,
      lastUsedAt:
        latestMessageAtByLocalProject?.get(entry.key) ??
        entry.project.lastOpenedAtMs ??
        entry.project.createdAtMs ??
        undefined,
    });
  }
  return visible;
}

export interface UnifiedProjectSelectorViewProps extends Omit<
  UnifiedProjectSelectorProps,
  'selectedMachineId' | 'latestMessageAtByLocalProject'
> {
  localProjects: ReadonlyArray<UnifiedLocalProjectOption>;
  /**
   * Where the menu opens relative to the trigger. Chat landing keeps `top`
   * (footer chrome); task surfaces open `bottom` so the list falls into the
   * page rather than covering the property rail above.
   */
  contentSide?: 'top' | 'bottom';
  /**
   * `chip` — compact pill used on chat landing.
   * `property-row` — full-width ghost row matching Linear-style property rails
   * (task detail sidebar). Same searchable menu either way.
   */
  triggerVariant?: 'chip' | 'property-row';
  /** Extra classes for the portaled menu (e.g. Tasks cooler menu surface). */
  contentClassName?: string;
  contentStyle?: React.CSSProperties;
  /**
   * Maximum rendered options. The default view reserves a slot for every
   * available source, while search still evaluates the complete option list.
   */
  renderLimit?: number;
}

function getSelectionValue(selection: UnifiedProjectSelection): string | null {
  switch (selection.kind) {
    case 'local':
      return `local:${selection.machineId}:${selection.localProjectId}`;
    case 'none':
      return null;
  }
  return null;
}

export function UnifiedProjectSelector({
  value,
  onChange,
  selectedMachineId,
  className,
  latestMessageAtByLocalProject,
  onAddLocalProject,
}: UnifiedProjectSelectorProps) {
  const visibleLocalProjects = useVisibleLocalProjects();
  const localProjects = useMemo(
    () =>
      buildUnifiedLocalProjectOptions({
        visibleLocalProjects,
        selectedMachineId,
        latestMessageAtByLocalProject,
      }),
    [latestMessageAtByLocalProject, selectedMachineId, visibleLocalProjects]
  );

  return (
    <UnifiedProjectSelectorView
      value={value}
      onChange={onChange}
      localProjects={localProjects}
      className={className}
      onAddLocalProject={onAddLocalProject}
    />
  );
}

export function UnifiedProjectSelectorView({
  value,
  onChange,
  localProjects,
  className,
  onAddLocalProject,
  contentSide = 'top',
  triggerVariant = 'chip',
  contentClassName,
  contentStyle,
  renderLimit,
}: UnifiedProjectSelectorViewProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const options = useMemo<UnifiedProjectOption[]>(() => {
    const combined: UnifiedProjectOption[] = [];
    for (const project of localProjects) {
      combined.push({
        value: `local:${project.machineId}:${project.localProjectId}`,
        label: project.name,
        description: project.rootPath,
        icon: <FolderOpen className="h-4 w-4 shrink-0 opacity-70" />,
        selection: {
          kind: 'local',
          machineId: project.machineId,
          localProjectId: project.localProjectId,
        },
        lastUsedAt: project.lastUsedAt,
      });
    }
    return combined.sort(compareUnifiedProjectOptions);
  }, [localProjects]);

  const selectedValue = getSelectionValue(value);
  const selectedOption = useMemo(
    () => options.find((option) => option.value === selectedValue),
    [options, selectedValue]
  );
  const filteredOptions = useMemo(() => {
    return selectUnifiedProjectOptionsForRender(options, deferredQuery, renderLimit);
  }, [deferredQuery, options, renderLimit]);

  const clearLabel = t('chat.projectPicker.clear', 'No project');
  const placeholder = t('chat.projectPicker.placeholder', 'Choose a project');
  const triggerIcon = selectedOption?.icon ?? <FolderOpen className="h-4 w-4 opacity-70" />;
  const triggerLabel =
    selectedOption?.label ?? (value.kind === 'local' ? value.localProjectId : placeholder);

  const isPropertyRow = triggerVariant === 'property-row';

  return (
    <div
      className={cn('group/project relative flex min-w-0 items-center', isPropertyRow && 'w-full')}
    >
      {value.kind !== 'none' && !isPropertyRow ? (
        <button
          type="button"
          onClick={() => {
            onChange({ kind: 'none' });
            setOpen(false);
          }}
          aria-label={clearLabel}
          className={cn(
            'absolute left-2 z-10 flex h-4 w-4 items-center justify-center rounded-full',
            'text-muted-foreground opacity-0 transition-opacity hover:bg-hover hover:text-foreground',
            'group-hover/project:opacity-100 group-focus-within/project:opacity-100'
          )}
        >
          <X className="h-3 w-3" />
        </button>
      ) : null}
      <DropdownMenu
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (nextOpen) {
            requestAnimationFrame(() => searchInputRef.current?.focus());
          } else {
            setQuery('');
          }
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              isPropertyRow
                ? [
                    'flex h-8 w-full min-w-0 max-w-none items-center gap-2 rounded-md px-2',
                    'text-[13px] font-normal transition-colors',
                    'bg-transparent text-foreground hover:bg-hover',
                    'data-[state=open]:bg-hover',
                    '[&_svg]:text-current [&_svg]:opacity-70',
                    value.kind === 'none' && 'text-muted-foreground',
                  ]
                : [
                    'flex h-6 min-w-0 max-w-[18rem] items-center gap-1.5 rounded-md bg-input/60 px-2 dark:bg-foreground/[0.08]',
                    'text-xs font-normal text-foreground/80 transition-colors hover:bg-input hover:text-foreground dark:hover:bg-foreground/[0.12] [&_svg]:text-current [&_svg]:opacity-100',
                    'data-[state=open]:bg-input data-[state=open]:text-foreground dark:data-[state=open]:bg-foreground/[0.12]',
                  ],
              className
            )}
          >
            <span
              className={cn(
                'flex h-4 w-4 shrink-0 items-center justify-center',
                !isPropertyRow &&
                  value.kind !== 'none' &&
                  'transition-opacity group-hover/project:opacity-0 group-focus-within/project:opacity-0'
              )}
            >
              {triggerIcon}
            </span>
            <span className="min-w-0 flex-1 truncate text-left">{triggerLabel}</span>
            {isPropertyRow ? null : <ChevronDown aria-hidden className="size-3 shrink-0" />}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side={contentSide}
          align="start"
          avoidCollisions={contentSide === 'bottom'}
          className={cn('w-[min(20rem,calc(100vw-2rem))]', contentClassName)}
          style={contentStyle}
        >
          <div className="relative mb-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Escape') event.stopPropagation();
              }}
              placeholder={t('chat.projectPicker.searchPlaceholder', 'Search projects')}
              className="h-8 border-border/50 bg-background/45 pl-8 text-xs shadow-none"
            />
          </div>
          <div className="scrollbar-pro max-h-[min(50vh,13rem)] overflow-y-auto">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option) => {
                const localPath = option.description;
                const labelNode = (
                  <span className={cn('truncate', option.value === selectedValue && 'font-medium')}>
                    {option.label}
                  </span>
                );
                return (
                  <DropdownMenuItem
                    key={option.value}
                    onSelect={() => onChange(option.selection)}
                    className="gap-2 py-1.5 items-center"
                  >
                    <span className="shrink-0">{option.icon}</span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      {localPath ? (
                        <Tooltip>
                          <TooltipTrigger asChild>{labelNode}</TooltipTrigger>
                          <TooltipContent side="right" className="max-w-[22rem] break-all">
                            {localPath}
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        labelNode
                      )}
                    </span>
                    {option.value === selectedValue ? (
                      <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    ) : null}
                  </DropdownMenuItem>
                );
              })
            ) : (
              <div className="px-2.5 py-5 text-center text-xs text-muted-foreground">
                {t('chat.projectPicker.emptyText', 'No projects found')}
              </div>
            )}
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onChange({ kind: 'none' })}>
            <CircleSlash2 className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span>{clearLabel}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onAddLocalProject}>
            <FolderPlus className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span>{t('chat.contextSwitch.addProject', 'Add a project folder')}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
