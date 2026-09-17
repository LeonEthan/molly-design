import { describe, expect, it } from 'vitest';
import { getWebWorkspaceLayoutRootClassName } from '../src/components/workspace-layout-utils';

describe('desktop workspace layout root', () => {
  it('fills the window in workspace and settings routes', () => {
    expect(getWebWorkspaceLayoutRootClassName()).toContain('h-svh');
    expect(getWebWorkspaceLayoutRootClassName({ settingsRoute: true })).toContain('h-svh');
  });

  it('positions the settings root for its window drag strip', () => {
    expect(getWebWorkspaceLayoutRootClassName({ settingsRoute: true }).split(' ')).toContain(
      'relative'
    );
    expect(getWebWorkspaceLayoutRootClassName().split(' ')).not.toContain('relative');
  });
});
