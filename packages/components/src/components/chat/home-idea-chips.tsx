import { Fragment } from 'react';

export type HomeIdea = { label: string; prompt: string };

/** Prompt starters set as an inline line of italic links; they fill the composer, never submit. */
export function HomeIdeaChips({
  label,
  ideas,
  disabled,
  onPick,
}: {
  label: string;
  ideas: readonly HomeIdea[];
  disabled: boolean;
  onPick: (prompt: string) => void;
}) {
  return (
    <p
      role="group"
      aria-label={label}
      className="flex flex-wrap items-baseline justify-center gap-x-1.5 gap-y-1 text-center text-[13px] text-muted-foreground"
    >
      <span className="eyebrow mr-2 text-muted-foreground/80">{label}</span>
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
            className="font-editorial rounded-sm text-[17px] italic text-foreground/80 underline decoration-transparent decoration-1 underline-offset-4 transition-colors duration-200 hover:text-foreground hover:decoration-[var(--signal)] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-50"
          >
            {idea.label}
          </button>
        </Fragment>
      ))}
    </p>
  );
}
