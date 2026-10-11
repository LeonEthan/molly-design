# Browser cookie reader

Follow the Electron and root guidelines. Pin the upstream archive, patch and Rust compiler;
verify staged bytes before use and after signing. This macOS N-API addon runs in Molly's
main process and uses Security.framework directly. Never fall back to an external Keychain
helper or an unpatched package. Keep keys native, request-scoped and zeroized.
Cancellation revokes the operation but cannot dismiss a system Keychain prompt. Never start
a second native read until the first settles. Use synthetic fixtures, never captured accounts.
