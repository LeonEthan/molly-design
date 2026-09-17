/** Consumer lifetime and request order are independent of Agent execution. */
export class PreviewRequests {
  private next = 0
  private active = new Map<string, { hostId: string; artworkId: string; generation: number }>()
  begin(hostId: string, artworkId: string) {
    const token = { hostId, artworkId, generation: ++this.next }
    this.active.set(hostId, token)
    return token
  }
  current(token: { hostId: string; artworkId: string; generation: number }) {
    const active = this.active.get(token.hostId)
    return active?.generation === token.generation && active.artworkId === token.artworkId
  }
  visible(hostId: string) {
    return this.active.has(hostId)
  }
  cancel(hostId: string) {
    this.active.delete(hostId)
  }
}
