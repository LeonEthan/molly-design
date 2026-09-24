# Molly independent brand and desktop first release

Status: draft
Previous approval: [2026-09-21 owner approval at a7a297ae](../.agents/notes/implemented/process/2026-09-24-github-repository-rebuild.md#pr-52-owner-approval)
Translation: current

[中文](molly-design-independent-release.zh.md)

As of 2026-09-21, Linux desktop support is retired, including packaging, updates and desktop-file integration. Intel macOS and Windows retain experimental local builds; official release scope remains macOS arm64. Ubuntu CI runners and cross-platform resource-integrity checks remain infrastructure, not a support commitment.

Issue: [#32](https://github.com/LeonEthan/molly-design/issues/32)

## 2026-09-17 naming-unification revision proposal (pending review)

The target spelling has been confirmed as `Molly` / `molly`. The implemented [naming-unification decision](../.agents/notes/implemented/feature/2026-09-17-molly-namespace-convergence.zh.md) proposes converging the current product display name to Molly, and unifying first-party packages, code identifiers, environment variables and newly written formats/paths under the molly naming. If this revision is adopted, the "item-by-item rulings on internal names" below are refined by that proposal, and the exclusion "no blanket rename of internal packages" changes to: first-party internal packages are included; external protocols and provenance are not.

Old artworks, attachments, drafts, settings and sessions must remain readable; new writes use the new names. Genuine upstream attribution, third-party ACP protocols and historical evidence keep their original names; existing Molly installation identities, data locations, repositories and update channels are not changed again just to shorten the display name. See the proposal for the concrete read-back, conflict handling, slicing and acceptance.

This section is a pending revision; the body below keeps the earlier first-release scope for comparison and does not silently rewrite old commitments. The current design spec's `geon-canvas/1` contract has not changed; adopting a new format requires revising the affected Chinese and English specs and re-approval. This round only proposes the plan — no implementation, no public release, and no whole-spec approval.

## Problem Statement

Users want Molly released as an independent graphic-design desktop application. The current version already has its own primary installation identity and data directory, but the icon, first-run onboarding show, some copy, background runtime traces and release configuration still carry obvious Lody product identity. Users also do not need a standalone CLI product: using the design workbench must not require installing or operating a command-line tool.

Replacing only the home-page name cannot complete the independence: the first-run experience, error messages, public runtime downloads, application updates and release pages all shape the user's judgment of which product they have. Blanket-replacing every Lody string, on the other hand, could break existing Molly data, depended-upon protocols and accurate open-source attribution.

## Solution

Molly ships independently with its own brand, support entry, resource distribution and in-app automatic update capability. The first release keeps the macOS arm64 support scope; independent branding, onboarding, external interfaces, distribution and support entries are all preconditions of the first release.

Re-create the logo, icons, first-run onboarding animation, music and interaction sounds, uniformly following the "paper and typography: a restrained, refined design workbench" direction. The first opening plays music automatically, with mute and skip provided; later launches do not auto-replay. Users complete configuration, creation and updates through the desktop app; no standalone CLI product is offered.

Molly installs independently of Lody and does not read or migrate Lody data, while protecting existing Molly data. Internal compatibility names are ruled on item by item; keep accurate licenses, authorship and upstream provenance; the README can explain the open-source origins in one place.

## User Stories

1. As a new user, I want the installer and the app both clearly named Molly, so that I can be sure I installed an independent product.
2. As a user, I want the Dock, windows, installer and in-app surfaces to use the new icon consistently, so that I can recognize Molly.
3. As a user, I want the logo legible at small sizes and on dark and light backgrounds, so that I can identify it quickly in daily use.
4. As a new user, I want the opening to revolve around paper, typography and design creation, so that I understand what the product is for.
5. As a new user, I want to see animation and design works made for Molly, so that I get an independent brand experience. The four acts show a poster, editorial publishing, brand visuals and an e-commerce product detail page (such as an Amazon A+ image), each with different imagery and matching copy. The works use diverse palettes, fonts, imagery and composition, and through a unified opening frame form a progression from single-piece expression, content layout and visual systems to commercial product narrative.
6. As a new user, I want the first opening to play Molly's music automatically, so that I experience the animation and score in full.
7. As a user, I want to mute at any time, so that I can use the app where sound is inappropriate.
8. As a user, I want to skip the opening immediately, so that I can go straight to the necessary configuration and creation.
9. As a user who prefers reduced motion, I want to still enter the app smoothly, so that I need not watch the full animation.
10. As a returning user, I want the opening not to auto-replay, so that I can resume work quickly.
11. As a user, I want the music to stop when I leave onboarding, so that no residual sound interferes.
12. As a new user, I want the onboarding examples to be design works rather than coding tasks, so that I can start my first artwork.
13. As a user, I want to keep using the existing Agent configuration and artwork creation flow, so that the brand change adds no mandatory steps.
14. As a user, I want menus, settings, notifications and loading states to use Molly uniformly, so that the product identity stays consistent.
15. As a user hitting a problem, I want crash, recovery and install-wait reports to clearly belong to Molly, so that I seek support in the right place.
16. As a Chinese or English user, I want the product name and descriptions consistent across both language versions, so that I am not misled by the old brand.
17. As a user of assistive technology, I want icon labels and onboarding controls accurate and operable, so that I can use the app independently.
18. As a user, I want help, feedback and update notes to point at Molly, so that I find information for the right product.
19. As a user, I want reachable shared artifacts and QR codes not to advertise Lody, so that shared content matches the current product.
20. As a designer, I want ordinary design exports to carry no new brand watermark, so that my work's content is preserved.
21. As a desktop user, I want to never install or operate a standalone CLI, so that all daily operations happen inside Molly.
22. As a desktop user, I want the internal Agent execution capability to keep working, so that removing the CLI product entry does not affect creation.
23. As a user with both Molly and Lody installed, I want the two not to fight over protocols, process state or data, so that I can use them independently.
24. As an existing Molly user, I want my artworks, attachments, drafts, settings and design sessions still readable after the update, so that I can keep working.
25. As a user, I want Molly not to read or migrate Lody data, so that the product data boundary is clear.
26. As a new user, I want Agent installation resources to come from a Molly-controlled distribution address, so that the installation service belongs to the same product.
27. As a user, I want accurate feedback when a resource download fails or fails verification, so that I can recover the installation instead of using a corrupted resource.
28. As a user, I want to obtain and install new versions inside Molly, so that I need not hunt for a replacement installer manually.
29. As a user, I want updates to accept only trusted artifacts applicable to Molly and the current platform, so that I do not install another product or a corrupted build.
30. As a user in the middle of creating, I want updates not to lose edits or interrupt a running Agent, so that my work is preserved.
31. As a user whose update failed, I want the existing app and data to remain usable, so that I can retry later.
32. As a downloader, I want the release page, installer and checksum files to uniformly belong to Molly, so that I can verify the version and origin.
33. As an open-source user, I want to see accurate upstream origins and asset attribution, so that I understand the product's open-source foundations.
34. As a maintainer, I want the retained internal compatibility names to have explicit reasons, so that later changes do not break protocols or old data.

## Implementation Decisions

- **Brand boundary**: user-visible product identity uses Molly throughout; internal package names, protocols and historical records are not blanket string-replaced. Normal, failure and recovery entries are all in scope.
- **Visuals and sound**: produce Molly's own logo, wordmark and platform icons, covering the actual packaging and in-app consumers. Redo the onboarding storyboard, illustrations, music and interaction sounds; the current score is code-synthesized, so the work must not be misunderstood as merely swapping audio files. Concrete graphics, melody and durations are decided by later asset design.
- **Onboarding integration**: reuse the existing first-run state, Agent configuration and first-artwork creation capability; add no mandatory configuration page. Keep skip, mute and reduced motion; auto-play on first run, stop on exit, and never auto-replay on later launches. When the platform blocks autoplay, provide a clear way to enable it without blocking use.
- **CLI removal**: drop the standalone CLI distribution, install instructions and user product entry; do not build another Molly CLI. Keep the Agent execution, local service and internal launch mechanisms the desktop depends on; do not equate a directory named CLI with being able to delete the whole implementation.
- **Identity and data**: keep the already-independent application identity, protocol and primary data root. Sweep for hardcoded old paths, attachment directories, auto-launch arguments and newly written identities. For data already produced by Molly under old names, keep compatible read-back or safely migrate based on true ownership; never scan, import or overwrite Lody user data.
- **Resource distribution**: public Agent runtimes are distributed from Molly-controlled addresses and releases, keeping versioned resources and integrity verification. Continuing to reuse the genuine upstream adapters is allowed; do not copy or arbitrarily modify their version protocols. The concrete hosting vendor and domain are not specified in this spec.
- **Automatic updates**: the first version provides in-app automatic updates, reusing the existing desktop update service and platform bridges, and establishing Molly's update metadata, artifact verification and release chain. The current local-build policy of disabling updates needs explicit revision; do not merely swap the feed address or unconditionally enable an inherited channel.
- **Update protection**: updates must verify product, version, platform and artifact integrity/trusted identity; wrong-origin or invalid artifacts must not install. Before installing or restarting, ensure manual edits are saved and Agent execution and artifact processing have ended; otherwise defer the install. Failures must preserve the existing usable app and user data, avoiding silent restarts or destroying existing work.
- **Public entries and releases**: straighten out release titles, artifact names, installer metadata, maintainer info, help, feedback and product documentation; remove leftover Lody product update sources. Clearly distinguish the current workflow's actual release repository from leftover base configuration.
- **Scope cleanup**: share cards, cloud pages and legacy onboarding components are first checked for local reachability; old-brand resources with no consumers may be removed, and no features are invented for nonexistent entries.
- **Provenance**: keep accurate LICENSE, applicable attribution, dependency origins and historical authorship; record the provenance of new assets. Product publisher information uses the actual Molly publishing identity; a brand change must not rewrite historical authorship.
- **Contract synchronization**: during implementation, update the affected CLI product-positioning, platform download/update and public-boundary rules. Automatic updates and public resource downloads do not authorize product-cloud sign-in, telemetry or other hosted business. Any revision to an approved Spec's behavior returns it to draft, preserving the previously approved scope and historical facts.

## Testing Decisions

- **Primary acceptance boundary**: the final macOS arm64 installer and user operations are primary, reusing the existing Electron harness, first-run onboarding page driver, isolated user profiles and design journeys. Cover fresh launch, the opening, Agent setup, first artwork, manual editing, save, reopen and export along the same installer boundary; add no parallel test framework for the brand change.
- **Upgrade scenario**: with two distinguishable Molly versions, complete one real in-app update install and reopen, verifying artworks, assets, attachments, settings and design sessions are preserved. Use an isolated, controlled test update source; do not publish test builds to ordinary users.
- **Abnormal updates**: reuse the existing Sparkle policy, events and packaging-verification test boundaries; with deterministic events and locally synthesized artifacts, verify unavailable updates, download failures, verification failures, wrong product/platform, deferred install during execution, and data preservation after failure. Only failures that are hard to reproduce reliably in the installer journey are pushed down to these existing boundaries.
- **Isolation and compatibility**: test that Molly and Lody coexist without seizing protocols or storage; use synthetic old Molly data to verify attachments and drafts on old naming paths remain readable. Use explicitly marked other-product data to prove it is not scanned or migrated.
- **Sound and accessibility**: verify first auto-play, mute, skip, stop-after-exit, no auto-replay on the next launch, and the entry shown when autoplay is blocked; check keyboard and reduced motion. Listening experience and animation quality are judged by humans; the presence of DOM or static assets does not count as the experience passing.
- **Brand acceptance**: humans verify the system icon, installer, onboarding, dark/light themes, small sizes, Chinese and English, and failure dialogs; static scanning is only for finding omissions, and zero Lody hits across the repo is not the pass condition. Reachable share and help entries are checked against their actual consumers.
- **Distribution acceptance**: a controlled resource service covers success, network failure and integrity failure; additionally verify the real availability of Molly's public resource release chain at the end. Automated unit tests do not depend on the public internet, real waiting or scheduler luck, and use injected clocks, synthetic assets and explicit state.
- **Test quality**: assert user-observable results, data read-back and explicit failures; do not assert mock call counts or merely restate the implementation. The existing autosave, serial editing, commit, export and recovery journeys serve as the regression basis; brand and new-update acceptance cannot substitute old-package results.
- **Delivery checks**: complete the type, static, test, format, documentation and public-boundary checks corresponding to the change; record test artifact identities and evidence limits. Automated results replace neither visual/auditory judgment nor release authorization.

## Out of Scope

- A standalone CLI product, and deleting or rewriting the whole background execution module.
- Importing or automatically migrating Lody user data; rewriting upstream Git history, authorship, licenses or third-party agreements.
- Blanket-renaming all internal packages, external protocols, or every Lody string in the source.
- Redesigning the Agent lifecycle, the Bento editor, design persistence or the already-accepted authoring contracts.
- Adding a product cloud, accounts, billing, telemetry, mobile or Web products.
- Expanding Windows/Linux or macOS Intel into the first-release real-machine support scope.
- Building a full marketing website, buying domains, setting up paid hosting, purchasing signing certificates or publicly releasing the app; none of these actions is authorized by this spec-release request.

## Further Notes

This spec consolidates product choices already made and authorizes publishing the spec to the Issue tracker; it does not constitute completed runtime implementation, whole-local-Spec approval, or authorization to publicly release the app. The Issue uses `ready-for-agent`, the local document remains draft, and later implementation records stay consistent with actual evidence.

Developer ID signing and macOS notarization remain recommended release preparation and have not been separately confirmed this round as available or completed; the implementer must list the required publisher identity, certificates and accounts. Trusted verification of update artifacts is required by this spec; the existence of a checksum file cannot substitute for trusted-publisher verification. Final visual assets, hosting locations and release credentials are not fabricated as already-decided solutions.

This spec adds independent-brand and automatic-update requirements beyond the T26 brand-and-help scope, the T23 first-design-onboarding scope and the T29 acceptance records; old acceptance does not automatically cover the new scope. The existing primary-data isolation is already implemented, but a few old paths still need checking; the existence of an inherited update address does not prove the current local app updates across products.

Design behavior follows the [design platform spec](graphic-design-platform.md). Source-code basis, relationships to earlier decisions and this round's progress are recorded in the [independent-release proposal](../.agents/notes/proposed/feature/2026-09-13-geon-independent-brand-release.zh.md). Related Issues: [T26](https://github.com/LeonEthan/molly-design/issues/28), [T29](https://github.com/LeonEthan/molly-design/issues/31). This round completed only documentation and tracker operations; no new installer acceptance was run.

## 2026-09-20 repository convergence implementation

The first release remains limited to macOS arm64; the release workflow has been converged to that target, and other platforms keep local experimental builds without a formal support commitment. The default workspace initializes only ACP core, the DSH capability contracts and Bento; DSH still has shared-layer consumers and is not removed for now. Retained old adapters and the Lody website keep their provenance records but leave the default dependency install and checks. The independent contribution entry, source authorization and maintenance boundaries are recorded in the [implementation note](../.agents/notes/implemented/process/2026-09-20-independent-repository-convergence.zh.md).

These repository changes constitute neither a public release, signing, notarization or real upgrade acceptance, nor a whole-Spec approval.
