// @vitest-environment jsdom
import { act, createElement, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Check as LegacyCheck, HelpCircle, Loader2, GripHorizontalIcon } from 'lucide-react';
import * as icons from '../src/ui/icons';
import { checkIcon } from '@molly/shared/ui-icons';

const directory = path.resolve('../shared/src/ui-icons/svg');

describe('Molly React icon compatibility', () => {
  it('resolves inherited and editor imports to the canonical family', () => {
    expect(LegacyCheck).toBe(icons.Check);
    expect(HelpCircle).toBe(icons.CircleQuestionMark);
    expect(Loader2).toBe(icons.LoaderCircle);
    expect(GripHorizontalIcon).toBe(icons.GripHorizontal);
    const document = new DOMParser().parseFromString(
      renderToStaticMarkup(<LegacyCheck />),
      'image/svg+xml'
    );
    expect(document.documentElement.getAttribute('data-molly-icon')).toBe('Check');
    expect(document.querySelector('path')?.getAttribute('d')).toBe(checkIcon[0][1].d);
  });

  it('exposes every editable source as a decorative React glyph', () => {
    const catalog: Record<string, unknown> = icons;
    for (const file of readdirSync(directory).filter((name) => name.endsWith('.svg'))) {
      const name = file.slice(0, -4);
      const component = catalog[name];
      expect(component, name).toBeDefined();
      const svg = renderToStaticMarkup(createElement(component as icons.LucideIcon));
      expect(svg).toContain(`data-molly-icon="${name}"`);
      expect(svg).toContain('aria-hidden="true"');
    }
  });

  it('keeps refs, dimensions, caller labels and stroke scaling', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    const ref = createRef<SVGSVGElement>();
    try {
      await act(async () =>
        root.render(
          <icons.Save
            ref={ref}
            size={18}
            absoluteStrokeWidth
            strokeWidth={1.5}
            aria-label="Save version"
            className="test-glyph"
            data-testid="save-glyph"
          />
        )
      );
      expect(ref.current).toBe(container.querySelector('svg'));
      expect(ref.current?.getAttribute('width')).toBe('18');
      expect(ref.current?.getAttribute('aria-label')).toBe('Save version');
      expect(ref.current?.hasAttribute('aria-hidden')).toBe(false);
      expect(ref.current?.style.strokeWidth).toBe('2');
      expect(ref.current?.classList.contains('test-glyph')).toBe(true);
      expect(ref.current?.getAttribute('data-testid')).toBe('save-glyph');
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('normalizes inherited weights while excluding preserved brands', () => {
    const css = readFileSync(path.resolve('src/tailwind/index.css'), 'utf8');
    expect(css).toMatch(/svg\.lucide:not\(\[data-molly-brand\]\)\s*\{\s*stroke-width: 1\.5;/);
    const brand = renderToStaticMarkup(<icons.Github />);
    expect(brand).toContain('data-molly-brand="Github"');
    expect(brand).not.toContain('data-molly-icon=');
  });
});
