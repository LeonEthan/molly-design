import React, { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface CompactSectionProps {
  title?: string;
  description?: string;
  actions?: ReactNode;
  /** Free-form content on the right of the header (rendered as-is, unlike
   * `actions` which are coerced into icon buttons). */
  headerRight?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}

interface CompactRowProps {
  label: string;
  helper?: ReactNode;
  children?: ReactNode;
  className?: string;
  alignTop?: boolean;
}

export function CompactSection({
  title,
  description,
  actions,
  headerRight,
  children,
  className,
  contentClassName,
}: CompactSectionProps) {
  return (
    <section
      className={cn(
        'overflow-hidden rounded-2xl border border-border/40 bg-card text-sm shadow-none',
        className
      )}
    >
      {title || headerRight ? (
        <header className="flex min-h-12 items-center justify-between gap-3 px-5 py-4">
          <div className="min-w-0 flex-1">
            {title ? <p className="text-sm font-medium text-foreground">{title}</p> : null}
            {description && (
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
            )}
          </div>
          {headerRight ? (
            <div className="min-w-0 shrink truncate text-right text-[11px] text-muted-foreground">
              {headerRight}
            </div>
          ) : null}
          {actions ? (
            <div className="flex shrink-0 items-center gap-1.5">
              {React.Children.map(actions, (child) => {
                if (
                  !React.isValidElement<{
                    size?: string;
                    variant?: string;
                    className?: string;
                  }>(child)
                ) {
                  return child;
                }

                return React.cloneElement(child, {
                  size: child.props.size ?? 'icon',
                  variant: child.props.variant ?? 'default',
                  className: cn(
                    'h-8 w-8 rounded-full focus-visible:ring-1 focus-visible:ring-ring/60',
                    child.props.className
                  ),
                });
              })}
            </div>
          ) : null}
        </header>
      ) : null}
      <div className={cn('divide-y divide-border/40', contentClassName)}>{children}</div>
    </section>
  );
}

export function CompactRow({
  label,
  helper,
  children,
  className,
  alignTop = false,
}: CompactRowProps) {
  return (
    <div
      className={cn(
        // The control column hugs its content and the label column absorbs the rest. Settings
        // render inside a panel that is much narrower than the window, so a column capped at a
        // fixed px width (which a viewport breakpoint cannot see) would eat the whole row and
        // push the control past the panel's clipped edge.
        'flex flex-col gap-3 px-5 py-4 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-5',
        alignTop && 'sm:items-start sm:[&>div:last-child]:self-start',
        !alignTop && 'sm:items-center',
        className
      )}
    >
      {/* Helper copy is capped so it stays readable on a wide panel; a bare label is free to
          use the whole column, because long command names should not wrap early. */}
      <div className={cn('min-w-0', helper && 'sm:max-w-[520px]')}>
        <p className="font-normal leading-snug text-foreground">{label}</p>
        {helper && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{helper}</p>}
      </div>
      {children ? (
        <div className="min-w-0 flex flex-wrap items-center gap-2 text-sm sm:justify-end">
          {children}
        </div>
      ) : null}
    </div>
  );
}
