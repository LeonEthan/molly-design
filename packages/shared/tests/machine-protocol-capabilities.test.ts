import { describe, expect, it } from 'vitest';

import {
  ACP_AUTHENTICATION_INTERACTIONS_PROTOCOL_VERSION,
  CURRENT_MACHINE_PROTOCOL_CAPABILITIES,
  MACHINE_PROTOCOL_CAPABILITIES,
  machineSupportsAcpAuthenticationInteractionsProtocol,
  machineSupportsLocalFileResourcesProtocol,
  machineSupportsDesignCanvasSerialEditing,
  negotiateDesignSourcePathVersion,
  DESIGN_CANVAS_SERIAL_EDITING_PROTOCOL_VERSION,
  DESIGN_SOURCE_PATH_IDENTITY_VERSION,
} from '../src/machine-protocol-capabilities';

describe('ACP authentication interaction protocol capability', () => {
  it('shares one version binding between advertisement and negotiation', () => {
    expect(
      CURRENT_MACHINE_PROTOCOL_CAPABILITIES[
        MACHINE_PROTOCOL_CAPABILITIES.acpAuthenticationInteractions
      ]
    ).toBe(ACP_AUTHENTICATION_INTERACTIONS_PROTOCOL_VERSION);
    expect(
      machineSupportsAcpAuthenticationInteractionsProtocol({
        protocolCapabilities: CURRENT_MACHINE_PROTOCOL_CAPABILITIES,
      })
    ).toBe(true);
  });

  it('treats a missing or older capability as unsupported', () => {
    expect(machineSupportsAcpAuthenticationInteractionsProtocol(undefined)).toBe(false);
    expect(
      machineSupportsAcpAuthenticationInteractionsProtocol({
        protocolCapabilities: {
          [MACHINE_PROTOCOL_CAPABILITIES.acpAuthenticationInteractions]:
            ACP_AUTHENTICATION_INTERACTIONS_PROTOCOL_VERSION - 1,
        },
      })
    ).toBe(false);
  });
});

it('advertises source identity v2 while preserving the v1 canvas handshake', () => {
  expect(DESIGN_CANVAS_SERIAL_EDITING_PROTOCOL_VERSION).toBe(2);
  expect(CURRENT_MACHINE_PROTOCOL_CAPABILITIES.designCanvasSerialEditing).toBe(DESIGN_SOURCE_PATH_IDENTITY_VERSION);
  for (const [version, sourceVersion, handshake] of [[0, 0, false], [1, 1, true], [2, 2, true], [3, 2, true]] as const) {
    const machine = { protocolCapabilities: { designCanvasSerialEditing: version } };
    expect(machineSupportsDesignCanvasSerialEditing(machine)).toBe(handshake);
    expect(negotiateDesignSourcePathVersion(machine)).toBe(sourceVersion);
  }
  expect(negotiateDesignSourcePathVersion(undefined)).toBe(0);
});

it('requires an advertised local file resource protocol, independent of release version', () => {
  expect(machineSupportsLocalFileResourcesProtocol(undefined)).toBe(false);
  expect(
    machineSupportsLocalFileResourcesProtocol({ protocolCapabilities: { localFileResources: 0 } })
  ).toBe(false);
  expect(
    machineSupportsLocalFileResourcesProtocol({
      protocolCapabilities: CURRENT_MACHINE_PROTOCOL_CAPABILITIES,
    })
  ).toBe(true);
});


it('requires an advertised serial canvas capability for the desktop handshake', () => {
  expect(machineSupportsDesignCanvasSerialEditing(undefined)).toBe(false);
  expect(machineSupportsDesignCanvasSerialEditing({ protocolCapabilities: { designCanvasSerialEditing: 0 } })).toBe(false);
  expect(machineSupportsDesignCanvasSerialEditing({ protocolCapabilities: CURRENT_MACHINE_PROTOCOL_CAPABILITIES })).toBe(true);
});
