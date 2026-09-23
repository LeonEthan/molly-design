import { describe, expect, it } from 'vitest';
import { plusIcon, renderUiIconSvg } from '../src/ui-icons/index';

describe('native UI icon renderer', () => {
  it('renders the canonical geometry with shared sizing and decorative semantics', () => {
    const svg = renderUiIconSvg(plusIcon, { size: 18 });
    expect(svg).toContain('width="18" height="18"');
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('stroke-width="1.5"');
    expect(svg).toContain('aria-hidden="true"');
    for (const [tag, attributes] of plusIcon) {
      expect(svg).toContain(`<${tag} `);
      for (const [name, value] of Object.entries(attributes))
        expect(svg).toContain(`${name}="${value}"`);
    }
  });

  it('escapes caller classes and handles invalid dimensions without injecting markup', () => {
    const svg = renderUiIconSvg(plusIcon, { size: NaN, className: 'x" onload="bad<&' });
    expect(svg).toContain('width="20" height="20"');
    expect(svg).toContain('class="molly-icon x&quot; onload=&quot;bad&lt;&amp;"');
    expect(svg).not.toContain(' onload="');
  });
});
