import { createHash } from 'node:crypto'

type DesignContent = { doc: unknown; assets: Record<string, string> }

export function findDesignCompareSource<T extends { commitId: string; contentDigest?: string }>(
  versions: readonly T[],
  content: DesignContent
): T | undefined {
  const assets = Object.fromEntries(
    Object.keys(content.assets)
      .sort()
      .map((key) => [key, content.assets[key]])
  )
  const digest = createHash('sha256')
    .update(JSON.stringify({ doc: content.doc, assets }))
    .digest('hex')
  return [...versions].reverse().find((version) => version.contentDigest === digest)
}
