import { timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { getSupervisorHello, mcpToolAuthToken } from './local-supervisor-control';
import {
  LOCAL_MACHINE_RPC_PATH,
  LocalMachineRpcResponseSchema,
  LocalProjectControlRequestSchema,
  LocalProjectControlResponseSchema,
  LocalSessionControlResponseSchema,
  safeParseLocalMachineRpcRequest,
  safeParseLocalProjectControlRequest,
  safeParseLocalSessionControlRequest,
  type LocalMachineRpcRequestValidated,
  type LocalMachineRpcResponse,
  type LocalProjectControlRequestValidated,
  type LocalProjectControlResponse,
  type LocalSessionControlRequestValidated,
  type LocalSessionControlResponse,
  type MachineId,
  type SessionChatAck,
  type SessionCreateAck,
} from '@molly/shared';
import { LOCAL_PROJECT_CONTROL_PATH } from '@molly/shared/node/local-project-control';
import { LOCAL_SESSION_CONTROL_PATH } from '@molly/shared/node/local-ipc';
import type { Logger } from '@/utils/logger';
import { formatErrorMessage } from '@/utils/format-error';

// Derive the accepted project-control tags from the canonical discriminated
// union so this list can never drift from the schema it mirrors.
const PROJECT_CONTROL_TYPES: ReadonlyArray<LocalProjectControlRequestValidated['type']> =
  LocalProjectControlRequestSchema.options.map((option) => option.shape.type.value);

export interface LocalSessionControlConfig {
  machineId: MachineId;
  logger: Logger;
  dispatchSession: (
    message: LocalSessionControlRequestValidated,
    options?: LocalSessionControlDispatchOptions
  ) => Promise<LocalSessionControlResponse[]>;
  dispatchProject: (
    message: LocalProjectControlRequestValidated
  ) => Promise<LocalProjectControlResponse>;
  dispatchMachineRpc?: (
    message: LocalMachineRpcRequestValidated
  ) => Promise<LocalMachineRpcResponse>;
}

export type LocalSessionControlDispatchOptions = {
  onResponse?: (response: LocalSessionControlResponse) => void;
};

export type LocalControlHandlerResponse = {
  status: number;
  payload: Record<string, unknown>;
};

function handlerResponse(
  status: number,
  payload: Record<string, unknown>
): LocalControlHandlerResponse {
  return { status, payload };
}

function isKnownProjectControlType(
  type: string
): type is LocalProjectControlRequestValidated['type'] {
  return PROJECT_CONTROL_TYPES.includes(type as LocalProjectControlRequestValidated['type']);
}

function inferProjectControlType(raw: string): LocalProjectControlRequestValidated['type'] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return 'local-project/add';
    }
    const type = (parsed as { type?: unknown }).type;
    if (typeof type === 'string' && isKnownProjectControlType(type)) {
      return type;
    }
  } catch {
    // ignore invalid JSON payload
  }
  return 'local-project/add';
}

function buildImmediateResponses(
  message: LocalSessionControlRequestValidated
): LocalSessionControlResponse[] {
  if (message.type === 'session/create') {
    const ack: SessionCreateAck = {
      type: 'session/create_ack',
      sessionId: message.sessionId,
    };
    return [ack];
  }

  if (message.type === 'session/chat') {
    const ack: SessionChatAck = {
      type: 'session/chat_ack',
      sessionId: message.sessionId,
      userTurnId: message.userTurnId,
    };
    return [ack];
  }

  return [];
}

