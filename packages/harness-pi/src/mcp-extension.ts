import { randomUUID } from 'node:crypto';
import type { McpServer } from '@agentclientprotocol/sdk';
import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { createMcpAdapter } from 'pi-mcp-adapter';
import {
  MCP_TOOL_APPROVAL_REQUEST_EVENT,
  type McpToolApprovalRequest,
  type McpConfig,
  type ServerEntry,
} from 'pi-mcp-adapter/types';
import {
  McpCredentialBindingSchema,
  StoredMcpCredentialSchema,
  mcpCredentialMatchesServer,
} from '@molly/shared/embedded-harness';
import { waitForApproval, type ToolApproval } from './approved-tools';
import { createToolEnvironment } from './environment';

export function createMcpConfig(
  servers: readonly McpServer[],
  cwd: string,
  credentials: readonly ReturnType<typeof StoredMcpCredentialSchema.parse>[] = []
): McpConfig {
  const entries = servers.map((server): [string, ServerEntry] => {
    const binding = server._meta?.mollyMcpCredential;
    const credential =
      binding === undefined
        ? undefined
        : credentials.find(
            (entry) =>
              JSON.stringify(entry.connection) ===
              JSON.stringify(McpCredentialBindingSchema.parse(binding))
          );
    if (
      binding !== undefined &&
      (!credential || !mcpCredentialMatchesServer(credential.connection, server))
    )
      throw new Error('harness_mcp_credential_mismatch');
    const values = credential ? StoredMcpCredentialSchema.parse(credential).values : undefined;
    if ('url' in server) {
      return [
        server.name,
        {
          url: server.url,
          httpTransport: server.type === 'sse' ? 'sse' : 'streamable-http',
          headers: Object.fromEntries(
            Object.entries({
              ...Object.fromEntries(server.headers.map(({ name, value }) => [name, value])),
              ...values,
            }).map(([key, value]) => {
              if (/\$\{\w+\}|\$env:\w+|\{env:\w+\}/.test(value))
                throw new Error('harness_mcp_literal_header_unsupported');
              return [key, value.startsWith('!') ? `!${value}` : value];
            })
          ),
          auth: false,
        },
      ];
    }
    if (!('command' in server)) throw new Error('harness_mcp_transport_unsupported');
    return [
      server.name,
      {
        command: server.command,
        args: server.args,
        cwd,
        inheritEnv: false,
        literalEnv: true,
        env: {
          ...createToolEnvironment(process.env),
          ...Object.fromEntries(server.env.map(({ name, value }) => [name, value])),
          ...values,
        },
      },
    ];
  });
  return { mcpServers: Object.fromEntries(entries), settings: { requestTimeoutMs: 210_000 } };
}

export function createMollyMcpExtension(
  config: McpConfig,
  approve: ToolApproval
): ExtensionFactory {
  return async (pi) => {
    pi.events.on(MCP_TOOL_APPROVAL_REQUEST_EVENT, (value: unknown) => {
      const request = value as McpToolApprovalRequest;
      request.claim(async () => {
        const allowed = await waitForApproval(
          approve({
            toolCallId: randomUUID(),
            name: `${request.serverName}/${request.originalToolName}`,
            arguments: request.args,
            signal: request.signal,
          }),
          request.signal
        );
        return allowed && !request.signal?.aborted ? 'allow_once' : 'deny';
      });
    });
    await createMcpAdapter({ config })(pi);
  };
}
