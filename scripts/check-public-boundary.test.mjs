import assert from 'node:assert/strict';
import test from 'node:test';
import { checkGoModContent, checkGoSourceContent } from './check-public-boundary.mjs';

test('checkGoModContent accepts clean local module', () => {
  const issues = checkGoModContent(
    'go.mod',
    'module github.com/LeonEthan/molly-design\n\ngo 1.27.3\n'
  );
  assert.deepEqual(issues, []);
});

test('checkGoModContent rejects closed modules, telemetry SDKs and local replace paths', () => {
  const telemetry = checkGoModContent(
    'go.mod',
    'module github.com/LeonEthan/molly-design\nrequire github.com/getsentry/sentry-go v0.30.0\n'
  );
  assert.equal(telemetry.length, 1);

  const localReplace = checkGoModContent(
    'go.mod',
    'module github.com/LeonEthan/molly-design\nreplace example.com/x => /tmp/local-x\n'
  );
  assert.equal(localReplace.length, 1);
});

test('checkGoSourceContent rejects cloud build tags and telemetry imports', () => {
  const clean = checkGoSourceContent(
    'internal/platform/local.go',
    '//go:build !cloud\n\npackage platform\n\nimport "errors"\n'
  );
  assert.deepEqual(clean, []);

  const cloudTag = checkGoSourceContent(
    'internal/platform/cloud.go',
    '//go:build cloud\n\npackage platform\n'
  );
  assert.equal(cloudTag.length, 1);

  const telemetryImport = checkGoSourceContent(
    'cmd/molly-core/main.go',
    'package main\n\nimport "github.com/posthog/posthog-go"\n'
  );
  assert.equal(telemetryImport.length, 1);
});
