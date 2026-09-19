import { LocalFileResolutionSchema } from './local-file-preview';
import { PublicImageConnectionSchema } from './image-connection';
import { z } from 'zod';
import {
  CodeCollabV2ErrorSchema,
  CodeCollabV2FileIndexRequestSchema,
  CodeCollabV2FileIndexSnapshotSchema,
  CodeCollabV2InitDirectoryOkSchema,
  CodeCollabV2InitDirectoryRequestSchema,
  CodeCollabV2LspUnsupportedSchema,
  CodeCollabV2OpenAllChangesDiffRequestSchema,
  CodeCollabV2OpenAllChangesDiffResponseSchema,
  CodeCollabV2OpenCurrentDiffRequestSchema,
  CodeCollabV2OpenCurrentDiffResponseSchema,
  CodeCollabV2OpenTextOkSchema,
  CodeCollabV2OpenTextRequestSchema,
  CodeCollabV2OpenTurnDiffRequestSchema,
  CodeCollabV2OpenTurnDiffResponseSchema,
  CodeCollabV2RefreshTextRequestSchema,
  CodeCollabV2RefreshTextResponseSchema,
  CodeCollabV2SaveTextRequestSchema,
  CodeCollabV2SaveTextResponseSchema,
} from './code-collab';
import { FilePreviewV3RequestSchema, FilePreviewV3ResponseSchema } from './file-preview';
import {
  SessionCancelResponseSchema,
  SessionDispatchTurnResponseSchema,
  SessionEditAndResendResponseSchema,
  SessionEditAndResendSpecSchema,
  SessionForkResponseSchema,
  SessionForkSpecSchema,
  SessionIdSchema,
  SessionPreparationCancelSpecSchema,
  SessionPreparationSpecSchema,
  SessionPrepareCancelResponseSchema,
  SessionPrepareResponseSchema,
  SessionPreviewEndpointAcquireResponseSchema,
  SessionPreviewEndpointReleaseResponseSchema,
  PreviewTargetSchema,
  SessionSteerResponseSchema,
  SessionTerminateResponseSchema,
} from './message-schemas';

export const LOCAL_MACHINE_RPC_PATH = '/machine-rpc';

const BaseLocalMachineRpcRequestSchema = z
  .object({
    machineId: z.string().trim().min(1),
    workspaceId: z.string().trim().min(1),
    ownerSessionId: z.string().trim().min(1).optional(),
    timeoutMs: z.number().int().positive().optional(),
  })
  .strict();

export const SessionActiveInvocationContextResultSchema = z.discriminatedUnion('active', [
  z
    .object({
      type: z.literal('session/active-invocation-context'),
      sessionId: SessionIdSchema,
      active: z.literal(false),
    })
    .strict(),
  z
    .object({
      type: z.literal('session/active-invocation-context'),
      sessionId: SessionIdSchema,
      active: z.literal(true),
      requesterUserId: z.string().trim().min(1),
      sourceTurnId: z.string().trim().min(1),
      inputConfig: z.record(z.string(), z.unknown()),
    })
    .strict(),
]);
export type SessionActiveInvocationContextResult = z.infer<
  typeof SessionActiveInvocationContextResultSchema
>;

/**
 * The daemon's answers about this machine's image connection (P2.4).
 *
 * Two methods rather than one because they have opposite costs: reading the
 * setting is free and must never touch the network, while testing it makes a
 * request to the user's own upstream. Keeping them apart means a caller that
 * only needs the availability gate cannot accidentally trigger a probe, and the
 * settings button cannot drift into being the thing that decides availability.
 *
 * Both carry only the non-secret projection; a reply never contains the key.
 */
export const ImageConnectionRpcResultSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('design/image-connection'),
      /** Trusted Session-derived design output and attachment roots; not caller paths. */
      artworkWorkdir: z.string().optional(),
      workspaceRoot: z.string().optional(),
      /** null when this machine has stored no connection at all. */
      connection: PublicImageConnectionSchema.nullable(),
      /**
       * The availability gate for the asking session, decided by the daemon so
       * no caller has to re-derive it: true requires `request.ownerSessionId`
       * to name a session whose meta carries `design` AND that session's
       * machine to satisfy `isImageConnectionReady`. False means the tool is not
       * registered — a non-design session, a missing/unreadable session, no
       * stored row, a switched-off row, or a row with no key yet.
       */
      ready: z.boolean(),
      /**
       * The credential, and the only place it appears on the wire.
       *
       * This method exists for exactly one caller — the built-in MCP server
       * that has to present the key to the user's own upstream — over the
       * owner-only machine-local control socket, from the daemon's own child
       * process running as the same user. Present only when `ready` — which
       * also requires a design session, so a coding session's answer carries no
       * key even on a ready machine; the key exists to generate design assets,
       * and no other session has a use for it. A settings surface must keep
       * using `connection` (which reports `hasApiKey`) and never request this
       * field: nothing in the UI needs the secret, and a value that is never
       * sent cannot be logged.
       */
      credential: z
        .object({ apiKey: z.string().min(1) })
        .strict()
        .nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal('design/image-connection-test'),
      ok: z.boolean(),
      modelCount: z.number().int().nonnegative().optional(),
      error: z.string().min(1).max(500).optional(),
    })
    .strict(),
]);
export type ImageConnectionRpcResult = z.infer<typeof ImageConnectionRpcResultSchema>;

/**
 * The design preview render bridge (P2.4b).
 *
 * The daemon cannot rasterize a design: `renderSavedDesign` needs a Chromium
 * `BrowserWindow`, and that lives in Electron main. Electron main cannot see a
 * session document either — it is a byte-forwarding pipe with no Loro handle —
 * so a session-doc rendezvous would have to be answered by the renderer, which
 * only observes sessions it has joined. The two processes therefore meet on the
 * owner-only machine-local control socket, in the one direction that already
 * exists end to end: the desktop calls the daemon.
 *
 * `design/render-host` is the desktop's own worker loop. It is not a push and
 * not a stream: each call returns the results the host finished since the last
 * call and collects the work waiting now, so a request is a bounded round trip
 * with no long-lived connection, no cancellation path, and no reverse channel to
 * secure. Polling at `DESIGN_RENDER_HOST_POLL_INTERVAL_MS` is what makes a host
 * live: the daemon only reports the capability while a host has polled within
 * `DESIGN_RENDER_HOST_TTL_MS`, so a desktop that is not running means the tool is
 * not registered, and a request that arrives with no host fails at once instead
 * of waiting for one that will never come.
 *
 * The payload travels by path, never by value: `assets` are embedded base64 and
 * a design can exceed the 16 MiB local control response cap, so the daemon
 * stages the payload file and the host reads it. `outputPath` is the daemon's
 * choice too, which keeps the rendered PNG inside the session workdir where the
 * agent that asked for it can open it.
 */
export const DESIGN_RENDER_HOST_POLL_INTERVAL_MS = 2_000;
/** How long a host stays "connected" after its last poll. Comfortably longer than one interval. */
export const DESIGN_RENDER_HOST_TTL_MS = 15_000;

/** One staged render the daemon is offering the desktop host. */
export const DesignRenderHostWorkSchema = z
  .object({
    requestId: z.string().trim().min(1).max(200),
    /** Absolute path of the staged `DesignPayload` JSON the host must render. */
    payloadPath: z.string().min(1),
    /** Absolute path the host must write the PNG to. */
    outputPath: z.string().min(1),
    width: z.number().int().min(1).max(4096),
    height: z.number().int().min(1).max(4096),
  })
  .strict();
export type DesignRenderHostWork = z.infer<typeof DesignRenderHostWorkSchema>;

