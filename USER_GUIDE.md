# Molly user guide

[简体中文](USER_GUIDE.zh-CN.md) · [Project overview](README.md)

## Install the macOS package

The local build produces `MollyDesign-<version>-arm64.dmg` (macOS, Apple Silicon).
Open the DMG and copy **Molly.app** to a folder you own; it does not replace or
modify other applications. The package is ad-hoc signed and not notarized: on first
launch, right-click the app and choose **Open**, then confirm. Do not disable
Gatekeeper or remove quarantine attributes to run it.

On first launch macOS asks whether Molly may use its "Molly Safe Storage" keychain
entry, which protects saved connection credentials. In a consistently signed build,
**Always Allow** keeps saved connections readable across restarts; **Allow** grants
once, and **Deny** leaves the
app usable but unable to read saved connections while access is denied; the store is
preserved and macOS asks again on the next launch.
Ad-hoc local builds do not share a stable signing identity. macOS can ask again
after a rebuild and even repeatedly for subsequent accesses if **Allow** grants
only one access. Repeated prompts are not the intended account-import experience.
Ad-hoc builds keep browser sessions in memory and disable browser account import;
use a consistently signed build for that test. A pending prompt can leave the
app and automation interfaces unresponsive.

## Configure connections

1. Open Settings → AI models → Models, pick the provider/product tile. For OpenAI you can
   either **Sign in with ChatGPT** through OpenAI's official dynamic-client flow
   or paste an API key. Kimi Code also offers account sign-in: open the verification page
   and enter the displayed device code. Tokens stay in the encrypted local vault.
   Other providers take a key. Molly suggests the provider's default
   endpoint and a connection name; change either one, or choose **Use a custom endpoint**.
   With the default, each model uses its provider's own address (OpenRouter's Claude models
   included); a custom endpoint receives every model's requests. Once the key settles, Molly
   checks it for free against the provider's model list (OpenRouter: its key endpoint) and
   shows the result; it sends no model request, so billing and access to a particular model
   stay unverified, and some services can't be checked this way. Under **Models in the
   conversation picker** keep **All** or **Choose** the models you want to pick from; models
   the provider didn't list for your key are marked and sorted last. Enter keys only in the
   local settings field, never in a conversation or artwork file. Saving encrypts the
   connection and doesn't change an existing session's selection; **Delete** removes a
   connection after you confirm. Sign-out, deletion, key conversion and account replacement attempt
   provider revocation before local removal, even when the revocation endpoint is unavailable.
   Signing in from **Edit** updates that exact connection; a conflicting provider account
   must be handled separately. **Sign in again** preserves the connection used by existing
   sessions and the saved OpenAI client registration. Its verified account identity and encrypted
   ID-token hint survive token refresh. **Sign out** clears all OpenAI tokens, keeps its
   registration in a disabled row, and reports if remote revocation could not be confirmed.
   Use **Edit → Sign in again** to reconnect, then enable the connection when ready.
   **Delete** forgets that local registration; it does not unregister the remote client.
   Cleanup and replacement target refresh tokens, including new sessions under the same client.
   Cancel before account replacement begins; revocation and saving finish once started. ChatGPT sign-in
   uses OpenAI's direct API token scope, with main-process authorization and pinned pi-ai refresh/inference; live sign-in
   and service behavior remain unverified in this build.
2. For Kimi membership credentials, select **Kimi Code (membership API key)**,
   not Moonshot Open Platform. In the conversation composer choose Molly and an
   explicit connection, model and supported thinking level. Missing or invalid
   selections fail rather than silently switching providers or models.
3. Optionally set up Settings → AI models → Image generation separately. Supply
   an OpenAI Images-compatible API root (without `/images/generations` or
   `/images/edits`), key and exact model, and save; the row's switch turns it on
   or off. Molly checks the key against the service's free `/models` list and
   offers the models it lists as suggestions; a passing check does not verify
   generation, editing or masks. DashScope is never checked, because every request
   there is billed. The row's menu removes the connection and its key after a
   confirmation; the section then returns to its set-up state.
   Image services support HTTPS, or HTTP at localhost and RFC1918 IPv4 literals.
   HTTP sends the key and image data without TLS encryption;
   use it only for a trusted local service. Public HTTP and named LAN HTTP are
   rejected. Changing the address requires re-entering the key. Language-model
   and MCP connections retain their separate HTTPS/loopback restrictions.
