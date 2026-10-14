# Browser cookie reader

Follow the Electron and root guidelines. Pin the upstream archive, patch and Rust compiler;
verify staged bytes before use and after signing. This macOS N-API addon runs in Molly's
main process and uses Security.framework directly. Never fall back to an external Keychain
helper or an unpatched package. Keep keys native, request-scoped and zeroized.
Preserve typed selected-source EPERM/Keychain denial; main exposes safe codes.
Profiles list when the dialog opens, never at cookie import. Main copies the selected
Cookies DB and sidecars to a private temp dir (symlinks refused) and the addon reads that
copy through `fromPath`; the dialog swallows a native EPERM file denial silently.
Molly inventory preserves raw rows for main-side site selection and field validation;
retain row/decryption/host failures and reject lossy expiration conversion. Keep the
ordinary snapshot policy unchanged and apply profile budgets before normalization.
Explicit-path reads must carry the same row-loss warnings as `read`; discovery never
canonicalizes a symlinked user-data root or profile directory into an offered profile.
Cancellation revokes the operation but cannot dismiss a system Keychain prompt. Never start
a second native read until the first settles. Use synthetic fixtures, never captured accounts.
