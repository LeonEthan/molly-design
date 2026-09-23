export * from './generated';
export type { UiIconNode, UiIconTag } from './types';

import type { UiIconNode } from './types';

function escapeAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character];
  });
}

/** Native Bento chrome uses the same local, generated geometry as React. */
export function renderUiIconSvg(
  nodes: readonly UiIconNode[],
  { size = 20, className = '' }: { size?: number; className?: string } = {}
): string {
  const dimension = Number.isFinite(size) && size > 0 ? size : 20;
  const shapes = nodes
    .map(
      ([tag, attributes]) =>
        `<${tag} ${Object.entries(attributes)
          .map(([name, value]) => `${name}="${escapeAttribute(value)}"`)
          .join(' ')} />`
    )
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dimension}" height="${dimension}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" class="molly-icon ${escapeAttribute(className)}">${shapes}</svg>`;
}
