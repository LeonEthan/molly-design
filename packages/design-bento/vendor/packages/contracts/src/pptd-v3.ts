/** Folio PPTD v3: lossless editable projection of existing Bento v4 semantics.
 * Literal styles and structured text reuse canonical field vocabulary; asset src
 * fields contain local media paths until import. No new editor capabilities.
 */
import type { BentoDocV4, BentoElementV4 } from './bentodoc-v4.ts';

type ProjectElement<T> = T extends BentoElementV4
  ? Omit<T, 'id' | 'kind'> & { elementId: string; elementType: T['kind'] }
  : never;
export type PptdV3Element = ProjectElement<BentoElementV4>;
export interface PptdV3Project {
  manifest: {
    version: 'v3';
    title?: string;
    size: [number, number];
    pages: string[];
    customFonts?: BentoDocV4['fonts'];
  };
  pages: {
    background: BentoDocV4['background'];
    elements: PptdV3Element[];
    diagnostics?: BentoDocV4['diagnostics'];
  }[];
}
declare const validatedV3: unique symbol;
export type ValidatedPptdV3 = PptdV3Project & { readonly [validatedV3]: true };
