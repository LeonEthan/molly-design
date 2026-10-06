import type { BrowserWindow } from 'electron'

const coveredHosts = new WeakMap<BrowserWindow, Map<string, object>>()

export function coverDesignHost(owner: BrowserWindow, hostId: string) {
  let hosts = coveredHosts.get(owner)
  if (!hosts) coveredHosts.set(owner, (hosts = new Map()))
  const token = {}
  hosts.set(hostId, token)
  return () => coveredHosts.get(owner)?.get(hostId) === token
}

export function uncoverDesignHost(owner: BrowserWindow, hostId: string) {
  coveredHosts.get(owner)?.delete(hostId)
}

export function canPresentDesignHost(owner: BrowserWindow, hostId: string) {
  return !coveredHosts.get(owner)?.has(hostId)
}
