import { getIpcContext, IpcMethod, IpcService } from 'electron-ipc-decorator'
import { DesignHighlightSchema } from '@molly/shared/design-selection-commands'
import {
  DesignSessionIdSchema as id,
  DesignCandidateIdSchema as candidateId,
  DesignAssociationSchema as association,
  DesignCreationSchema as creation,
  DesignBoundsSchema,
  DesignExportFormatSchema,
  DesignExportScaleSchema,
  type DesignExportScale,
  type DesignCreationInput,
  type DesignAssociationInput
} from '@molly/shared/electron-ipc'
import {
  LocalMachineRpcRequestSchema,
  DesignSourcePathResultSchema,
  type LocalMachineRpcRequest
} from '@molly/shared/local-machine-rpc'
import {
  refreshSourcePreview,
  hideSourcePreview,
  attachSourcePreview,
  attachDesignFromPreview,
  closeSourcePreview,
  coverDesignCanvas,
  highlightSourcePreview
} from '../../services/design-source-preview'
import { getIpcServiceDeps } from '../ipc-service-deps'
import {
  getDesignSelection,
  settleDesignNotes,
  highlightDesignElements,
  presentDesignToolbar,
  applyDesignCommand,
  createDesignVersion,
  readDesignCanvasState,
  designCanvasAccess,
  restoreDesignVersion,
  hideDesign,
  destroyDesign,
  currentDesignSelection,
  designRequest,
  leaveDesign,
  copyDesign,
  exportDesign,
  finishDesignCopy,
  readDesignCandidateFile,
  renameDesign,
  saveDesignForDispatch,
  syncDesignCanvasFromStore
} from '../../services/design-service'
import {
  forgetDesignThumbnail,
  getDesignThumbnail,
  refreshDesignThumbnailInBackground
} from '../../services/design-thumbnail'

