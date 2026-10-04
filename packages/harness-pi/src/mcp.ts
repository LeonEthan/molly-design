import type { McpServer } from '@agentclientprotocol/sdk';
import {
  createCodemodeExtension,
  createMcpExtension,
  createToolSearchExtension,
  DefaultPackageManager,
  getPackageDir,
  type ExtensionAPI,
  type InlineExtension,
  type SettingsManager,
} from '@earendil-works/pi-coding-agent';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  isMcpExposure,
  isMcpToolExposureRules,
  McpCredentialBindingSchema,
  StoredMcpCredentialSchema,
  mcpCredentialMatchesServer,
  toPiToolExposure,
} from '@molly/shared/embedded-harness';

type NativeMcpServerConfig = Parameters<ExtensionAPI['registerMcpServer']>[1];

function assertLiteralPath(value: string): void {
  if (
    value === '~' ||
    value.startsWith('~/') ||
    (process.platform === 'win32' && value.startsWith('~\\'))
  )
    throw new Error('pi_acp_mcp_literal_target_unsupported');
}

function literalConfigValue(value: string): string {
  const escaped = value.replaceAll('$', () => '$$');
  return escaped.startsWith('!') ? `$${escaped}` : escaped;
}

export function acpMcpConfig(
  servers: readonly McpServer[],
  cwd: string,
  credentials: readonly ReturnType<typeof StoredMcpCredentialSchema.parse>[] = []
): { name: string; config: NativeMcpServerConfig }[] {
  assertLiteralPath(cwd);
  const names = new Set<string>();
  const used = new Set<(typeof credentials)[number]>();
  const result = servers.map((server): { name: string; config: NativeMcpServerConfig } => {
    if (!server.name.trim() || names.has(server.name))
      throw new Error('pi_acp_mcp_server_identity');
    const raw = server._meta?.mollyMcpCredential;
    if (raw !== undefined && !credentials.length)
      throw new Error('pi_acp_protected_mcp_not_integrated');
    const binding = raw === undefined ? undefined : McpCredentialBindingSchema.parse(raw);
    const credential = binding
      ? credentials.find((entry) => JSON.stringify(entry.connection) === JSON.stringify(binding))
      : undefined;
    if (binding && (!credential || !mcpCredentialMatchesServer(binding, server)))
      throw new Error('pi_acp_mcp_credential_mismatch');
    if (credential) {
      StoredMcpCredentialSchema.parse(credential);
      if (used.has(credential)) throw new Error('pi_acp_mcp_credential_reused');
      used.add(credential);
    }
    if ('type' in server && server.type === 'acp')
      throw new Error('pi_acp_mcp_transport_unsupported');
    const rawDescription = server._meta?.mollyMcpDescription;
    if (rawDescription !== undefined && typeof rawDescription !== 'string')
      throw new Error('pi_acp_mcp_description_invalid');
    const { mollyMcpExposure: exposure, mollyMcpToolExposure: toolExposure } = server._meta ?? {};
    if (exposure !== undefined && !isMcpExposure(exposure))
      throw new Error('pi_acp_mcp_exposure_invalid');
    if (toolExposure !== undefined && !isMcpToolExposureRules(toolExposure))
      throw new Error('pi_acp_mcp_exposure_invalid');
    const presentation = {
      ...(rawDescription?.trim() ? { description: rawDescription.trim() } : {}),
      ...(exposure !== undefined ? { exposure } : {}),
      ...(toolExposure !== undefined ? { toolExposure: toPiToolExposure(toolExposure) } : {}),
    };
    names.add(server.name);
    if ('command' in server) {
      for (const value of [server.command, ...server.args]) assertLiteralPath(value);
      const env = server.env.filter(
        ({ name }) => !credential?.connection.fieldNames.includes(name)
      );
      if (new Set(env.map(({ name }) => name)).size !== env.length)
        throw new Error('pi_acp_mcp_duplicate_environment');
      return {
        name: server.name,
        config: {
          ...presentation,
          command: server.command,
          args: [...server.args],
          cwd,
          env: Object.fromEntries(
            [
              ...env.map(({ name, value }) => [name, value] as const),
              ...Object.entries(credential?.values ?? {}),
            ].map(([name, value]) => [name, literalConfigValue(value)])
          ),
        },
      };
    }
    if (server.type !== 'http') throw new Error('pi_acp_mcp_transport_unsupported');
    const fields = new Set(credential?.connection.fieldNames.map((name) => name.toLowerCase()));
    const headers = [
      ...server.headers.filter(({ name }) => !fields.has(name.toLowerCase())),
      ...Object.entries(credential?.values ?? {}).map(([name, value]) => ({ name, value })),
    ];
    if (new Set(headers.map(({ name }) => name.toLowerCase())).size !== headers.length)
      throw new Error('pi_acp_mcp_duplicate_headers');
    return {
      name: server.name,
      config: {
        ...presentation,
        type: 'http',
        url: server.url,
        headers: Object.fromEntries(
          headers.map(({ name, value }) => [name, literalConfigValue(value)])
        ),
      },
    };
  });
  if (used.size !== credentials.length) throw new Error('pi_acp_mcp_unused_credential');
  return result;
}

async function packageName(directory: string): Promise<string | undefined> {
  for (;;) {
    try {
      const manifest: unknown = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
      return manifest &&
        typeof manifest === 'object' &&
        'name' in manifest &&
        typeof manifest.name === 'string'
        ? manifest.name
        : undefined;
    } catch (error) {
      if (error instanceof SyntaxError) return undefined;
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT')
        throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

export async function rejectAmbientMcp(
  cwd: string,
  agentDir: string,
  settingsManager: SettingsManager
): Promise<void> {
  const nativeEntry = await realpath(join(getPackageDir(), 'dist/extensions/mcp/index.js'));
  const resources = await new DefaultPackageManager({ cwd, agentDir, settingsManager }).resolve(
    async () => 'error'
  );
  for (const resource of resources.extensions.filter((entry) => entry.enabled)) {
    const path = await realpath(resource.path);
    if (
      path === nativeEntry ||
      (await packageName(resource.metadata.packageRoot ?? dirname(path))) === 'pi-mcp-adapter'
    )
      throw new Error('pi_acp_duplicate_mcp');
  }
}

export function createAcpMcpExtensions(
  servers: ReturnType<typeof acpMcpConfig>
): InlineExtension[] {
  return [
    {
      name: 'codemode',
      builtin: true,
      replaceable: true,
      factory: createCodemodeExtension({ models: false }),
    },
    { name: 'tool-search', builtin: true, replaceable: true, factory: createToolSearchExtension() },
    {
      name: 'mcp',
      builtin: true,
      replaceable: true,
      factory: async (pi) => {
        for (const server of servers) pi.registerMcpServer(server.name, server.config);
        await createMcpExtension({ loadConfig: () => ({ servers: [], errors: [] }) })(pi);
      },
    },
  ];
}
