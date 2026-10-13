import { describe, expect, it } from 'vitest';
import {
  ImageConnectionEndpointSchema,
  isImageConnectionReady,
  normalizeImageConnectionBaseUrl,
  normalizeImageConnectionSettings,
  PublicImageConnectionSchema,
  toPublicImageConnection,
} from '../src/image-connection';
import {
  BeginOpenAiAuthSchema,
  CheckImageConnectionSchema,
  CheckModelConnectionSchema,
  DiscoverModelConnectionSchema,
  HarnessCredentialRequestSchema,
  HarnessHostExchangeSchema,
  HarnessRunSnapshotSchema,
  ManagedMcpConnectionSchema,
  McpCredentialDestinationSchema,
  ModelConnectionSchema,
  ModelEndpointSchema,
  MOLLY_HARNESS_ID,
  MOLLY_HARNESS_PROTOCOL_VERSION,
  PI_ENGINE_VERSION,
  ProtectedImageConnectionSchema,
  SaveModelConnectionSchema,
  SaveProtectedImageConnectionSchema,
} from '../src/embedded-harness';

const privateEndpoints = [
  'http://10.0.0.1:8080/v1',
  'http://10.255.255.254/v1',
  'http://172.16.0.1/v1',
  'http://172.31.255.254/v1',
  'http://192.168.0.1/v1',
  'http://192.168.255.254/v1',
];

const unsafeEndpoints = [
  'http://203.0.113.20/v1',
  'http://172.15.255.254/v1',
  'http://172.32.0.1/v1',
  'http://192.167.255.254/v1',
  'http://192.169.0.1/v1',
  'http://100.64.0.1/v1',
  'http://100.127.255.254/v1',
  'http://169.254.1.1/v1',
  'http://[fc00::1]:8080/v1',
  'http://[fdff:ffff:ffff:ffff:ffff:ffff:ffff:fffe]/v1',
  'http://[fe80::1]/v1',
  'http://[fbff::1]/v1',
  'http://[fe00::1]/v1',
  'http://[::ffff:192.168.0.1]/v1',
  'http://image-gateway.local/v1',
  'http://image-gateway.internal/v1',
  'http://image-gateway/v1',
  'http://10.1/v1',
  'http://167772161/v1',
  'http://0x0a000001/v1',
  'http://012.0.0.1/v1',
  'http://192.168.0.1./v1',
  'http://user:synthetic-key@192.168.0.1/v1',
  'http://192.168.0.1/v1?key=synthetic-key',
  'http://192.168.0.1/v1#fragment',
  'ftp://192.168.0.1/v1',
  'not a URL',
];

const modelConnection = {
  schemaVersion: 1,
  id: 'model-connection',
  revision: 1,
  providerPresetId: 'openai',
  displayName: 'Synthetic model connection',
  baseUrl: 'https://models.example.invalid/v1',
  credentialRef: 'model-credential',
  enabled: true,
};

const imageConnection = (baseUrl: string, protocol = 'openai-images') => ({
  id: '00000000-0000-4000-8000-000000000001',
  revision: 1,
  enabled: true,
  protocol,
  baseUrl,
  model: 'synthetic-image-model',
  hasApiKey: true,
  legacyHistoryMayContainKey: false,
});

const snapshot = (baseUrl: string, protocol?: string) => ({
  schemaVersion: 1,
  runId: 'synthetic-run',
  runtimeEpoch: 'synthetic-epoch',
  sessionId: 'synthetic-session',
  turnId: 'synthetic-turn',
  connection: modelConnection,
  imageConnection: imageConnection(baseUrl, protocol),
  selection: { connectionId: modelConnection.id, modelId: 'synthetic-model', thinking: 'off' },
  harness: {
    id: MOLLY_HARNESS_ID,
    engine: 'pi',
    engineVersion: PI_ENGINE_VERSION,
    buildId: 'synthetic-build',
    protocolVersion: MOLLY_HARNESS_PROTOCOL_VERSION,
  },
  pluginSetHash: 'a'.repeat(64),
  toolsetHash: 'b'.repeat(64),
  permissionProfileId: 'synthetic-profile',
});

