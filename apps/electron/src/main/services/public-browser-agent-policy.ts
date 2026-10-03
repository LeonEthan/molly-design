export const hostMatchesSite = (hostname: string, site: string): boolean => {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  const approved = site.toLowerCase().replace(/\.$/, '')
  return approved.length > 0 && (host === approved || host.endsWith(`.${approved}`))
}

export const agentBrowserDocumentKey = (rawUrl: string): string => {
  const url = new URL(rawUrl)
  url.hash = ''
  if (url.search) url.search = url.searchParams.toString()
  return url.toString()
}
