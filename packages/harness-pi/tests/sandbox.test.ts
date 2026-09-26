import { describe, expect, it } from 'vitest';
import { createSandboxConfig, resolveNativeTemporaryDirectory } from '../src/sandbox';

describe('native temporary files', () => {
  it('uses only the canonical native user temp directory on macOS', async () => {
    const directory = '/private/var/folders/ab/user-owned/T';
    expect(await resolveNativeTemporaryDirectory('darwin', async () => directory)).toBe(directory);
  });

  it.each([
    '',
    '/',
    '/tmp',
    '/private/tmp',
    '/private/var/folders',
    '/private/var/folders/ab/user-owned',
  ])('does not widen the sandbox for unexpected native temp output %j', async (directory) => {
    expect(await resolveNativeTemporaryDirectory('darwin', async () => directory)).toBeUndefined();
  });

  it('keeps private sandbox temp access when native resolution fails', async () => {
    const nativeTemporaryDirectory = await resolveNativeTemporaryDirectory('darwin', async () => {
      throw new Error('synthetic getconf failure');
    });
    expect(
      createSandboxConfig({
        cwd: '/work',
        temporaryDirectory: '/private/tmp/molly-sandbox-owned',
        nativeTemporaryDirectory,
        deniedReadRoots: [],
      }).filesystem.allowWrite
    ).toEqual(['/work', '/private/tmp/molly-sandbox-owned']);
  });

  it('does not query macOS paths on Linux', async () => {
    let queried = false;
    expect(
      await resolveNativeTemporaryDirectory('linux', async () => {
        queried = true;
        return '/private/var/folders/ab/user-owned/T';
      })
    ).toBeUndefined();
    expect(queried).toBe(false);
  });

  it('allows the current macOS user temp directory without opening its ancestors', () => {
    const nativeTemporaryDirectory = '/private/var/folders/ab/user-owned/T';
    const input = {
      cwd: '/work',
      temporaryDirectory: '/private/tmp/molly-sandbox-owned',
      nativeTemporaryDirectory,
      deniedReadRoots: ['/private/molly', '/home/user/.ssh'],
    };
    const { filesystem } = createSandboxConfig(input);
    expect(filesystem.allowWrite).toEqual([
      input.cwd,
      input.temporaryDirectory,
      nativeTemporaryDirectory,
    ]);
    expect(filesystem.allowRead).toEqual([input.cwd, input.temporaryDirectory]);
    expect(filesystem.denyRead).toEqual(input.deniedReadRoots);
  });
});
