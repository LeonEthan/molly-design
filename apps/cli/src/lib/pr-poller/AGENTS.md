# PR status reconciler (retired)

`CLAUDE.md` is a symlink to this file. Edit `AGENTS.md` only.

Molly removed this product runtime in T24. Do not restart its polling, credential
harvesting, or automatic Agent/merge actions. Existing durable records and local
files remain untouched. Generic task execution, file watching and design rendering
have separate consumers and remain supported.
