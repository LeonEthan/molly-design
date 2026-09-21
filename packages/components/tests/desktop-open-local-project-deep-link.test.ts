import { describe, expect, it } from 'vitest';
import { resolveDesktopOpenLocalProjectDeepLinkPath } from '../src/lib/desktop-open-local-project-deep-link';

const MACHINE = 'machine-1';
const PROJECT = 'local-project-abc123';

describe('resolveDesktopOpenLocalProjectDeepLinkPath', () => {
  it('routes a `molly app` link to the new-chat landing with the local project preselected', () => {
    expect(
      resolveDesktopOpenLocalProjectDeepLinkPath(
        `molly-design://chat/new?machine=${MACHINE}&project=${PROJECT}&workspaceSlug=acme`
      )
    ).toBe(`/acme/chat?context=local&machine=${MACHINE}&project=${PROJECT}`);
  });

  it('still accepts legacy lody:// links', () => {
    expect(
      resolveDesktopOpenLocalProjectDeepLinkPath(
        `lody://chat/new?machine=${MACHINE}&project=${PROJECT}&workspaceSlug=acme`
      )
    ).toBe(`/acme/chat?context=local&machine=${MACHINE}&project=${PROJECT}`);
  });

  it('falls back to the current path workspace slug when the link carries none', () => {
    expect(
      resolveDesktopOpenLocalProjectDeepLinkPath(
        `molly-design://chat/new?machine=${MACHINE}&project=${PROJECT}`,
        '/acme/sessions/s1'
      )
    ).toBe(`/acme/chat?context=local&machine=${MACHINE}&project=${PROJECT}`);
  });

  it('returns null when no workspace slug can be resolved', () => {
    expect(
      resolveDesktopOpenLocalProjectDeepLinkPath(
        `molly-design://chat/new?machine=${MACHINE}&project=${PROJECT}`,
        '/'
      )
    ).toBeNull();
  });

  it('requires both the machine and the project id', () => {
    expect(
      resolveDesktopOpenLocalProjectDeepLinkPath(
        `molly-design://chat/new?machine=${MACHINE}&workspaceSlug=acme`
      )
    ).toBeNull();
    expect(
      resolveDesktopOpenLocalProjectDeepLinkPath(
        `molly-design://chat/new?project=${PROJECT}&workspaceSlug=acme`
      )
    ).toBeNull();
    expect(
      resolveDesktopOpenLocalProjectDeepLinkPath(
        `molly-design://chat/new?machine=%20&project=${PROJECT}&workspaceSlug=acme`
      )
    ).toBeNull();
  });

  it('carries no path parameter, so a link can never register a directory', () => {
    const path = resolveDesktopOpenLocalProjectDeepLinkPath(
      `molly-design://chat/new?machine=${MACHINE}&project=${PROJECT}&workspaceSlug=acme&path=${encodeURIComponent('/etc')}`
    );
    expect(path).toBe(`/acme/chat?context=local&machine=${MACHINE}&project=${PROJECT}`);
    expect(path).not.toContain('etc');
  });

  it('ignores unrelated deep links', () => {
    expect(
      resolveDesktopOpenLocalProjectDeepLinkPath(
        `molly-design://chat/other?machine=${MACHINE}&project=${PROJECT}&workspaceSlug=acme`
      )
    ).toBeNull();
    expect(
      resolveDesktopOpenLocalProjectDeepLinkPath(
        'molly-design://checkout-return?workspaceSlug=acme'
      )
    ).toBeNull();
    expect(
      resolveDesktopOpenLocalProjectDeepLinkPath('molly-design://invite/open?invitationId=i1')
    ).toBeNull();
    expect(
      resolveDesktopOpenLocalProjectDeepLinkPath(
        `https://lody.ai/chat/new?machine=${MACHINE}&project=${PROJECT}`
      )
    ).toBeNull();
    expect(resolveDesktopOpenLocalProjectDeepLinkPath('not a url')).toBeNull();
  });
});
