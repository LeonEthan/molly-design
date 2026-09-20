import type { AuthMethod } from '@agentclientprotocol/sdk';
import type {
  AgentConfigCliType,
  BuiltinRuntimeOverrides,
  CustomAcpLaunchSpec,
  MachineAcpAuthenticationForm,
} from '@molly/shared';
import type { Logger } from '@/utils/logger';
import { assertEmbeddedHarnessTarget } from './embedded-harness-runtime';

export type AcpAuthenticationProgressEvent =
  | { status: 'starting' }
  | { status: 'auth-methods'; interactionId: string; authMethods: AuthMethod[] }
  | {
      status: 'authorization';
      authorizationUrl: string;
      userCode?: string;
      acceptsAuthorizationCode?: boolean;
      expiresInSeconds?: number;
      interactionId?: string;
      message?: string;
      requiresAuthorizationConsent?: boolean;
    }
  | {
      status: 'input-required';
      interactionId: string;
      message: string;
      form: MachineAcpAuthenticationForm;
    }
  | { status: 'output'; stream: 'stdout' | 'stderr'; output: string }
  | { status: 'authenticated' }
  | { status: 'cancelled' }
  | { status: 'error'; error: string };

export type AcpAuthenticationResult =
  | {
      success: true;
      disposition: 'authenticated' | 'cancelled' | 'not-running' | 'input-accepted';
    }
  | {
      success: false;
      disposition: 'error';
      error: string;
    };

export type BuiltinAuthenticationProbeResult =
  | { status: 'authenticated' }
  | { status: 'unauthenticated'; authMethods: readonly AuthMethod[] }
  | { status: 'unknown' };

/** Retired CLI credential stores are never opened, including for capability refresh. */
export async function probeBuiltinAuthentication(options: {
  cliType: AgentConfigCliType;
  agentType: string;
  runtimeOverrides?: BuiltinRuntimeOverrides;
  env?: NodeJS.ProcessEnv;
  logger: Logger;
  signal?: AbortSignal;
}): Promise<BuiltinAuthenticationProbeResult> {
  options.signal?.throwIfAborted();
  assertEmbeddedHarnessTarget(options);
  return { status: 'unknown' };
}

/** Compatibility responses for old RPC clients, not an authentication runner. */
export class AcpAuthenticationManager {
  // Keep the old construction contract without retaining a logger or credential state.
  // eslint-disable-next-line no-useless-constructor
  constructor(_logger: Logger) {}

  async authenticate(options: {
    requestId: string;
    cliType: AgentConfigCliType;
    agentType: string;
    customAcp?: CustomAcpLaunchSpec;
    runtimeOverrides?: BuiltinRuntimeOverrides;
    env?: Record<string, string>;
    onProgress?: (event: AcpAuthenticationProgressEvent) => void;
  }): Promise<AcpAuthenticationResult> {
    const error =
      options.cliType === 'builtin' && options.agentType === 'molly'
        ? 'harness_model_connection_required'
        : 'legacy_harness_authentication_disabled';
    options.onProgress?.({ status: 'error', error });
    return { success: false, disposition: 'error', error };
  }

  getAgentType(_requestId: string): string | undefined {
    return undefined;
  }
  cancel(_requestId: string): AcpAuthenticationResult {
    return { success: true, disposition: 'not-running' };
  }
  submitAuthorizationCode(_requestId: string, _authorizationCode: string): AcpAuthenticationResult {
    return {
      success: false,
      disposition: 'error',
      error: 'legacy_harness_authentication_disabled',
    };
  }
  submitAuthenticationInput(
    _requestId: string,
    _interactionId: string,
    _authenticationInput: string
  ): AcpAuthenticationResult {
    return {
      success: false,
      disposition: 'error',
      error: 'legacy_harness_authentication_disabled',
    };
  }
}