describe('image connection endpoint policy', () => {
  it.each([
    'https://images.example.invalid/v1',
    'https://image-gateway.local/v1',
    'https://[fc00::1]:8080/v1',
    'https://[fdff:ffff:ffff:ffff:ffff:ffff:ffff:fffe]/v1',
    'http://localhost:8080/v1',
    'http://127.0.0.1:8080/v1',
    'http://[::1]:8080/v1',
    ...privateEndpoints,
  ])('accepts the explicitly configured image endpoint %s', (baseUrl) => {
    expect(ImageConnectionEndpointSchema.parse(baseUrl)).toBe(baseUrl);
    expect(normalizeImageConnectionBaseUrl(baseUrl)).toBe(baseUrl);
    expect(
      isImageConnectionReady(
        normalizeImageConnectionSettings({
          v: 1,
          enabled: true,
          baseUrl,
          apiKey: 'synthetic-key',
          model: 'synthetic-image-model',
          updatedAt: 1_700_000_000_000,
        })
      )
    ).toBe(true);
  });

  it.each(unsafeEndpoints)('rejects an ambiguous or unprotected image endpoint %s', (baseUrl) => {
    expect(ImageConnectionEndpointSchema.safeParse(baseUrl).success).toBe(false);
    expect(
      SaveProtectedImageConnectionSchema.safeParse({
        enabled: true,
        baseUrl,
        model: 'synthetic-image-model',
        apiKey: 'synthetic-key',
      }).success
    ).toBe(false);
    expect(CheckImageConnectionSchema.safeParse({ baseUrl, apiKey: 'synthetic-key' }).success).toBe(
      false
    );
    expect(ProtectedImageConnectionSchema.safeParse(imageConnection(baseUrl)).success).toBe(false);
    expect(HarnessRunSnapshotSchema.safeParse(snapshot(baseUrl)).success).toBe(false);
    expect(
      HarnessHostExchangeSchema.safeParse({
        version: 1,
        connections: [],
        reports: [],
        imageConnection: imageConnection(baseUrl),
      }).success
    ).toBe(false);
  });

  it.each(['openai-images', 'dashscope'])(
    'carries private HTTP through the %s image save, check and credential exchange',
    (protocol) => {
      for (const baseUrl of privateEndpoints) {
        const saved = {
          expectedRevision: 1,
          enabled: true,
          protocol,
          baseUrl,
          model: 'synthetic-image-model',
          apiKey: 'synthetic-key',
          clearApiKey: false,
        };
        expect(SaveProtectedImageConnectionSchema.parse(saved)).toEqual(saved);
        const check = { protocol, baseUrl, apiKey: 'synthetic-key' };
        expect(CheckImageConnectionSchema.parse(check)).toEqual(check);
        const storedCheck = { protocol, baseUrl, expectedRevision: 1 };
        expect(CheckImageConnectionSchema.parse(storedCheck)).toEqual(storedCheck);
        const connection = imageConnection(baseUrl, protocol);
        expect(ProtectedImageConnectionSchema.parse(connection)).toEqual(connection);
        const run = snapshot(baseUrl, protocol);
        expect(HarnessRunSnapshotSchema.parse(run)).toEqual(run);
        const request = {
          requestId: '00000000-0000-4000-8000-000000000002',
          snapshot: run,
          imageConnection: connection,
        };
        expect(HarnessCredentialRequestSchema.parse(request)).toEqual(request);
        const host = {
          version: 1,
          connections: [modelConnection],
          reports: [],
          imageConnection: connection,
        };
        expect(HarnessHostExchangeSchema.parse(host)).toEqual(host);
      }
    }
  );
});

