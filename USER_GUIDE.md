# Molly user guide

[简体中文](USER_GUIDE.zh-CN.md) · [Project overview](README.md)

## Install the macOS package

The local build produces `MollyDesign-<version>-arm64.dmg` (macOS, Apple Silicon).
Open the DMG and copy **Molly.app** to a folder you own; it does not replace or
modify other applications. The package is ad-hoc signed and not notarized: on first
launch, right-click the app and choose **Open**, then confirm. Do not disable
Gatekeeper or remove quarantine attributes to run it.

On first launch macOS asks whether Molly may use its "Molly Safe Storage" keychain
entry, which protects saved connection credentials. **Always Allow** keeps saved
connections readable across restarts, **Allow** grants once, and **Deny** leaves the
app usable but unable to read saved connections while access is denied; the store is
preserved and macOS asks again on the next launch.
Ad-hoc local builds do not share a stable signing identity, so macOS asks again for
each new build. Answer this prompt before driving the app through automation
interfaces: a pending prompt can leave them unresponsive.

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

## Troubleshooting

- **First launch appears stalled and automation interfaces do not respond.** A
  pending keychain prompt can explain this; it may sit behind the window. Answer it.
- **Saved connections cannot be read.** Access was denied or the build changed. The
  encrypted store is preserved; authorize the macOS prompt on the next launch, or
  re-enter the connection in Settings. A copied store is not guaranteed to work on
  another machine or OS account.
- **An image call ends with an unknown outcome after a timeout.** Molly keeps the
  receipt, neither retries a possibly-paid request nor reports it as successful.
  Retry only with an explicit new request, which may charge again.
- **The canvas is read-only or a save conflict is reported.** Let the running turn
  finish or stop it and save open canvases first; Molly does not overwrite the
  current artwork with a stale draft. Keep the preserved draft and resolve the
  conflict with a new message.
- **Receipts and logs.** Run and paid-operation receipts live under
  `~/.molly/harness/pi`; desktop and service data locations are listed in the
  backup section below.

## Release status and support limits

The embedded Pi migration has **scoped accepted evidence**, not full acceptance.
Evidence and remaining work are recorded in the
[implementation note](.agents/notes/proposed/architecture/2026-09-19-embedded-pi-harness-implementation.zh.md)
and the [final package delivery note](.agents/notes/implemented/testing/2026-09-20-final-package-delivery.zh.md).

| Connection                                            | Current evidence and limits                                                                                                                                                                                                                                                             |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kimi Code `k3-256k/high`                              | Real text turns, design creation/revision, cancellation and legacy-session continuation verified on local installed builds; the final package re-verified rendering, edit/save/export and continuation routing without new paid calls. Not complete vendor or journey coverage.         |
| Configured Images-compatible `gpt-image-2.5-sunburst` | Real generation and edit outputs verified on a local installed build within one artwork; the final package re-verified rendering of those assets. The full mask, multiple-image, JPEG, long-image and human visual matrix remains open. This is a tested user selection, not a default. |
| Other named model presets                             | Pinned SDK catalog and code/offline checks do not prove real-account, regional or product compatibility.                                                                                                                                                                                |
| Advanced OpenAI-compatible language models            | Explicit model form, encrypted persistence and standard Chat Completions SDK path have synthetic coverage. Native UI and real-service acceptance remain open; separate from Image Connection.                                                                                           |

The macOS arm64 delivery package was verified from a DMG-installed copy: first launch,
session reopening, artwork rendering (including previously generated images), manual
edit and autosave, PNG export, legacy-continuation canvas routing and restart
persistence. Configured-model turns were verified on earlier installed builds
([install and Kimi connection](.agents/notes/implemented/bug-fix/2026-09-20-packaged-helper-startup.zh.md),
[editable artwork journey](.agents/notes/implemented/bug-fix/2026-09-20-editable-design-journey.zh.md)),
real image generation/editing in one artwork
([image journey](.agents/notes/implemented/testing/2026-09-20-image-generate-edit-replace.zh.md),
including its retry-authorization disclosure), and legacy continuation on a hybrid
package
([continuation acceptance](.agents/notes/implemented/testing/2026-09-20-design-session-continuation-acceptance.zh.md)).
Windows resource builds are not native execution evidence. Linux desktop support
is retired; Linux CI and resource-integrity checks do not imply product support. The reviewed `pi-ask-question` subset has
SDK tests, and native question interaction was verified on an installed build;
restoration across restarts remains open. None of these
checks establishes a universal canvas-size or performance limit.

Deferred beyond this delivery: Google and other SDK upgrades, the plugin
slash-command system, complex image composition (masks, multiple reference images,
format matrices), dedicated cross-platform acceptance, long-term performance testing,
and bundled-Pi upgrade/uninstall drills.

The earlier [design acceptance](.agents/notes/implemented/testing/2026-09-11-complete-design-acceptance.md)
and [five-Agent matrix](.agents/notes/implemented/testing/2026-09-11-installed-five-agent-matrix.md)
are historical evidence for the pre-migration runtime. They do not validate the
current embedded engine. See the [review procedure](e2e/DESIGN-ACCEPTANCE.md) for
design review context, not a claim that the migration has passed.

No public release, Developer ID signing, notarization or automatic update channel
is established by the local ad-hoc package checks.

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
