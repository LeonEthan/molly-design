'use client';

import { useState } from 'react';
import { MessageSquare, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverAnchor, PopoverContent } from '@/ui/popover';

export interface DesignNotesChipItem {
  /** "N comments" chip label, already localized. */
  label: string;
  /** The staged comments in their numbered order. */
  comments: readonly { label: string; prompt: string }[];
}

/**
 * Staged canvas comments parked in the composer before the turn is sent.
 * Hovering or focusing the chip lists the numbered comments; the X unstages
 * them (the canvas keeps its pins).
 */
export function DesignNotesChip({
  item,
  removeLabel,
  onRemove,
  className,
}: {
  item: DesignNotesChipItem;
  removeLabel: string;
  onRemove?: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div
          data-design-notes-ref
          tabIndex={0}
          className={cn(
            'flex max-w-64 items-center gap-1.5 rounded-lg border bg-muted/50 py-1 pl-2.5 text-xs',
            'outline-hidden focus-visible:ring-1 focus-visible:ring-ring/60',
            onRemove ? 'pr-1' : 'pr-2.5',
            className
          )}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
        >
          <MessageSquare className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
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
      </PopoverAnchor>
      <PopoverContent
        side="top"
        align="start"
        className="w-80 max-w-[calc(100vw-32px)] rounded-xl p-2"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <ol className="flex flex-col gap-1.5">
          {item.comments.map((comment, index) => (
            <li key={index} className="flex min-w-0 items-start gap-2 text-xs leading-5">
              <span
                aria-hidden="true"
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground"
              >
                {index + 1}
              </span>
              <span className="min-w-0 break-words text-foreground/80">{comment.prompt}</span>
            </li>
          ))}
        </ol>
      </PopoverContent>
    </Popover>
  );
}
