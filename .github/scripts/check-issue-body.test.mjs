import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { checkIssueBody } from './check-issue-body.mjs';

const bugBody = `### Affected area

Embedded local service

### Installation method

Built from source

### Molly version or commit

test

### Operating system

macOS

### What happened?

The command failed.

### What did you expect?

The command should succeed.

### How can we reproduce it?

Run the command.

### How often does it happen?

Always

### Before submitting

- [x] I searched the existing issues and did not find a duplicate.
- [x] This report concerns an open-source component in this repository, not a hosted service, Web or mobile app, account, or billing issue.
- [x] This is not a security vulnerability; security reports follow the repository's security policy.
- [x] I removed credentials, private source, conversations, prompts, personal data, and other sensitive information.
`;

const featureBody = `### Affected area

Embedded local service

### Problem or workflow pressure

The workflow is difficult.

### Desired outcome

The workflow becomes easier.

### Before submitting

- [x] I searched the existing issues and did not find a duplicate request.
- [x] This request concerns an open-source component in this repository, not a hosted service, Web or mobile app, account, or billing issue.
- [x] I removed credentials, private source, conversations, prompts, personal data, and other sensitive information.
`;

void describe('Issue body validation', () => {
  for (const [title, body, kind] of [
    ['[Bug] Component failure', bugBody, 'report'],
    ['[Feature Request] Component improvement', featureBody, 'request'],
  ]) {
    for (const wording of ['an open-source component', 'a component']) {
      const confirmation = `This ${kind} concerns ${wording} in this repository, not a hosted service, Web or mobile app, account, or billing issue.`;
      const renderedBody = body.replace('an open-source component', wording);

      void it(`accepts ${kind} confirmation with ${wording} wording`, () => {
        assert.equal(checkIssueBody({ title, body: renderedBody }).ok, true);
      });

      for (const replacement of ['', `- [ ] ${confirmation}`]) {
        void it(`rejects ${kind} with ${wording} confirmation ${replacement ? 'unchecked' : 'missing'}`, () => {
          const result = checkIssueBody({
            title,
            body: renderedBody.replace(`- [x] ${confirmation}`, replacement),
          });
          assert.equal(result.ok, false);
          assert.ok(
            result.findings.some((finding) =>
              finding.includes('confirmation is missing or unchecked: This')
            )
          );
        });
      }
    }
  }

  void it('does not require maintainer agreement for bug reports', () => {
    const result = checkIssueBody({ title: '[Bug] Command failure', body: bugBody });
    assert.equal(result.ok, true);
  });

  void it('keeps existing reports valid after the version heading rename', () => {
    const result = checkIssueBody({
      title: '[Bug] Existing report',
      body: bugBody.replace('### Molly version or commit', '### Lody version or commit'),
    });
    assert.equal(result.ok, true);
  });

  void it('does not require maintainer agreement for feature requests', () => {
    const result = checkIssueBody({
      title: '[Feature Request] Better workflow',
      body: featureBody,
    });
    assert.equal(result.ok, true);
  });
});
