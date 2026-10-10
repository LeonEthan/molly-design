import { describe, expect, it } from 'vitest';
import {
  ModelConnectionSchema,
  SaveModelConnectionSchema,
  getModelConnectionConfigurationIssue,
  ModelEndpointSchema,
  ModelSelectionSchema,
  ManagedMcpConnectionSchema,
  encodeMollyModelOption,
  decodeMollyModelOption,
  validateMollyRunConfigProjection,
  MOLLY_UNSELECTED_MODEL,
} from '../src/embedded-harness';
import { buildSessionTurnInputConfig } from '../src/session-input';

describe('embedded harness boundaries', () => {
  it('still parses a compatible model saved before usageInStreaming was retired', () => {
    const legacy = {
      modelId: 'vendor/model',
      name: 'Declared model',
      input: ['text'],
      contextWindow: 32768,
      maxTokens: 4096,
      thinking: ['off'],
      toolCalls: true,
      usageInStreaming: false,
      maxTokensField: 'max_tokens',
    };
    const parsed = SaveModelConnectionSchema.parse({
      providerPresetId: 'openai-compatible',
      displayName: 'Compatible',
      baseUrl: 'https://example.invalid/v1',
      enabled: true,
      customModels: [legacy],
    });
    expect(parsed.customModels?.[0]?.modelId).toBe('vendor/model');
  });

  it('bounds explicit compatible model definitions without accepting executable or secret fields', () => {
    const model = {
      modelId: 'vendor/model',
      name: 'Declared model',
      input: ['text', 'image'],
      contextWindow: 32768,
      maxTokens: 4096,
      thinking: ['off', 'high'],
      toolCalls: true,
      maxTokensField: 'max_tokens',
    };
    const fields = {
      providerPresetId: 'openai-compatible',
      displayName: 'Compatible',
      baseUrl: 'https://example.invalid/v1',
      enabled: true,
      customModels: [model],
    };
    expect(SaveModelConnectionSchema.parse(fields)).toEqual(fields);
    for (const customModels of [
      [],
      [model, model],
      Array.from({ length: 33 }, (_, i) => ({ ...model, modelId: `m-${i}` })),
      [{ ...model, input: ['image'] }],
      [{ ...model, input: ['text', 'text'] }],
      [{ ...model, thinking: [] }],
      [{ ...model, thinking: ['high', 'high'] }],
      [{ ...model, maxTokens: 32769 }],
      [{ ...model, contextWindow: 16_777_217 }],
      [{ ...model, headers: { Authorization: 'private' } }],
      [{ ...model, baseUrl: 'https://other.invalid' }],
      [{ ...model, api: 'arbitrary' }],
    ]) {
      expect(SaveModelConnectionSchema.safeParse({ ...fields, customModels }).success).toBe(false);
    }
    expect(
      SaveModelConnectionSchema.safeParse({ ...fields, customModels: undefined }).success
    ).toBe(false);
    expect(
      SaveModelConnectionSchema.safeParse({ ...fields, providerPresetId: 'openai' }).success
    ).toBe(false);
    // Historical unused advanced entries remain readable but cannot become executable defaults.
    expect(
      ModelConnectionSchema.safeParse({
        ...fields,
        customModels: undefined,
        schemaVersion: 1,
        id: 'legacy',
        revision: 1,
        credentialRef: 'ref',
      }).success
    ).toBe(true);
  });
  it('freezes explicit connection/model/thinking from the existing picker without a default', () => {
    const encoded = encodeMollyModelOption('connection-a', 'vendor/model:latest');
    const selection = {
      connectionId: 'connection-a',
      modelId: 'vendor/model:latest',
      thinking: 'high' as const,
    };
    expect(decodeMollyModelOption(encoded, 'high')).toEqual(selection);
    expect(decodeMollyModelOption(MOLLY_UNSELECTED_MODEL)).toBeUndefined();
    expect(decodeMollyModelOption('molly-model:bad/%zz')).toBeUndefined();
    const input = buildSessionTurnInputConfig({
      cliType: 'builtin',
      agentType: 'molly',
      inputBlocks: [],
      modelId: encoded,
      configOptionValues: { reasoning_effort: 'high' },
    });
    expect(input.modelSelection).toEqual(selection);
    expect(validateMollyRunConfigProjection(input)).toEqual(selection);
    expect(validateMollyRunConfigProjection({ ...input, modelSelection: undefined })).toEqual(
      selection
    );
    expect(() => validateMollyRunConfigProjection({ modelId: MOLLY_UNSELECTED_MODEL })).toThrow();
    expect(() =>
      validateMollyRunConfigProjection({
        ...input,
        modelId: encodeMollyModelOption('other', selection.modelId),
      })
    ).toThrow('harness_model_selection_conflict');
    expect(() =>
      validateMollyRunConfigProjection({
        ...input,
        configOptionValues: { reasoning_effort: 'off' },
      })
    ).toThrow('harness_model_selection_conflict');
    expect(() =>
      validateMollyRunConfigProjection({ ...input, configOptionValues: { arbitrary: true } })
    ).toThrow('harness_legacy_config_unsupported');
    expect(validateMollyRunConfigProjection({ ...input, modeId: 'auto-review' })).toEqual(
      selection
    );
    expect(() => validateMollyRunConfigProjection({ ...input, modeId: 'yolo' })).toThrow(
      'harness_legacy_config_unsupported'
    );
    expect(
      validateMollyRunConfigProjection({
        ...input,
        modeId: 'ask',
        configOptionValues: { ...input.configOptionValues, mode: 'auto-review' },
      })
    ).toEqual(selection);
    expect(() =>
      validateMollyRunConfigProjection({
        ...input,
        configOptionValues: { ...input.configOptionValues, mode: 'yolo' },
      })
    ).toThrow('harness_legacy_config_unsupported');
    expect(
      buildSessionTurnInputConfig({
        cliType: 'builtin',
        agentType: 'molly',
        inputBlocks: [],
        modelId: MOLLY_UNSELECTED_MODEL,
      }).modelSelection
    ).toBeUndefined();
  });
  it('keeps historical mismatches readable but rejects new mismatched Kimi Code writes', () => {
    const fields = {
      providerPresetId: 'moonshot',
      displayName: 'Kimi',
      baseUrl: 'https://api.kimi.com/coding/',
      enabled: true,
    };
    expect(
      ModelConnectionSchema.safeParse({
        ...fields,
        schemaVersion: 1,
        id: 'old',
        revision: 1,
        credentialRef: 'ref',
      }).success
    ).toBe(true);
    expect(SaveModelConnectionSchema.safeParse({ ...fields, apiKey: 'synthetic' }).success).toBe(
      false
    );
    expect(
      SaveModelConnectionSchema.safeParse({ ...fields, enabled: false, apiKey: 'synthetic' })
        .success
    ).toBe(true);
    expect(getModelConnectionConfigurationIssue(fields)).toBe('kimi_code_requires_own_provider');
    const corrected = { ...fields, providerPresetId: 'kimi-coding', apiKey: 'synthetic' };
    expect(SaveModelConnectionSchema.safeParse(corrected).success).toBe(true);
    expect(
      SaveModelConnectionSchema.safeParse({
        ...corrected,
        baseUrl: 'https://api.kimi.com/coding/v1',
      }).success
    ).toBe(false);
    expect(
      getModelConnectionConfigurationIssue({ ...fields, baseUrl: 'https://api.moonshot.ai/v1' })
    ).toBeUndefined();
  });
  it('rejects secret-bearing or ambiguous endpoints and permits explicit local test servers', () => {
    for (const value of [
      '',
      'not a URL',
      'http://remote.example/v1',
      'https://key@api.example/v1',
      'https://api.example/v1?api_key=secret',
      'file:///tmp/key',
    ]) {
      expect(ModelEndpointSchema.safeParse(value).success).toBe(false);
    }
    expect(ModelEndpointSchema.parse('http://127.0.0.1:1234/v1')).toBe('http://127.0.0.1:1234/v1');
  });
  it('stores references only, rejects unknown versions and requires an explicit model', () => {
    const connection = {
      schemaVersion: 1,
      id: 'a',
      revision: 1,
      providerPresetId: 'openai',
      displayName: 'A',
      baseUrl: 'https://api.example/v1',
      credentialRef: 'key-a',
      enabled: true,
    };
    expect(ModelConnectionSchema.parse(connection)).toEqual(connection);
    expect(ModelConnectionSchema.safeParse({ ...connection, apiKey: 'secret' }).success).toBe(
      false
    );
    expect(ModelConnectionSchema.safeParse({ ...connection, schemaVersion: 2 }).success).toBe(
      false
    );
    expect(ModelSelectionSchema.safeParse({ connectionId: 'a', modelId: '' }).success).toBe(false);
  });
  it('does not allow a command in an HTTP connection', () => {
    expect(
      ManagedMcpConnectionSchema.safeParse({
        schemaVersion: 1,
        id: 'mcp',
        revision: 1,
        enabled: true,
        credentialRefs: {},
        transport: 'streamable-http',
        endpoint: 'https://mcp.example',
        command: 'sh',
      }).success
    ).toBe(false);
  });
});
