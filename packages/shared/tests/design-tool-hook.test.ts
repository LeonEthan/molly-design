import { expect, it } from 'vitest';
import { DesignToolHookEventSchema, LocalMachineRpcRequestSchema } from '../src/local-machine-rpc';
it('requires exact resubmission versions and refuses retired generation/read events', () => {
  const event = {
    phase: 'resubmit',
    expectedRevisionId: 'a'.repeat(64),
    artifactDigest: 'b'.repeat(64),
  };
  expect(DesignToolHookEventSchema.parse(event)).toEqual(event);
  expect(
    DesignToolHookEventSchema.safeParse({ phase: 'generation', generation: 'g' }).success
  ).toBe(false);
  expect(DesignToolHookEventSchema.safeParse({ ...event, artifactDigest: '' }).success).toBe(false);
  expect(
    LocalMachineRpcRequestSchema.safeParse({
      method: 'design/tool-hook',
      machineId: 'm',
      workspaceId: 'w',
      params: { version: 1, event },
    }).success
  ).toBe(false);
});
