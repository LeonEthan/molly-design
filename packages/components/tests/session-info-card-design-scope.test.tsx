// @vitest-environment jsdom
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SessionInfoCard } from '../src/components/session-info-hover-card';
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

describe('design session metadata presentation', () => {
  it('keeps local file context without exposing legacy PR navigation or CI', () => {
    const html = renderToStaticMarkup(
      <SessionInfoCard
        kind="local"
        title="Poster draft"
        folderName="Designs"
        latestMessageAt="2026-09-11T00:00:00Z"
        now={new Date('2026-09-11T00:01:00Z')}
        prStatus="open"
        prUrl="https://github.com/example/design/pull/42"
        prNumber={42}
        prCiState="f"
      />
    );
    expect(html).toContain('Poster draft');
    expect(html).toContain('Designs');
    expect(html).not.toContain('github.com');
    expect(html).not.toContain('Open pull request');
    expect(html).not.toContain('#42');
    expect(html).not.toContain('CI');
  });
});
