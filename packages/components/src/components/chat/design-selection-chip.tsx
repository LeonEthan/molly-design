import { MousePointer2, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface DesignSelectionChipItem {
  label: string;
}

export function DesignSelectionChip({
  item,
  removeLabel,
  onRemove,
  className,
}: {
  item: DesignSelectionChipItem;
  removeLabel: string;
  onRemove?: () => void;
  className?: string;
}) {
  return (
    <div
      data-design-selection-ref
      className={cn(
        'flex max-w-64 items-center gap-1.5 rounded-lg border bg-muted/50 py-1 pl-2.5 text-xs',
        onRemove ? 'pr-1' : 'pr-2.5',
        className
      )}
    >
      <MousePointer2 className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="truncate font-medium text-foreground/80">{item.label}</span>
      {onRemove ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          className={cn(
            'flex h-5 w-5 shrink-0 items-center justify-center rounded-xs',
            'text-muted-foreground/70 transition-colors',
            'hover:bg-muted-foreground/20 hover:text-foreground',
            'focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring/60'
          )}
          aria-label={removeLabel}
        >
          <X className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  );
}
