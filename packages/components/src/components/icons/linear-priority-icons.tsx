import type { SVGProps } from 'react';
import {
  PriorityHigh,
  PriorityLow,
  PriorityMedium,
  PriorityNone,
  PriorityUrgent,
} from '@/ui/icons';

// Keep the existing priority API; the shared glyph family owns its geometry.

export function LinearPriorityNone(props: SVGProps<SVGSVGElement>) {
  return <PriorityNone width="1em" height="1em" {...props} />;
}

export function LinearPriorityLow(props: SVGProps<SVGSVGElement>) {
  return <PriorityLow width="1em" height="1em" {...props} />;
}

export function LinearPriorityMedium(props: SVGProps<SVGSVGElement>) {
  return <PriorityMedium width="1em" height="1em" {...props} />;
}

export function LinearPriorityHigh(props: SVGProps<SVGSVGElement>) {
  return <PriorityHigh width="1em" height="1em" {...props} />;
}

export function LinearPriorityUrgent(props: SVGProps<SVGSVGElement>) {
  return <PriorityUrgent width="1em" height="1em" {...props} />;
}