4. For external tools, configure Settings → Advanced → MCP servers and select
   the servers for the turn. Saving does not test or automatically select them.
   A stdio server runs local code: configure only commands and servers you trust.

The row at the top of Settings → AI models summarises Models, Image generation and
Pinterest; click an item to reach its setting (Pinterest opens its sign-in page
inside Molly). A tick means a saved, switched-on
setup, not a tested one. Pinterest never shows a tick, because stored cookies do
not prove you are signed in.

Settings → Advanced → System → Engine details lists the Pi engine and every bundled
add-on (helper agents, skills, questions for you, skill mentions, fast file search
and the safety net) with package, version and licence. It reports what ships, not
live session activation. The question add-on requires the desktop question
interface; necessary Slash-command mapping remains unfinished.
There is no user plugin installation required for the bundled engine.

For **OpenAI-compatible (advanced)**, enter the endpoint and an API key if required, then **Discover models
from this service**: Molly asks the service for its model list, hides non-chat models,
prefills what the response carries and completes known models from a packaged
[models.dev](https://models.dev) snapshot. Pick the models to use; anything the service
and snapshot both miss stays marked **needs details** for you to complete by hand —
declarations are never probed or verified. Ollama and LM Studio connections that require no
key can be saved and used with the key field empty. Editing a saved connection keeps its
key unless you replace it or explicitly choose **Use without an API key**; changing its
destination requires fresh input or that explicit keyless choice. Adding a model manually always works, including
for services without a list endpoint (Azure deployments, z.ai). This path uses standard
Chat Completions streaming, not Responses or vendor-specific thinking formats. Turns
containing tools require declared tool-call support. Saving does not verify these
declarations or select a model; unknown prices remain unknown. Changing the address or
key clears discovery results and picked discovery drafts; manual declarations stay.

## Try a design

Create a single canvas and try a prompt such as:

> Create an 800 × 600 workshop poster. Use a dark blue background, a large “Make
> something” heading, and the subtitle “Saturday · 14:00”. Keep the text editable.

Then try:

> Make the heading smaller and give the subtitle more space. Keep the canvas size.

You can also select and edit text, change colors, insert an image and adjust the
layout directly in Bento. Save the design before exporting PNG or JPEG at 1×, 2× or 3×. Generated
images are optional; text and shape design does not require an image service.

Open **Layers** in the canvas dock to pick an element by name, change its stacking
order, or type an exact position, size, rotation, opacity, line height or letter
spacing. Before each Molly turn that starts from existing artwork, History keeps a
"Before Molly's edit" version you can return to. The size menu also offers print
sheets (A4, A5, A3, US Letter and business card) as pixel sizes; there is no bleed
or millimetre unit.

## Built-in browser research (current development build)

In a design session, the `molly_browser` tools control only the page in Molly's Browser sidebar through the existing tool permission flow. Browsing has no per-site authorization scope. Navigation and selected-image fetching follow your normal network, including proxies and TUN, without a DNS setup step. Opening the Browser sidebar shows the same page. **Take control** pauses Agent reading and actions while you sign in or complete MFA; **Resume Agent** lets it observe again. A dispatched click cannot be undone by takeover. If an operation returns an uncertain result, the Agent must observe before deciding what to do next; Molly does not automatically repeat the action or block browsing for the rest of the task.

Open **Settings → Website accounts → Import from browser…**, the Browser sidebar's
**⋯ → Import from browser…**, or the Pinterest item in Settings → AI models. Choose
a browser, then **Import**. Molly reads its profiles after that click and requests
system access when needed. One profile continues automatically; if several exist,
choose the intended profile in the same dialog and **Import**. The website list starts
collapsed with all 27 design and commerce platforms selected; expand it to deselect
websites or inspect the included domains. It resets on each opening. Only Cookie
login data is transferred; there is no password, history or extension import.

Import supports Chrome, Edge, Brave, Arc, Vivaldi, Opera and Chromium on macOS with
secure storage. The source browser may stay open. Unpackaged development imports
last until Molly quits; persistent import requires a stably signed package.
macOS may ask for browser-data and Keychain access. Enter your Mac password only
in the system prompt, which is requested by Molly itself. A retained Keychain grant
can reduce subsequent prompts, but system policy and changed signatures may prompt
again. Cancel revokes a pending import; it cannot dismiss an OS prompt. Finish or
dismiss that prompt before retrying. Do not grant a generic `security` helper
permanent access for this flow.

When you approve a system prompt while import is pending, it continues automatically.
An OS denial or cancellation retains your selections for retry. Closing the dialog
resets its website choices the next time you open it. If macOS has blocked
browser-data access, Molly guides you to **System Settings → Privacy & Security →
App Data**: turn Molly on there, then return to Molly. After you return, Molly checks
again and imports without another click. If access is still blocked, choose
**Restart Molly and import**; Molly restarts once Agent work and design saving finish,
then choose **Import** again. Molly does not otherwise retry a denied request.
Keychain denial and other read failures show their own reason. In development macOS can
attribute browser-data access to the terminal or coding agent that launched Molly.
The system may decline to show an approval prompt for that launcher; use the System
Settings action offered by the failed import in that case.
Failed listing does not establish that profiles are absent.

Agents remain available while you choose a profile or answer authorization prompts.
The write phase pauses Agents and reopens embedded pages; Agents do not restart
automatically. Import updates matching cookies and
keeps other Molly data. Expired and partitioned source cookies are skipped and
reported. A failed write restores and verifies the previous cookies; if recovery
cannot be verified, browsing stays paused until you clear website data. **Clear
website data** removes cookies, local storage and caches for every website in Molly,
without changing your source browser. It does not guarantee server-side logout.

Open the website to verify sign-in after import. Device-bound credentials cannot
be transferred, and a website may request login or MFA. The curated catalog covers
13 design platforms and 14 commerce platforms including Amazon, Shopify, Etsy,
TikTok Shop, Shopee and Lazada; it does not certify live login compatibility. The
synthetic tests cover import isolation, merge, rollback and cancellation.
The [permission-intent revision](.agents/notes/implemented/bug-fix/2026-10-11-browser-import-intent-permissions.md)
records successful real Chrome/Pinterest import, website sign-in and denied-file
settings recovery without a profile refresh. First-prompt grant continuation and
Developer ID distribution/upgrades remain unverified. Safari, Firefox and import
on other operating systems are unsupported.

Agent image saving accepts decoded PNG/JPEG/GIF into the current design's `media/`.
WebP/AVIF remain unsupported by that asset path. Native page downloads remain
separate and do not automatically become design assets.

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
Detailed implementation and package records are local-only; the supported scope
and remaining limits are summarized here.

| Connection                                            | Current evidence and limits                                                                                                                                                                                                                                                             |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kimi Code `k3-256k/high`                              | Real text turns, design creation/revision, cancellation and legacy-session continuation verified on local installed builds; the final package re-verified rendering, edit/save/export and continuation routing without new paid calls. Not complete vendor or journey coverage.         |
| Configured Images-compatible `gpt-image-2.5-sunburst` | Real generation and edit outputs verified on a local installed build within one artwork; the final package re-verified rendering of those assets. The full mask, multiple-image, JPEG, long-image and human visual matrix remains open. This is a tested user selection, not a default. |
| Other named model presets                             | Pinned SDK catalog and code/offline checks do not prove real-account, regional or product compatibility.                                                                                                                                                                                |
| Advanced OpenAI-compatible language models            | Explicit model form, encrypted persistence and standard Chat Completions SDK path have synthetic coverage. Native UI and real-service acceptance remain open; separate from image generation.                                                                                           |

The macOS arm64 delivery package was verified from a DMG-installed copy: first launch,
session reopening, artwork rendering (including previously generated images), manual
edit and autosave, PNG export, legacy-continuation canvas routing and restart
persistence. Configured-model turns were verified on earlier installed builds.
Real image generation/editing in one artwork, including the retry-authorization
disclosure, and legacy continuation on a hybrid package were verified separately.
Windows resource builds are not native execution evidence. Linux desktop support
is retired; Linux CI and resource-integrity checks do not imply product support. Questions now use the unmodified
`rpiv-ask-user-question` package with SDK tests; installed-build question interaction
and restoration across restarts remain open. None of these
checks establishes a universal canvas-size or performance limit.

Deferred beyond this delivery: Google acceptance, the plugin
slash-command system, complex image composition (masks, multiple reference images,
format matrices), dedicated cross-platform acceptance, long-term performance testing,
and bundled-Pi upgrade/uninstall drills.

Earlier design acceptance and the five-Agent matrix are historical evidence for
the pre-migration runtime. They do not validate the
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
