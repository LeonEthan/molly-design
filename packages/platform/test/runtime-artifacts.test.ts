import { describe, expect, it } from 'vitest';
import { DEFAULT_RUNTIME_ARTIFACTS_BASE_URL, resolveRuntimeArtifactUrl } from '../src/runtime-artifacts';

describe('runtime distribution', () => {
  it('addresses a versioned Molly release asset without the upstream API path', () => {
    expect(resolveRuntimeArtifactUrl(DEFAULT_RUNTIME_ARTIFACTS_BASE_URL, 'codex', '1.2.3', 'darwin-arm64', 'runtime.tar.zst'))
      .toBe('https://github.com/LeonEthan/molly-design/releases/download/runtime-artifacts-v1/codex--1.2.3--darwin-arm64--runtime.tar.zst');
  });

  it('preserves explicitly configured API mirrors and escapes path components', () => {
    expect(resolveRuntimeArtifactUrl('https://mirror.example.test/', 'codex', '1/2', 'darwin-arm64', 'runtime.tar.zst'))
      .toBe('https://mirror.example.test/api/runtimes/codex/1%2F2/darwin-arm64/runtime.tar.zst');
  });

  it('does not collide across versions or platforms sharing an archive filename', () => {
    const urls = [
      resolveRuntimeArtifactUrl(DEFAULT_RUNTIME_ARTIFACTS_BASE_URL, 'codex', '1', 'darwin-arm64', 'runtime.tar.zst'),
      resolveRuntimeArtifactUrl(DEFAULT_RUNTIME_ARTIFACTS_BASE_URL, 'codex', '2', 'darwin-arm64', 'runtime.tar.zst'),
      resolveRuntimeArtifactUrl(DEFAULT_RUNTIME_ARTIFACTS_BASE_URL, 'codex', '1', 'linux-arm64', 'runtime.tar.zst'),
    ];
    expect(new Set(urls).size).toBe(3);
  });
});
