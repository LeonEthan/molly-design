# Onboarding tour

`CLAUDE.md` is a symlink to this file. Edit `AGENTS.md` only.
Parent `AGENTS.md` files also apply; screen and illustrated-intro rules live in
[../AGENTS.md](../AGENTS.md).

- `TourApp` reuses production components against fixture state inside
  `TourLocalBoundary`. The boundary owns fixture identity and the implicit local
  workspace; tour children may not observe the outer app's user or workspace.
- `createTourRepo` provides read-only local documents. Reused components open
  workspace catalog and Machine Flock documents, so fixture documents must read
  empty and report their first local sync as done. Reject fixture writes rather
  than letting the tour change product data.
