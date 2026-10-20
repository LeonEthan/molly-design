import { Fragment, useState } from 'react';
import { ChevronDown } from '@/ui/icons';
import { cn } from '@/lib/utils';

export type HomeIdea = { label: string; prompt: string };

export function HomeIdeaChips({
  label,
  expandLabel,
  ideas,
  disabled,
  onPick,
}: {
  label: string;
  expandLabel: string;
  ideas: readonly HomeIdea[];
  disabled: boolean;
  onPick: (prompt: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="flex w-full flex-col items-center gap-2 text-center text-[13px] text-muted-foreground">
      <button
        type="button"
        disabled={disabled}
        aria-expanded={expanded}
        aria-controls="home-idea-chips-panel"
        onClick={() => setExpanded((open) => !open)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border border-border/40 bg-foreground/[0.02] px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors',
          'hover:bg-foreground/[0.05] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-50'
        )}
      >
        <span className="eyebrow text-muted-foreground">{label}</span>
        <span>{expandLabel}</span>
        <ChevronDown
          aria-hidden
          className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', expanded && 'rotate-180')}
        />
      </button>
      {expanded ? (
        <p
          id="home-idea-chips-panel"
          role="group"
          aria-label={label}
          className="flex flex-wrap items-baseline justify-center gap-x-1.5 gap-y-1"
        >
          {ideas.map((idea, index) => (
            <Fragment key={idea.label}>
              {index > 0 ? (
                <span aria-hidden className="text-muted-foreground/40">
                  /
                </span>
              ) : null}
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPick(idea.prompt)}
                title={idea.prompt}
                className="rounded-sm px-1 py-1 text-[13px] font-medium text-foreground underline decoration-transparent decoration-1 underline-offset-4 transition-colors duration-200 hover:text-foreground hover:decoration-current focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-50"
              >
                {idea.label}
              </button>
            </Fragment>
          ))}
        </p>
      ) : null}
    </div>
  );
}