async function handleSessionControlRequest(
  config: LocalSessionControlConfig,
  raw: string,
  requestId: number,
  options: LocalSessionControlDispatchOptions = {}
): Promise<LocalControlHandlerResponse> {
  const parsed = safeParseLocalSessionControlRequest(raw);
  if (!parsed.success) {
    config.logger.debug(
      `[local-control:${requestId}] session request parse failed: ${parsed.error.issues.length} issue(s)`
    );
    return handlerResponse(400, {
      ok: false,
      error: 'invalid_request',
      details: parsed.error.flatten(),
    });
  }

  const message = parsed.data;
  config.logger.debug(
    `[local-control:${requestId}] session request parsed: type=${message.type} workspaceId=${message.workspaceId}`
  );
  if (message.machineId !== config.machineId) {
    config.logger.debug(
      `[local-control:${requestId}] session machine mismatch: expected=${config.machineId} actual=${message.machineId}`
    );
    return handlerResponse(403, { ok: false, error: 'machine_mismatch' });
  }

  try {
    const immediateResponses = buildImmediateResponses(message);
    for (const response of immediateResponses) {
      options.onResponse?.(response);
    }
    const dispatchResponses = await config.dispatchSession(message, options);
    const responses = [...immediateResponses, ...dispatchResponses];
    const validated = responses.every(
      (item) => LocalSessionControlResponseSchema.safeParse(item).success
    );

    if (!validated) {
      config.logger.error('Local session control produced invalid response payload');
      return handlerResponse(500, { ok: false, error: 'invalid_response' });
    }

    config.logger.debug(
      `[local-control:${requestId}] session request completed: type=${message.type} responses=${responses.length}`
    );
    return handlerResponse(200, { ok: true, responses });
  } catch (error) {
    const errorMessage = formatErrorMessage(error);
    config.logger.debug(`Local session control dispatch failed: ${errorMessage}`);
    return handlerResponse(500, { ok: false, error: errorMessage });
  }
}

async function handleProjectControlRequest(
  config: LocalSessionControlConfig,
  raw: string,
  requestId: number
): Promise<LocalControlHandlerResponse> {
  const parsed = safeParseLocalProjectControlRequest(raw);
  if (!parsed.success) {
    const inferredType = inferProjectControlType(raw);
    config.logger.debug(
      `[local-control:${requestId}] project request parse failed: type=${inferredType} issues=${parsed.error.issues.length}`
    );
    const invalidResponse: LocalProjectControlResponse = {
      ok: false,
      type: inferredType,
      error: 'invalid_request',
      message: `Invalid project control request: ${parsed.error.issues.length} issue(s)`,
      data: { details: parsed.error.flatten() },
    };
    return handlerResponse(400, invalidResponse as unknown as Record<string, unknown>);
  }

  const message = parsed.data;
  config.logger.debug(`[local-control:${requestId}] project request parsed: type=${message.type}`);
  if (message.machineId !== config.machineId) {
    config.logger.debug(
      `[local-control:${requestId}] project machine mismatch: expected=${config.machineId} actual=${message.machineId}`
    );
    const mismatchResponse: LocalProjectControlResponse = {
      ok: false,
      type: message.type,
      error: 'machine_mismatch',
      message: `Machine mismatch: expected ${config.machineId}`,
    };
    return handlerResponse(403, mismatchResponse);
  }

  try {
    const response = await config.dispatchProject(message);
    const validated = LocalProjectControlResponseSchema.safeParse(response).success;
    if (!validated) {
      config.logger.error('Local project control produced invalid response payload');
      const invalidResponse: LocalProjectControlResponse = {
        ok: false,
        type: message.type,
        error: 'invalid_response',
        message: 'Invalid project control response payload',
      };
      return handlerResponse(500, invalidResponse);
    }

    if (response.ok) {
      config.logger.debug(
        `[local-control:${requestId}] project request completed: type=${response.type} ok=true`
      );
    } else {
      config.logger.debug(
        `[local-control:${requestId}] project request completed: type=${response.type} ok=false error=${response.error}`
      );
    }
    return handlerResponse(200, response as unknown as Record<string, unknown>);
  } catch (error) {
    const failureMessage = formatErrorMessage(error);
    config.logger.debug(`Local project control dispatch failed: ${failureMessage}`);
    const failureResponse: LocalProjectControlResponse = {
      ok: false,
      type: message.type,
      error: 'execution_failed',
      message: failureMessage,
    };
    return handlerResponse(500, failureResponse);
  }
}

