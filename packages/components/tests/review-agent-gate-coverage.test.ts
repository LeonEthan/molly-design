import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(__dirname, '..', 'src', path), 'utf8');

describe('Molly developer workflow retirement', () => {
  it('keeps GitHub authentication and auto-review subscriptions out of settings', () => {
    expect(read('components/settings/settings-tabs.tsx')).not.toContain("id: 'github'");
    expect(read('components/settings/machine-agent-settings.tsx')).not.toContain(
      'ReviewPolicySection'
    );
  });

  it('retires remote review activity while retaining generic conversation and file consumers', () => {
    const conversation = read('components/sessions/session-chat-interface.tsx');
    expect(conversation).not.toMatch(/useGitHubPrDetails|useAutoReview|AutoReviewMenuItem/);
    expect(conversation).toContain('FloatingPermissionRequest');
    expect(conversation).toContain('SessionChatInputArea');
    expect(conversation).toContain("t('design.files.currentCanvas', 'Current artwork')");
    expect(conversation).toContain('onClick={onRevealDesignPanel}');
    const diff = read('components/sessions/session-conversation-diff-panel.tsx');
    expect(diff).not.toMatch(/useGitHubReviewComments|githubCreatePRReviewComment/);
    expect(diff).toContain('useSessionAllChangesDiffData');
    expect(diff).toContain('onSendToChat');
    const detail = read('components/sessions/session-detail.tsx');
    expect(detail).not.toContain('PrTabContainer');
    expect(detail).toMatch(
      /headerVariant="toolbar"\s+onRevealDesignPanel=\{handleRevealDesignPanel\}/
    );
  });
});
