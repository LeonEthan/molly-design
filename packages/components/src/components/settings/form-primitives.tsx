import type { ReactNode } from 'react';
import { Label } from '@/ui/label';

/**
 * The shared grammar of the settings editors.
 *
 * Every settings form — MCP connection, Agent Role — is the same stack of
 * soft sections holding labelled fields, so the spacing and typography live
 * here once. A local copy per editor is how three dialogs that are supposed to
 * look like one surface drift apart one padding value at a time.
 */

export function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-5 rounded-2xl border border-border/40 bg-card p-5">
      <header>
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        {hint ? <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{hint}</p> : null}
      </header>
      {children}
    </section>
  );
}

export function Field({
  htmlFor,
  label,
  hint,
  icon,
  children,
}: {
  /** Associates the label with a control that owns an id; omit for a group. */
  htmlFor?: string;
  label: string;
  hint?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {icon ? <span className="text-muted-foreground">{icon}</span> : null}
        <Label htmlFor={htmlFor} className="text-xs font-medium">
          {label}
        </Label>
      </div>
      {children}
      {hint ? <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
