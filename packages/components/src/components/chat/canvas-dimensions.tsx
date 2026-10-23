import { cn } from '@/lib/utils';

export const formatCanvasDimensions = (width: number, height: number) => `${width} × ${height}`;

export function CanvasDimensions({
  width,
  height,
  className,
}: {
  width: number;
  height: number;
  className?: string;
}) {
  return (
    <span className={cn('font-mono tabular-nums', className)}>
      {formatCanvasDimensions(width, height)}
    </span>
  );
}
