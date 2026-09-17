import { type ComponentPropsWithoutRef, type ReactNode, forwardRef, useState } from 'react';
import { Check, Clock, Folder } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { CarbonSettingsAdjust } from '@/components/icons/carbon-settings-adjust';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import { Button } from '@/ui/button';
import type { SidebarOrganizeMode } from '@/atoms/sidebar-state';
export type { SidebarOrganizeMode };

export type SidebarFilterLabels = {
  triggerAriaLabel: string;
  organizeHeading: string;
  organizeWorkspace: string;
  organizeUpdated: string;
};

const defaultLabels: SidebarFilterLabels = {
  triggerAriaLabel: 'Filter sidebar',
  organizeHeading: 'Organize',
  organizeWorkspace: 'Workspace',
  organizeUpdated: 'Updated',
};

export type SidebarFilterPopoverProps = {
  organize: SidebarOrganizeMode;
  onOrganizeChange?: (next: SidebarOrganizeMode) => void;
  labels?: Partial<SidebarFilterLabels>;
  className?: string;
  triggerClassName?: string;
  /** Render a custom trigger instead of the default IconButton-style filter button. */
  trigger?: ReactNode;
  /** Where to anchor the popover. Defaults to top-start since the trigger lives in the footer. */
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
};

type RowProps = {
  label: string;
  icon: LucideIcon;
  selected: boolean;
  onSelect: () => void;
} & Omit<ComponentPropsWithoutRef<'button'>, 'onClick' | 'children'>;

const FilterRow = forwardRef<HTMLButtonElement, RowProps>(function FilterRow(
  { label, icon: Icon, selected, onSelect, className, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      className={cn(
        'flex w-full select-none items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
        'text-popover-foreground transition-colors',
        'hover:bg-sidebar-hover hover:text-sidebar-hover-foreground',
        'focus-visible:bg-sidebar-hover focus-visible:text-sidebar-hover-foreground',
        'focus-visible:outline-hidden',
        className
      )}
      onClick={onSelect}
      {...rest}
    >
      <Icon className="h-4 w-4 shrink-0 text-sidebar-foreground-muted" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {selected ? (
        <Check className="h-4 w-4 shrink-0 text-foreground" aria-hidden="true" />
      ) : (
        <span className="h-4 w-4 shrink-0" aria-hidden="true" />
      )}
    </button>
  );
});

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <div className="px-2 pb-1 pt-1 text-[11px] font-medium tracking-wide text-sidebar-foreground-muted/70">
      {children}
    </div>
  );
}

export function SidebarFilterPopover({
  organize,
  onOrganizeChange,
  labels,
  className,
  triggerClassName,
  trigger,
  side = 'top',
  align = 'start',
}: SidebarFilterPopoverProps) {
  const merged = { ...defaultLabels, ...labels };
  const [open, setOpen] = useState(false);

  const handleOrganizeSelect = (next: SidebarOrganizeMode) => {
    onOrganizeChange?.(next);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={merged.triggerAriaLabel}
            data-state-open={open || undefined}
            className={cn(
              // Match section-header muted chrome (Pinned / Chats); full
              // contrast on hover/open so the control still feels interactive.
              'h-7 w-7 rounded-md text-sidebar-foreground-muted',
              'hover:bg-sidebar-hover hover:text-sidebar-hover-foreground',
              'focus-visible:ring-1 focus-visible:ring-sidebar-ring/40',
              'data-[state=open]:bg-sidebar-hover data-[state=open]:text-sidebar-hover-foreground',
              triggerClassName
            )}
          >
            <CarbonSettingsAdjust className="h-4 w-4" />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        sideOffset={8}
        style={{ animation: 'none' }}
        className={cn('w-56 rounded-xl p-1.5 shadow-2xl', className)}
      >
        <SectionHeading>{merged.organizeHeading}</SectionHeading>
        <FilterRow
          label={merged.organizeWorkspace}
          icon={Folder}
          selected={organize === 'workspace'}
          onSelect={() => handleOrganizeSelect('workspace')}
        />
        <FilterRow
          label={merged.organizeUpdated}
          icon={Clock}
          selected={organize === 'updated'}
          onSelect={() => handleOrganizeSelect('updated')}
        />
      </PopoverContent>
    </Popover>
  );
}

SidebarFilterPopover.displayName = 'SidebarFilterPopover';
