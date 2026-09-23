import type { SVGProps } from 'react';
import { Progress } from '@/ui/icons';

export function CarbonInProgress(props: SVGProps<SVGSVGElement>) {
  return <Progress width="1em" height="1em" {...props} />;
}