describe('image policy isolation', () => {
  it.each(['http://203.0.113.20/v1', 'http://image-gateway.local/v1', 'http://[fd00::1]:8080/v1'])(
    'decodes historical public metadata without granting endpoint authority: %s',
    (baseUrl) => {
      const metadata = {
        enabled: true,
        protocol: 'openai-images',
        baseUrl,
        model: 'synthetic-image-model',
        hasApiKey: true,
        updatedAt: 1_700_000_000_000,
      };
      expect(PublicImageConnectionSchema.parse(metadata)).toEqual(metadata);
      expect(normalizeImageConnectionBaseUrl(baseUrl)).toBe(baseUrl);
      const legacySettings = {
        v: 1,
        enabled: metadata.enabled,
        protocol: metadata.protocol,
        baseUrl,
        apiKey: 'synthetic-key',
        model: metadata.model,
        updatedAt: metadata.updatedAt,
      };
      const decodedSettings = normalizeImageConnectionSettings(legacySettings);
      expect(decodedSettings).toEqual(legacySettings);
      expect(toPublicImageConnection(decodedSettings)).toEqual(metadata);
      expect(isImageConnectionReady(decodedSettings)).toBe(false);
      expect(ProtectedImageConnectionSchema.safeParse(imageConnection(baseUrl)).success).toBe(
        false
      );
      expect(
        SaveProtectedImageConnectionSchema.safeParse({
          enabled: metadata.enabled,
          protocol: metadata.protocol,
          baseUrl,
          model: metadata.model,
          apiKey: 'synthetic-key',
        }).success
      ).toBe(false);
      expect(
        CheckImageConnectionSchema.safeParse({ baseUrl, apiKey: 'synthetic-key' }).success
      ).toBe(false);
      expect(HarnessRunSnapshotSchema.safeParse(snapshot(baseUrl)).success).toBe(false);
      expect(
        HarnessCredentialRequestSchema.safeParse({
          requestId: '00000000-0000-4000-8000-000000000002',
          snapshot: snapshot(baseUrl),
          imageConnection: imageConnection(baseUrl),
        }).success
      ).toBe(false);
    }
  );

  it.each(privateEndpoints)('keeps LAN HTTP out of model, OAuth and MCP inputs: %s', (baseUrl) => {
    const modelSave = {
      providerPresetId: 'openai',
      displayName: 'Synthetic model connection',
      enabled: true,
      baseUrl: modelConnection.baseUrl,
      apiKey: 'synthetic-key',
    };
    const modelCheck = {
      providerPresetId: 'openai',
      baseUrl: modelConnection.baseUrl,
      apiKey: 'synthetic-key',
    };
    const oauthSave = { ...modelSave, apiKey: undefined, authType: 'openai_oauth' };
    const oauthConnection = { ...modelConnection, authType: 'openai_oauth' };
    const mcp = {
      schemaVersion: 1,
      id: 'synthetic-mcp',
      revision: 1,
      enabled: true,
      credentialRefs: {},
      transport: 'streamable-http',
      endpoint: modelConnection.baseUrl,
    };
    expect(SaveModelConnectionSchema.safeParse(modelSave).success).toBe(true);
    expect(CheckModelConnectionSchema.safeParse(modelCheck).success).toBe(true);
    expect(DiscoverModelConnectionSchema.safeParse(modelCheck).success).toBe(true);
    expect(SaveModelConnectionSchema.safeParse(oauthSave).success).toBe(true);
    expect(ModelConnectionSchema.safeParse(oauthConnection).success).toBe(true);
    expect(ManagedMcpConnectionSchema.safeParse(mcp).success).toBe(true);
    expect(ModelEndpointSchema.safeParse(baseUrl).success).toBe(false);
    expect(SaveModelConnectionSchema.safeParse({ ...modelSave, baseUrl }).success).toBe(false);
    expect(CheckModelConnectionSchema.safeParse({ ...modelCheck, baseUrl }).success).toBe(false);
    expect(DiscoverModelConnectionSchema.safeParse({ ...modelCheck, baseUrl }).success).toBe(false);
    expect(SaveModelConnectionSchema.safeParse({ ...oauthSave, baseUrl }).success).toBe(false);
    expect(ModelConnectionSchema.safeParse({ ...oauthConnection, baseUrl }).success).toBe(false);
    expect(BeginOpenAiAuthSchema.safeParse({ provider: 'openai', baseUrl }).success).toBe(false);
    expect(
      McpCredentialDestinationSchema.safeParse({ transport: 'http', url: baseUrl }).success
    ).toBe(false);
    expect(ManagedMcpConnectionSchema.safeParse({ ...mcp, endpoint: baseUrl }).success).toBe(false);
  });
});
