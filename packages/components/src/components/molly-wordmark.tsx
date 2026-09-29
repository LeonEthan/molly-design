import {
  MOLLY_WORDMARK_PATHS,
  MOLLY_WORDMARK_TRANSFORM,
  MOLLY_WORDMARK_VIEW_BOX,
} from '@/lib/molly-brand';
import { cn } from '@/lib/utils';

export function MollyWordmark({ className }: { className?: string }) {
  return (
    <svg
      role="img"
      aria-label="Molly Design"
      data-molly-wordmark
      viewBox={MOLLY_WORDMARK_VIEW_BOX}
      fill="currentColor"
      focusable="false"
      className={cn('inline-block h-[2em] w-auto max-w-full shrink-0 align-middle', className)}
    >
      <g transform={MOLLY_WORDMARK_TRANSFORM}>
        {MOLLY_WORDMARK_PATHS.map((d, index) => (
          <path key={index} d={d} />
        ))}
      </g>
    </svg>
  );
}
