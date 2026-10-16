import { cn } from '@/lib/utils';

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        // CDS skeleton sweep: an angled highlight band crosses the resting slab
        // once per 1.6s. Transform-only; the resting fill stays static beneath.
        'relative overflow-hidden rounded-md bg-primary/10',
        'before:absolute before:inset-0 before:-translate-x-full before:animate-[skeleton-sweep_1.6s_ease-in-out_infinite]',
        'before:bg-gradient-to-r before:from-transparent before:via-foreground/[0.06] before:to-transparent',
        'motion-reduce:before:animate-none motion-reduce:before:hidden',
        className
      )}
      {...props}
    />
  );
}

export { Skeleton };