const coordinatorMethods = new Set([
  'harness/host',
  'design/canvas-host',
  'design/render-host',
  'mcp/catalog-entry',
  'browser/host',
  'browser/pause-all',
]);

async function handleMachineRpcRequest(
  config: LocalSessionControlConfig,
  raw: string,
  requestId: number,
  headers?: IncomingHttpHeaders
): Promise<LocalControlHandlerResponse> {
  const parsed = safeParseLocalMachineRpcRequest(raw);
  if (!parsed.success) {
    config.logger.debug(
      `[local-control:${requestId}] machine rpc parse failed: ${parsed.error.issues.length} issue(s)`
    );
    return handlerResponse(400, {
      ok: false,
      error: 'invalid_request',
      details: parsed.error.flatten(),
    });
  }

  const message = parsed.data;
  config.logger.debug(
    `[local-control:${requestId}] machine rpc parsed: method=${message.method} workspaceId=${message.workspaceId}`
  );
  if (message.machineId !== config.machineId) {
    config.logger.debug(
      `[local-control:${requestId}] machine rpc machine mismatch: expected=${config.machineId} actual=${message.machineId}`
    );
    return handlerResponse(403, { ok: false, error: 'machine_mismatch' });
  }
  if (process.env.MOLLY_SUPERVISOR_TRANSPORT === 'stdin') {
    const coordinator = coordinatorMethods.has(message.method);
    if (
      coordinator ||
      (message.method === 'design/image-connection' && message.params?.acquireCredential === true)
    ) {
      const expected = coordinator ? getSupervisorHello()?.coordinatorToken : mcpToolAuthToken;
      const actual = headers?.[coordinator ? 'x-molly-coordinator-token' : 'x-molly-mcp-token'];
      if (
        !expected ||
        typeof actual !== 'string' ||
        Buffer.byteLength(actual) !== Buffer.byteLength(expected) ||
        !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
      )
        return handlerResponse(403, {
          ok: false,
          error: coordinator ? 'forbidden' : 'image_credentials_require_mcp_http_host',
        });
      if (!coordinator && !message.ownerSessionId)
        return handlerResponse(403, { ok: false, error: 'session_lease_required' });
    }
  }
  if (!config.dispatchMachineRpc) {
    return handlerResponse(501, { ok: false, error: 'method_unavailable' });
  }

  try {
    const response = await config.dispatchMachineRpc(message);
    const validated = LocalMachineRpcResponseSchema.safeParse(response).success;
    if (!validated) {
      config.logger.error('Local machine RPC produced invalid response payload');
      return handlerResponse(500, { ok: false, error: 'invalid_response' });
    }
    return handlerResponse(200, response as unknown as Record<string, unknown>);
  } catch (error) {
    const failureMessage = formatErrorMessage(error);
    config.logger.debug(`Local machine RPC dispatch failed: ${failureMessage}`);
    return handlerResponse(500, { ok: false, error: failureMessage });
  }
}

export class LocalControlHandler {
  constructor(private readonly config: LocalSessionControlConfig) {}

  handle(request: {
    path: string;
    rawBody: string;
    headers?: IncomingHttpHeaders;
    requestId: number;
    onSessionResponse?: (response: LocalSessionControlResponse) => void;
  }): Promise<LocalControlHandlerResponse> {
    if (request.path === LOCAL_SESSION_CONTROL_PATH) {
      return handleSessionControlRequest(this.config, request.rawBody, request.requestId, {
        onResponse: request.onSessionResponse,
      });
    }
    if (request.path === LOCAL_MACHINE_RPC_PATH) {
      return handleMachineRpcRequest(
        this.config,
        request.rawBody,
        request.requestId,
        request.headers
      );
    }
    if (request.path === LOCAL_PROJECT_CONTROL_PATH) {
      return handleProjectControlRequest(this.config, request.rawBody, request.requestId);
    }
    return Promise.resolve(handlerResponse(404, { ok: false, error: 'not_found' }));
  }
}