function owner() {
  const { event } = getIpcContext()
  const window = getIpcServiceDeps().getMainWindow()
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== event.sender.mainFrame
  )
    throw Error('Untrusted design IPC')
  return window
}
export class DesignIpc extends IpcService {
  static override readonly groupName = 'design'
  @IpcMethod() async cover(artworkId: string, hostId: string, covered: boolean) {
    if (typeof covered !== 'boolean') throw Error('Invalid canvas visibility')
    return coverDesignCanvas(owner(), id.parse(artworkId), id.parse(hostId), covered)
  }
  @IpcMethod() async create(raw: DesignCreationInput) {
    owner()
    return designRequest({ operation: 'create', ...creation.parse(raw) })
  }
  @IpcMethod() async pending() {
    owner()
    return designRequest<import('../../../../../cli/src/design/store').DesignPayload[]>({
      operation: 'pending'
    })
  }
  @IpcMethod() async acknowledge(sessionId: string) {
    owner()
    await designRequest({ operation: 'acknowledge', sessionId: id.parse(sessionId) })
  }
  @IpcMethod() async finishCopy(sourceId: string, targetId: string, hostId?: string) {
    owner()
    await finishDesignCopy(
      id.parse(sourceId),
      id.parse(targetId),
      hostId === undefined ? undefined : id.parse(hostId)
    )
  }
  @IpcMethod() async rename(sessionId: string, name: string) {
    owner()
    return renameDesign(id.parse(sessionId), association.shape.name.parse(name))
  }
  @IpcMethod() async read(sessionId: string) {
    owner()
    return designRequest({ operation: 'read', sessionId: id.parse(sessionId) })
  }
  @IpcMethod() async selection(
    sessionId: string,
    hostId: string,
    kind?: 'image',
    onlySaved = false
  ) {
    owner()
    if (kind !== undefined && kind !== 'image') throw Error('Invalid selection kind')
    if (typeof onlySaved !== 'boolean') throw Error('Invalid selection capture mode')
    return getDesignSelection(id.parse(sessionId), id.parse(hostId), kind, { onlySaved })
  }
  /**
   * Display-only reseed for a shell that remounted over a still-alive canvas:
   * returns the last selection the canvas reported, or null when the view is
   * gone or currently holds no selection. Element references still originate
   * exclusively from the validated selection capture.
   */
  @IpcMethod() async selectionSummary(sessionId: string, hostId: string) {
    owner()
    id.parse(sessionId)
    return currentDesignSelection(id.parse(hostId))
  }
  @IpcMethod() async settleNotes(
    sessionId: string,
    hostId: string,
    notesEpoch: unknown,
    sent: unknown
  ) {
    owner()
    if (typeof notesEpoch !== 'number' || !Number.isSafeInteger(notesEpoch) || notesEpoch < 0)
      throw Error('Invalid notes epoch')
    if (typeof sent !== 'boolean') throw Error('Invalid notes outcome')
    return settleDesignNotes(id.parse(sessionId), id.parse(hostId), notesEpoch, sent)
  }
  @IpcMethod() async presentToolbar(sessionId: string, hostId: string, presentation: unknown) {
    owner()
    return presentDesignToolbar(id.parse(sessionId), id.parse(hostId), presentation)
  }
  @IpcMethod() async highlight(sessionId: string, hostId: string, input: unknown) {
    owner()
    const artwork = id.parse(sessionId)
    const host = id.parse(hostId)
    const groups = DesignHighlightSchema.parse(input)
    const [canonical] = await Promise.all([
      highlightDesignElements(artwork, host, groups),
      highlightSourcePreview(host, groups)
    ])
    return canonical
  }
  @IpcMethod() async applyCommand(sessionId: string, hostId: string, command: unknown) {
    owner()
    return applyDesignCommand(id.parse(sessionId), id.parse(hostId), command)
  }
  @IpcMethod() async save(sessionId: string) {
    owner()
    await saveDesignForDispatch(id.parse(sessionId))
  }
  /**
   * P2-A2: reload this artwork's open editor from the store when a turn has
   * committed a new revision. No-op when the canvas is not open or already
   * matches the store; the renderer calls this from the committed outcome, not
   * on a timer.
   */
  @IpcMethod() async syncFromStore(sessionId: string, hostId?: string) {
    owner()
    return syncDesignCanvasFromStore(
      id.parse(sessionId),
      hostId === undefined ? undefined : id.parse(hostId)
    )
  }
  /** Existing historical content, addressed by artwork and its recorded digest. */
  @IpcMethod() async candidateFile(sessionId: string, rawCandidateId: string) {
    owner()
    return readDesignCandidateFile(id.parse(sessionId), candidateId.parse(rawCandidateId))
  }
  @IpcMethod() async attach(
    sessionId: string,
    bounds: { x: number; y: number; width: number; height: number },
    hostId: string
  ) {
    const window = owner()
    return attachDesignFromPreview(
      window,
      id.parse(sessionId),
      DesignBoundsSchema.parse(bounds),
      id.parse(hostId)
    )
  }
  @IpcMethod() async refreshPreview(
    sessionId: string,
    hostId: string,
    message: LocalMachineRpcRequest
  ) {
    const window = owner()
    const artworkId = id.parse(sessionId)
    const key = id.parse(hostId)
    const request = LocalMachineRpcRequestSchema.parse(message)
    if (
      request.method !== 'design/source-path' ||
      request.ownerSessionId !== artworkId ||
      request.params.turnId !== undefined
    )
      throw Error('Invalid current design source request')
    return refreshSourcePreview(window, artworkId, key, async () => {
      const response = await getIpcServiceDeps().cliService.sendLocalMachineRpc(request)
      if (!response.ok) throw Error(response.error)
      const resolved = DesignSourcePathResultSchema.parse(response.result)
      if (!resolved.ok) throw Error(resolved.error)
      const turnId = designCanvasAccess.state(artworkId).turnId
      if (!turnId || (resolved.live && turnId !== resolved.live.turnId))
        throw Error('Design execution changed while resolving its source')
      return {
        path: resolved.path,
        live: { sessionId: artworkId, turnId, sourceTurnId: resolved.live?.sourceTurnId }
      }
    })
  }
  @IpcMethod() async attachPreview(
    hostId: string,
    bounds: { x: number; y: number; width: number; height: number }
  ) {
    owner()
    await attachSourcePreview(id.parse(hostId), DesignBoundsSchema.parse(bounds))
  }
  @IpcMethod() async hidePreview(hostId: string, cancel = true) {
    owner()
    if (typeof cancel !== 'boolean') throw Error('Invalid preview visibility')
    hideSourcePreview(id.parse(hostId), cancel)
  }
  @IpcMethod() async closePreview(hostId: string) {
    owner()
    closeSourcePreview(id.parse(hostId))
  }
  @IpcMethod() async hide(sessionId: string, hostId: string) {
    owner()
    hideDesign(id.parse(sessionId), id.parse(hostId))
  }
  @IpcMethod() async leave(sessionId: string, hostId?: string) {
    owner()
    const artworkId = id.parse(sessionId)
    const left = await leaveDesign(artworkId, hostId === undefined ? undefined : id.parse(hostId))
    if (left) refreshDesignThumbnailInBackground(artworkId)
    return left
  }
  /** Sidebar thumbnail of the last saved revision, as last refreshed by leave or turn end. */
  @IpcMethod() async thumbnail(sessionId: string) {
    owner()
    return getDesignThumbnail(id.parse(sessionId))
  }
  @IpcMethod() async close(sessionId: string) {
    owner()
    const key = id.parse(sessionId)
    if (!(await leaveDesign(key))) return false
    destroyDesign(key)
    await forgetDesignThumbnail(key)
    return true
  }
  @IpcMethod() async copy(sessionId: string, raw: DesignAssociationInput, hostId?: string) {
    owner()
    return copyDesign(
      id.parse(sessionId),
      association.parse(raw),
      hostId === undefined ? undefined : id.parse(hostId)
    )
  }
  @IpcMethod() async versions(sessionId: string) {
    owner()
    return designRequest<import('../../../../../cli/src/design/history').DesignVersion[]>({
      operation: 'history-list',
      sessionId: id.parse(sessionId)
    })
  }
  @IpcMethod() async state(sessionId: string) {
    owner()
    return readDesignCanvasState(id.parse(sessionId))
  }
  @IpcMethod() async saveVersion(sessionId: string) {
    owner()
    return createDesignVersion(id.parse(sessionId))
  }
  @IpcMethod() async restoreVersion(sessionId: string, commitId: string) {
    owner()
    if (typeof commitId !== 'string' || !/^[a-f0-9]{40}$/.test(commitId))
      throw Error('Invalid design version')
    return restoreDesignVersion(id.parse(sessionId), commitId)
  }
  @IpcMethod() async export(
    sessionId: string,
    format: 'png' | 'jpeg',
    title: string,
    scale: DesignExportScale = 1
  ) {
    owner()
    return exportDesign(
      id.parse(sessionId),
      DesignExportFormatSchema.parse(format),
      association.shape.name.parse(title),
      DesignExportScaleSchema.parse(scale)
    )
  }
}
