# Retire preview manual refresh and import-as-current-artwork

Status: implemented
Translation: current

[中文](2026-09-18-preview-without-import.zh.md)

## Abstract

The user confirmed the preview panel no longer needs the "Import as current artwork" button, the "Refresh preview" button, or the source-path information banner, and asked to remove the UI together with its owning functionality. This change deletes the entire preview-import chain (the renderer buttons and state, `DesignIpc.importPreview`, `importSourcePreview`, `importDesignSnapshot`, and the import-only snapshot cached on preview views) plus the manual refresh entry, while retaining automatic preview reconciliation driven by opening, file watching, focus, reconnect and finalized turns. Preview and watcher failures are still reported honestly as preview-scoped error alerts instead of the banner; the Spec, the sessions README and the root rules are updated, and the Spec stays draft.

## Removed scope

- `packages/components/src/components/sessions/design-canvas.tsx`: both buttons, `importPreview`, the `previewSource`/`previewIdentity`/`previewStatus` state and the information banner; preview and watcher errors render as `role="alert"` only while Preview is active, with neutral "automatic preview updates unavailable" wording.
- `apps/electron/src/main/ipc/services/design-ipc.ts`: the `importPreview` IPC method.
- `apps/electron/src/main/services/design-source-preview.ts`: `importSourcePreview` and the `snapshot` cache field on preview views; `sourceIdentity` stays for render deduplication and generation checks.
- `apps/electron/src/main/services/design-service.ts`: `importDesignSnapshot`; `designCanvasAccess.replaceAfterFlush` stays because version restore uses it.
- `apps/electron/src/main/services/design-source-preview-verification.ts` and `design-verification.ts`: `verifySourceImport` and its call site.
- Seven dead locale keys (en/zh_CN); the Spec and zh Spec drop the two import bullets and the "no import during a run" sentence, and now state the preview is read-only and automatic with no manual refresh or import entry; the root AGENTS.md drops "External import validates and saves the viewed snapshot directly."

## Retained behavior

Automatic preview reconciliation does not depend on the removed buttons: opening the preview, file-watch pushes, window focus, loro reconnects and finalized turns still trigger `refreshPreview`. Failures retain the last valid preview and surface an error; execution-time read-only gating is unchanged. The "Unsubmitted preview · Read-only" badge inside the native Bento view is unaffected.

## Verification and limits

- The `packages/components` `design-source-preview` (7) and `design-canvas-receipt` (5) tests — 12 total — pass: the import test is replaced by absence assertions for both buttons and the banner, the automatic-preview tests use refresh/attachPreview call counts and the `previewVisible` state, and a new regression asserts preview errors hide when switching to Artwork and clear after successful reconciliation.
- `@molly/components` and `@molly/electron` typecheck pass (exit code 0); `design-canvas-sync-core.test.mjs` passes 19 tests; `docs check`, `check:public-boundary`, `check:code-collab-imports` and `check:platform-boundaries` pass. A full `pnpm check` was not run; `lint:i18n` has two pre-existing missing keys unrelated to this change (`design.sizeMode`, `design.autoSize`, from 8538ae6b).
- The native Electron preview probe `verifySourcePreview` is retained but was not run in this change; the import probe was deleted with the feature, retiring its import-race coverage. The removal is limited to preview import and the banner and does not touch commit, export or version-restore paths.
