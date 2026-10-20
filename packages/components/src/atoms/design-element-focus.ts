import { atom } from 'jotai';
import type { DesignElementReference } from '@molly/shared/design-element-reference';

/**
 * A transcript comment row asks the design canvas to flash the elements it cites.
 * The canvas clears the request once handled, so a remount never replays it.
 */
export const designElementFocusAtom = atom<DesignElementReference | null>(null);