const DesignRenderHostReportBase = z.object({
  requestId: z.string().trim().min(1).max(200),
});
export const DesignRenderHostReportSchema = z.discriminatedUnion('ok', [
  DesignRenderHostReportBase.extend({ ok: z.literal(true) }).strict(),
  DesignRenderHostReportBase.extend({
    ok: z.literal(false),
    // The host's own message, bounded: it reaches the agent as a tool error.
    error: z.string().trim().min(1).max(500),
  }).strict(),
]);
export type DesignRenderHostReport = z.infer<typeof DesignRenderHostReportSchema>;

/**
 * The render-preview answer, which is itself a union: a rendered preview and a
 * refusal carry the same `type` and differ in `ok`.
 *
 * Nested rather than flattened because a discriminated union cannot hold two
 * options with the same discriminator value. Zod dispatches on `type` first and
 * on `ok` only inside this branch, so both halves stay exhaustively typed
 * instead of collapsing into one object with optional fields.
 */
const DesignRenderPreviewResultSchema = z.discriminatedUnion('ok', [
  z
    .object({
      type: z.literal('design/render-preview'),
      ok: z.literal(true),
      /** Workdir-relative path of the rendered PNG, for the agent to open. */
      path: z.string().trim().min(1).max(1024),
      width: z.number().int().min(1).max(4096),
      height: z.number().int().min(1).max(4096),
      bytes: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      type: z.literal('design/render-preview'),
      ok: z.literal(false),
      /**
       * Why the preview could not be rendered: no artifact yet, intake
       * diagnostics, a host that went away, or a render failure. A refusal is a
       * result, not a transport error — nothing about it is unexpected.
       */
      error: z.string().trim().min(1).max(2000),
    })
    .strict(),
]);

export const DesignRenderRpcResultSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('design/render-host'),
      /** Work waiting for the host. Delivered once; the daemon owns the queue. */
      requests: z.array(DesignRenderHostWorkSchema).max(8),
    })
    .strict(),
  z
    .object({
      type: z.literal('design/render-host-status'),
      /** True while a desktop host has polled within `DESIGN_RENDER_HOST_TTL_MS`. */
      connected: z.boolean(),
    })
    .strict(),
  DesignRenderPreviewResultSchema,
]);
export type DesignRenderRpcResult = z.infer<typeof DesignRenderRpcResultSchema>;

/** Desktop acknowledgement of a generic canvas flush, fenced by the execution owner. */
export const DesignCanvasReportSchema = z
  .object({
    artworkId: z.string().uuid(),
    turnId: z.string().min(1).max(200),
    ok: z.boolean(),
    error: z.string().max(500).optional(),
  })
  .strict();
export type DesignCanvasReport = z.infer<typeof DesignCanvasReportSchema>;
export const DesignCanvasStateSchema = z
  .object({
    artworkId: z.string().uuid(),
    turnId: z.string().min(1).max(200),
    preparing: z.boolean(),
  })
  .strict();
export type DesignCanvasState = z.infer<typeof DesignCanvasStateSchema>;
export const DesignCanvasHostResultSchema = z
  .object({
    type: z.literal('design/canvas-host'),
    version: z.literal(1),
    machine: z.object({ protocolCapabilities: z.record(z.string(), z.number()) }).strict(),
    active: z.array(DesignCanvasStateSchema),
  })
  .strict();

/** Read-only historical draft location; byte transport stays with ordinary file preview. */
export const DesignSourcePathResultSchema = z.discriminatedUnion('ok', [
  z
    .object({
      type: z.literal('design/source-path'),
      ok: z.literal(true),
      path: z.string().min(1),
      live: z
        .object({ turnId: z.string().min(1).max(200), sourceTurnId: z.string().min(1).max(200) })
        .strict()
        .optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('design/source-path'),
      ok: z.literal(false),
      error: z.string().min(1),
    })
    .strict(),
]);

