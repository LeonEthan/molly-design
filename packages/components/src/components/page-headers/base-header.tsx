import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface BaseHeaderProps {
  title: ReactNode;
  actions?: ReactNode;
  className?: string;
  /** Inline header overrides. */
  style?: CSSProperties;
  leading?: ReactNode;
  truncateTitle?: boolean;
}

/**
 * Base header component.
 * Provides a responsive desktop page header layout.
 */
export function BaseHeader({
  title,
  actions,
  className,
  style,
  leading,
  truncateTitle = true,
}: BaseHeaderProps) {
  return (
    <div
      className={cn(
        'flex items-center border-b border-border bg-background',
        'h-14 px-3 sm:px-4',
        className
      )}
      style={style}
    >
      {/* Custom leading element (e.g. back button) */}
      {leading && <div className="mr-2 shrink-0">{leading}</div>}

      {/* Title */}
      <h2
        className={cn(
          'min-w-0 flex-1 text-xl font-semibold',
          truncateTitle && 'truncate'
        )}
      >
        {title}
      </h2>

      {/* Actions */}
      {actions && <div className="ml-2 flex shrink-0 items-center gap-1 sm:gap-2">{actions}</div>}
    </div>
  );
}
