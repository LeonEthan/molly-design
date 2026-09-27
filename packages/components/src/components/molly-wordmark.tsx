import { MOLLY_M_PATH, MOLLY_M_VIEW_BOX, MOLLY_WORDMARK_FONT_FAMILY } from '@/lib/molly-brand';
import { cn } from '@/lib/utils';

function MollyMGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox={MOLLY_M_VIEW_BOX}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={cn('h-[1.16em] w-auto shrink-0 translate-y-[0.15em] overflow-visible', className)}
    >
      <path d={MOLLY_M_PATH} />
    </svg>
  );
}

export function MollyWordmark({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="Molly"
      data-molly-wordmark
      style={{ fontFamily: MOLLY_WORDMARK_FONT_FAMILY }}
      className={cn(
        'inline-flex items-baseline whitespace-nowrap font-bold leading-none tracking-[-0.01em]',
        className
      )}
    >
      <MollyMGlyph className="-mr-[0.02em]" />
      <span aria-hidden="true">olly</span>
    </span>
  );
}