export const DesignResubmitInputSchema = z
  .object({
    expectedRevisionId: z.string().regex(/^[a-f0-9]{64}$/),
    artifactDigest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const DesignToolHookEventSchema = z.discriminatedUnion('phase', [
  z.object({ phase: z.literal('start'), runId: z.string().uuid() }).strict(),
  z
    .object({
      phase: z.literal('terminal'),
      runId: z.string().uuid(),
      status: z.enum(['end_turn', 'failed', 'cancelled']),
    })
    .strict(),
  z.object({ phase: z.literal('resubmit-capability') }).strict(),
  DesignResubmitInputSchema.extend({ phase: z.literal('resubmit') }).strict(),
]);
export const DesignToolHookResultSchema = z
  .object({
    type: z.literal('design/tool-hook'),
    version: z.literal(2),
    supported: z.boolean(),
    ok: z.boolean(),
    error: z.string().max(1000).optional(),
  })
  .strict();

export const LocalMachineRpcRequestSchema = z.discriminatedUnion('method', [
  BaseLocalMachineRpcRequestSchema.extend({
    method: z.literal('design/tool-hook'),
    params: z
      .object({
        version: z.literal(2),
        launchId: z.string().uuid().optional(),
        event: DesignToolHookEventSchema,
      })
      .strict(),
  }).strict(),
  BaseLocalMachineRpcRequestSchema.extend({
    method: z.literal('design/source-path'),
    ownerSessionId: SessionIdSchema,
    params: z.object({ turnId: z.string().min(1).max(200).optional() }).strict(),
  }).strict(),
  BaseLocalMachineRpcRequestSchema.extend({
    method: z.literal('design/canvas-host'),
    params: z
      .object({ version: z.literal(1), reports: z.array(DesignCanvasReportSchema).max(100) })
      .strict(),
  }).strict(),
  BaseLocalMachineRpcRequestSchema.extend({
    method: z.literal('design/image-connection'),
    params: z.object({}).strict(),
  }).strict(),
  BaseLocalMachineRpcRequestSchema.extend({
    method: z.literal('design/image-connection-test'),
    params: z.object({}).strict(),
  }).strict(),
  // Render bridge (P2.4b). The asking session is `ownerSessionId`, exactly as
  // above: an identity predicate the daemon resolves the workdir from, never a
  // path the caller could point at someone else's directory.
  BaseLocalMachineRpcRequestSchema.extend({
    method: z.literal('design/render-preview'),
    params: z.object({}).strict(),
  }).strict(),
  BaseLocalMachineRpcRequestSchema.extend({
    method: z.literal('design/render-host-status'),
    params: z.object({}).strict(),
  }).strict(),
  // The desktop host's own loop. Deliberately carries no `ownerSessionId`: a host
  // belongs to no session, and it is the daemon that decides which sessions may
  // be previewed.
  BaseLocalMachineRpcRequestSchema.extend({
    method: z.literal('design/render-host'),
    params: z
      .object({
        reports: z.array(DesignRenderHostReportSchema).max(8),
      })
      .strict(),
  }).strict(),
  BaseLocalMachineRpcRequestSchema.extend({
    method: z.literal('session/get-active-invocation-context'),
    params: z
      .object({
        sessionId: SessionIdSchema,
      })
      .strict(),
  }).strict(),
  BaseLocalMachineRpcRequestSchema.extend({
    method: z.literal('code-collab/get-file-index'),
    params: CodeCollabV2FileIndexRequestSchema,
  }).strict(),
  BaseLocalMachineRpcRequestSchema.extend({
    method: z.literal('code-collab/open-text'),
    params: CodeCollabV2OpenTextRequestSchema,
  }).strict(),
  BaseLocalMachineRpcRequestSchema.extend({
    method: z.literal('code-collab/refresh-text'),
    params: CodeCollabV2RefreshTextRequestSchema,
  }).strict(),
  BaseLocalMachineRpcRequestSchema.extend({
    method: z.literal('code-collab/save-text'),
    params: CodeCollabV2SaveTextRequestSchema,
  }).strict(),
  BaseLocalMachineRpcRequestSchema.extend({
    method: z.literal('code-collab/open-current-diff'),
    params: CodeCollabV2OpenCurrentDiffRequestSchema,
  }).strict(),
  BaseLocalMachineRpcRequestSchema.extend({
    method: z.literal('code-collab/open-all-changes-diff'),
    params: CodeCollabV2OpenAllChangesDiffRequestSchema,
  }).strict(),
  BaseLocalMachineRpcRequestSchema.extend({
    method: z.literal('code-collab/open-turn-diff'),
    params: CodeCollabV2OpenTurnDiffRequestSchema,
  }).strict(),
  BaseLocalMachineRpcRequestSchema.extend({
    method: z.literal('code-collab/init-directory'),
    params: CodeCollabV2InitDirectoryRequestSchema,
  }).strict(),
  BaseLocalMachineRpcRequestSchema.extend({
    method: z.literal('code-collab/lsp-definition'),
    params: z
      .object({
        sessionId: z.string().trim().min(1),
        path: z.string().min(1),
        line: z.number().int().nonnegative().optional(),
        character: z.number().int().nonnegative().optional(),
      })
      .strict(),
  }).strict(),
  BaseLocalMachineRpcRequestSchema.extend({
    method: z.literal('code-collab/lsp-references'),
    params: z
      .object({
        sessionId: z.string().trim().min(1),
        path: z.string().min(1),
        line: z.number().int().nonnegative().optional(),
        character: z.number().int().nonnegative().optional(),
      })
      .strict(),
  }).strict(),
  // File Preview v3 over the same-machine IPC path. Params travel in the clear
  // here because the socket never leaves the machine.
  BaseLocalMachineRpcRequestSchema.extend({
    method: z.literal('file/preview'),
    params: FilePreviewV3RequestSchema,
  }).strict(),
  // Electron's same-machine preview route. This method deliberately has no
  // Loro Streams counterpart: the desktop user may inspect any local file,
  // while remote requests retain File Preview v3's restricted-root policy.
  BaseLocalMachineRpcRequestSchema.extend({
    method: z.literal('file/resolve-local'),
    params: z.union([
      FilePreviewV3RequestSchema,
      z
        .object({
          v: z.literal(3),
          sessionId: SessionIdSchema,
          attachment: z
            .object({ fileId: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/i) })
            .strict(),
        })
        .strict(),
    ]),
  }).strict(),
  BaseLocalMachineRpcRequestSchema.extend({
    method: z.literal('session/cancel'),
    params: z
      .object({
        sessionId: SessionIdSchema,
        turnId: z.string().trim().min(1),
        subagentTaskId: z.string().trim().min(1).optional(),
        action: z.enum(['resume', 'interrupt']).optional(),
      })
      .strict(),
  }).strict(),
  BaseLocalMachineRpcRequestSchema.extend({
    method: z.literal('session/fork'),
    params: SessionForkSpecSchema,
  }).strict(),
  BaseLocalMachineRpcRequestSchema.extend({
    method: z.literal('session/edit-and-resend'),
    params: SessionEditAndResendSpecSchema,
  }).strict(),
  BaseLocalMachineRpcRequestSchema.extend({
    method: z.literal('session/dispatch-turn'),
    params: z
      .object({
        sessionId: SessionIdSchema,
        userTurnId: z.string().trim().min(1),
        userId: z.string().trim().min(1),
        timestamp: z.string().trim().min(1),
        // Opaque at the transport layer; the CLI normalizes it with
        // `normalizeSessionTurnInputConfig` before offering the turn, the same
        // guard the Loro Streams Machine RPC server applies.
        inputConfig: z.record(z.string(), z.unknown()),
      })
      .strict(),
  }).strict(),
  BaseLocalMachineRpcRequestSchema.extend({
    method: z.literal('session/prepare'),
    params: SessionPreparationSpecSchema,
  }).strict(),
  BaseLocalMachineRpcRequestSchema.extend({
    method: z.literal('session/prepare-cancel'),
    params: SessionPreparationCancelSpecSchema,
  }).strict(),
  BaseLocalMachineRpcRequestSchema.extend({
    method: z.literal('session/steer'),
    params: z
      .object({
        sessionId: z.string().trim().min(1),
        expectedTurnId: z.string().trim().min(1),
        userTurnId: z.string().trim().min(1),
        userId: z.string().trim().min(1),
        timestamp: z.string().trim().min(1),
        inputConfig: z.record(z.string(), z.unknown()),
      })
      .strict(),
  }).strict(),
  BaseLocalMachineRpcRequestSchema.extend({
    method: z.literal('session/preview-endpoint-acquire'),
    params: z
      .object({
        sessionId: z.string().trim().min(1),
        requestedByUserId: z.string().trim().min(1),
        target: PreviewTargetSchema,
      })
      .strict(),
  }).strict(),
  BaseLocalMachineRpcRequestSchema.extend({
    method: z.literal('session/preview-endpoint-release'),
    params: z
      .object({
        sessionId: z.string().trim().min(1),
        endpointId: z.string().trim().min(1),
      })
      .strict(),
  }).strict(),
  BaseLocalMachineRpcRequestSchema.extend({
    method: z.literal('session/terminate'),
    params: z
      .object({
        sessionId: z.string().trim().min(1),
      })
      .strict(),
  }).strict(),
]);

export type LocalMachineRpcRequest = z.infer<typeof LocalMachineRpcRequestSchema>;
export type LocalMachineRpcRequestValidated = LocalMachineRpcRequest;

export const LocalMachineRpcResultSchema = z.union([
  DesignSourcePathResultSchema,
  ImageConnectionRpcResultSchema,
  DesignRenderRpcResultSchema,
  DesignCanvasHostResultSchema,
  DesignToolHookResultSchema,
  SessionActiveInvocationContextResultSchema,
  CodeCollabV2FileIndexSnapshotSchema,
  CodeCollabV2OpenTextOkSchema,
  CodeCollabV2RefreshTextResponseSchema,
  CodeCollabV2SaveTextResponseSchema,
  CodeCollabV2OpenCurrentDiffResponseSchema,
  CodeCollabV2OpenAllChangesDiffResponseSchema,
  CodeCollabV2OpenTurnDiffResponseSchema,
  CodeCollabV2InitDirectoryOkSchema,
  CodeCollabV2LspUnsupportedSchema,
  CodeCollabV2ErrorSchema,
  FilePreviewV3ResponseSchema,
  LocalFileResolutionSchema,
  SessionCancelResponseSchema,
  SessionDispatchTurnResponseSchema,
  SessionEditAndResendResponseSchema,
  SessionForkResponseSchema,
  SessionPrepareResponseSchema,
  SessionPrepareCancelResponseSchema,
  SessionPreviewEndpointAcquireResponseSchema,
  SessionPreviewEndpointReleaseResponseSchema,
  SessionSteerResponseSchema,
  SessionTerminateResponseSchema,
]);
export type LocalMachineRpcResult = z.infer<typeof LocalMachineRpcResultSchema>;

export const LocalMachineRpcResponseSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      result: LocalMachineRpcResultSchema,
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: z.string().trim().min(1),
    })
    .strict(),
]);
export type LocalMachineRpcResponse = z.infer<typeof LocalMachineRpcResponseSchema>;

export function safeParseLocalMachineRpcRequest(
  raw: string
):
  | { readonly success: true; readonly data: LocalMachineRpcRequestValidated }
  | { readonly success: false; readonly error: z.ZodError } {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const result = LocalMachineRpcRequestSchema.safeParse(parsed);
    if (!result.success) {
      return { success: false, error: result.error };
    }
    return { success: true, data: result.data };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof z.ZodError
          ? error
          : new z.ZodError([
              {
                code: z.ZodIssueCode.custom,
                path: [],
                message: 'Invalid JSON',
              },
            ]),
    };
  }
}

export { FilePreviewV3ErrorSchema } from './file-preview';

export { machineSupportsDesignCanvasSerialEditing } from './machine-protocol-capabilities';
