# Invoke document checks through the package script

Status: implemented
Translation: pending

## Abstract

Repeated browser visits to the node-check homepage came from an Agent command
error: `pnpm docs check` invokes pnpm's built-in package-documentation command.
The repository already required `pnpm run docs check`. Execution now includes
`run` explicitly, and the root rule names the collision to prevent recurrence.
The earlier bare-command zero exits were not document validation.

## Evidence and correction

The installed pnpm 10.20.0 dispatcher forwards `docs` to npm. npm's `Docs`
command opens the requested package's homepage; here the argument was `check`.
The read-only `corepack pnpm view check homepage` returned the exact reported
`http://github.com/msiebuhr/node-check/` URL without opening a browser.
This was a temporary verification-command error, not a Folio browser action or
an error in the repository's documentation checker. No package or runtime patch
is needed.

Running `corepack pnpm run docs status` and `corepack pnpm run docs check`
actually executed `scripts/docs/main.mjs`. The first check found the root and
sessions AGENTS.md above their 8 KiB limit. Their wording was shortened while
retaining constraints, and the real check then passed. Existing translation and
near-limit warnings remain warnings. This new check supersedes the mistaken
bare-command success claims; it does not retroactively validate earlier revisions.
