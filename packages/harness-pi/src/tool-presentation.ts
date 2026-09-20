import { isAbsolute, resolve } from 'node:path';
import type { ToolCall } from '@agentclientprotocol/sdk';

/** ACP display metadata only; this never grants access or rewrites native arguments. */
export function describeToolCall(
  name: string,
  args: unknown,
  cwd: string
): Pick<ToolCall, 'title' | 'kind' | 'locations' | 'rawInput'> {
  const raw = args && typeof args === 'object' && !Array.isArray(args) ? args : undefined;
  const path = raw && 'path' in raw && typeof raw.path === 'string' ? raw.path : undefined;
  if (['read', 'write', 'edit'].includes(name)) {
    return {
      title: path ? `${name} ${path}` : name,
      kind: name === 'read' ? 'read' : 'edit',
      // Tilde expansion belongs to the SDK. Show it verbatim rather than inventing
      // a local file target with potentially different home-directory semantics.
      locations:
        path && !path.startsWith('~')
          ? [{ path: isAbsolute(path) ? path : resolve(cwd, path) }]
          : undefined,
      rawInput: args,
    };
  }
  if (name === 'bash') {
    const command =
      raw && 'command' in raw && typeof raw.command === 'string' ? raw.command : undefined;
    // The existing pending-permission card displays only the title, not rawInput.
    return { title: command ? `bash: ${command}` : name, kind: 'execute', rawInput: args };
  }
  return { title: name, kind: 'other', rawInput: args };
}
