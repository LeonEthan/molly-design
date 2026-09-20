# Molly

[简体中文](README.zh-CN.md)

Molly is an independent local desktop workspace for graphic design with an Agent and
an editable single canvas, based on the [Lody](https://github.com/LodyAI/Lody)
codebase. It retains Lody's interface and Agent execution architecture, with YAML
artwork authoring and the Bento editor.

## Current development build

- Create a design, choose its dimensions, edit text, shapes and images in Bento,
  save it, reopen it, and export PNG or JPEG.
- Manual edits save automatically. Use Save version to retain a version in
  the artwork's local history, inspect earlier versions and continue editing from one.
- Ask your configured Agent to create or revise a YAML design. BentoDoc is the
  editable canvas; YAML is the Agent-facing authoring format. The Agent chooses its
  creative approach and can use available file and image tools to review its work.
- Continue the conversation, grant permissions, cancel work, and use the existing
  session navigation. Visual quality remains your judgment.
- Edit the canvas without configuring an image service. Image generation is an
  optional connection; supply your own endpoint, credentials and explicit model
  identifier in Settings. Molly does not recommend a product-default model.

This development build is migrating to one bundled Pi engine with explicit model
connections. Image reading, public read-first reminders and authoring previews have
scoped implementation evidence; the complete migrated workflow is not yet accepted.
Being configurable does not prove that a provider supports every design operation.
The [design specification](specs/graphic-design-platform.zh.md) describes the draft
target, not a list of shipped features.

## Configure connections

1. Open Settings → Agents → Molly model connections. Add the provider/product,
   connection name, endpoint and API key. Enter keys only in the local settings
   field, never in a conversation or artwork file. Saving encrypts the connection;
   it neither tests inference nor changes an existing session's selection.
2. For Kimi membership credentials, select **Kimi Code (membership API key)**,
   not Moonshot Open Platform. In the conversation composer choose Molly and an
   explicit connection, model and supported thinking level. Missing or invalid
   selections fail rather than silently switching providers or models.
3. Optionally configure Settings → Image Connection separately. Supply an
   OpenAI Images-compatible API root (without `/images/generations` or
   `/images/edits`), key and exact model, enable it and save. **Test connection**
   checks `/models` only; success does not verify generation, editing or masks.
4. For external tools, configure Settings → MCP and select the servers for the
   turn. Saving does not test or automatically select them. A stdio server runs
   local code: configure only commands and servers you trust.

The bundled-capabilities section reports packaged versions and compatibility
conditions, not live session activation. The selected question extension requires
the desktop question interface; necessary Slash-command mapping remains unfinished.
There is no user plugin installation required for the bundled engine.

For **OpenAI-compatible (advanced)**, add explicit model definitions in the connection
form: IDs, token limits and the capabilities your service actually supports. This
path uses standard Chat Completions streaming, not Responses or vendor-specific
thinking formats. Turns containing tools require declared tool-call support. Saving
does not verify these declarations or select a model; unknown prices remain unknown.

## Try a design

Create a single canvas and try a prompt such as:

> Create an 800 × 600 workshop poster. Use a dark blue background, a large “Make
> something” heading, and the subtitle “Saturday · 14:00”. Keep the text editable.

Then try:

> Make the heading smaller and give the subtitle more space. Keep the canvas size.

You can also select and edit text, change colors, insert an image and adjust the
layout directly in Bento. Save the design before exporting PNG or JPEG. Generated
images are optional; text and shape design does not require an image service.

## Continue, preview and recover

Manual edits automatically update the saved canvas and its YAML artwork files. Molly waits
for open-canvas saves before dispatch and keeps the artwork read-only while the Agent executes
and its files are processed. A file preview shows the working source; it is not a
saved canvas or proof that the Agent has finished. After a formal commit, edit the
current canvas again. When explicitly importing a preview, Molly binds the import
to the displayed snapshot.

If a file or final-save conflict occurs, the current saved canvas and Agent draft
are preserved. Use a new message to continue and resolve the conflict; Molly does
not automatically restart the finished turn. Existing draft files and historical
content remain available through the file interface. A save failure must be
resolved before treating your latest edits as saved or quitting.

After cancellation, timeout or a crash, a dispatched request can have an unknown
remote outcome. Stop does not prove that the provider stopped computing or charging.
Keep the receipts and recovered assets; Molly does not automatically repeat a paid
request. An explicit new request may incur another charge. Recovering already
completed artifact processing must not restart model execution.

For a legacy design session, use its explicit Molly continuation flow and review
the migration preview. It creates a new context for the same artwork, retaining
the original history instead of replaying it as native Pi history. Legacy Roles
also require explicit migration. These paths have implementation tests; native
restart and rollback acceptance is still pending. If native history is invalid,
retain the original files and report the error rather than deleting journals to
force a retry.

## Release status and support limits

The embedded Pi migration is **not fully accepted**. Current evidence and remaining
work are recorded in the
[implementation note](.agents/notes/proposed/architecture/2026-09-19-embedded-pi-harness-implementation.zh.md).

| Connection                                            | Current evidence and limits                                                                                                                                                                   |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kimi Code `k3-256k/high`                              | Scoped real text, design, image-reading and recovery checks; not complete journey acceptance.                                                                                                 |
| Configured Images-compatible `gpt-image-2.5-sunburst` | Scoped real generation/editing outputs; the full mask, multiple-image, JPEG, long-image and human visual matrix remains open. This is a tested user selection, not a default.                 |
| Other named model presets                             | Pinned SDK catalog and code/offline checks do not prove real-account, regional or product compatibility.                                                                                      |
| Advanced OpenAI-compatible language models            | Explicit model form, encrypted persistence and standard Chat Completions SDK path have synthetic coverage. Native UI and real-service acceptance remain open; separate from Image Connection. |

macOS arm64 has development-build and scoped native evidence, but the new embedded
installer and no-global-Node journey still need acceptance. Windows/Linux resource
builds are not native execution evidence. The reviewed `pi-ask-question` subset has
SDK tests; native question interaction and restoration remain open. None of these
checks establishes a universal canvas-size or performance limit.

The earlier [design acceptance](.agents/notes/implemented/testing/2026-09-11-complete-design-acceptance.md)
and [five-Agent matrix](.agents/notes/implemented/testing/2026-09-11-installed-five-agent-matrix.md)
are historical evidence for the pre-migration runtime. They do not validate the
current embedded engine. See the [review procedure](e2e/DESIGN-ACCEPTANCE.md) for
design review context, not a claim that the migration has passed.

No public release, Developer ID signing, notarization or automatic update channel
is established by the local ad-hoc package checks.

## Run locally

Use Node.js `>=22.14.0 <23 || >=23.6.0` (Node-API 10) and the repository-pinned pnpm through Corepack:

```sh
git clone --recurse-submodules https://github.com/LeonEthan/molly-design.git
cd molly-design
corepack pnpm install
corepack pnpm start:local
```

Configure the bundled engine's model connection in Settings as above; installing
an external Agent CLI is not the new execution path. The Node requirement here is
for source development. The OSS desktop uses local
product storage; it does not sign in to Lody's hosted workspace or provide its web,
mobile, team-sharing or cloud features.

Molly has a separate application identity (`dev.molly-design.app`, `molly-design://`).
Owned workspace packages use `@molly/*`; environment options use `MOLLY_*`
with `LODY_*` read aliases (new names take precedence). External ACP protocol
names remain unchanged. No automatic
migration or deletion of Lody data is performed.

See the [embedded runtime README](apps/cli/README.md) for internal architecture and
[CONTRIBUTING.md](CONTRIBUTING.md) for inherited contribution terms and development
checks. This repository README is Molly's public help entry; `site-docs` retains
upstream Lody website material and is not the Molly feature reference.

## Back up, uninstall and recover data

Finish active work, resolve save errors and quit Molly before copying data. Back up
the complete desktop profile, local service data and any external project/artwork
directories together, not just a conversation JSONL file. With no path overrides,
the macOS locations are:

| Location                                     | Contents                                                                                                                |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `~/Library/Application Support/Molly Design` | Desktop profile, including the encrypted `secrets/model-connections.enc` store.                                         |
| `~/.molly`                                   | Local service data; managed Pi configuration, cache, native sessions and run/operation receipts are under `harness/pi`. |
| Your chosen project directories              | Project files and artwork assets stored outside those application directories.                                          |

`MOLLY_DATA_DIR`, `MOLLY_ELECTRON_USER_DATA_DIR` or `--user-data-dir` can change
these locations. A copied encrypted credential store is not guaranteed to work on
another machine or OS account; re-enter credentials through Settings if needed.
Protect backups as sensitive data: migration to encrypted new writes does not
erase historical plaintext from older backups or replicated history.

Removing the application is not a data reset. On macOS, quit and move only the app
to Trash if you want to retain data. Permanent data removal requires separately
identifying and backing up the intended profile and projects. Leave Lody data,
external CLI homes and user repositories alone. Removing local credentials does
not revoke provider-side keys.

There is no verified one-click downgrade. Do not open a newly migrated profile
with an older writable binary: strict readers may reject newer records. Restore
only a separately preserved backup whose compatibility has been checked; do not
copy encrypted keys back into legacy plaintext settings.

## Repository

- `apps/cli` — Agent execution and local design persistence
- `apps/electron` — Molly desktop application
- `packages/components` — Reused workspace interface
- `packages/design-bento` — Pinned Bento editor and rendering resources
- `packages/design-authoring` — YAML artwork conversion and Agent skills
- `packages/harness-pi` — Pinned embedded engine and reviewed bundled resources
- `packages/platform` — Platform capabilities and ports
- `packages/shared` — Shared schemas and protocols
- `packages/cloud-api` — Optional-cloud DTOs; no hosted backend is included
- `packages/acp-extension-{core,kimi}` — ACP extension submodules

## Source and licenses

Molly is an independent derivative work based on [Lody](https://github.com/LodyAI/Lody).
Lody's upstream authorship, [Apache-2.0 license](LICENSE) and attribution notices
remain intact; see [NOTICE](NOTICE) for the source summary. The current Molly mark —
a single handwritten stroke forming an M with a gentle lead-in, drawn in ink on a
ruled-paper tile — and the typographic opening are authored for Molly;
legacy upstream artwork retains its original attribution. Visual acceptance of
the new identity is tracked with the independent-release work.
Authoring and editor adapters come from
`agentic-listing-design`;
[Bento provenance and license details](packages/design-bento/README.md) and
[authoring provenance](packages/design-authoring/README.md) identify their sources.
The app's Open Source Licenses entry retains dependency notices.
Embedded-engine packaging is described in [its README](packages/harness-pi/README.md);
the selected community extension records its version, source and adaptations in
the [manifest](packages/harness-pi/vendor/pi-ask-question/manifest.json) and retains
its [MIT license](packages/harness-pi/vendor/pi-ask-question/LICENSE).

For new Molly problems or proposals, use
[Molly Issues](https://github.com/LeonEthan/molly-design/issues).
