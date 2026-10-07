const IPC_ERROR_PREFIX = /^(?:Error:\s*)?Error invoking remote method '[^']*':\s*(?:Error:\s*)?/;

/** Electron wraps main-process errors as "Error invoking remote method '…': Error: …". */
export function ipcErrorMessage(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause);
  return raw.replace(IPC_ERROR_PREFIX, '');
}
