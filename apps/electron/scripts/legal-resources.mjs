import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))
const stagedDirectory = fileURLToPath(new URL('../resources/licenses/', import.meta.url))

export const LEGAL_RESOURCE_SOURCES = {
  LICENSE: 'LICENSE',
  NOTICE: 'NOTICE',
  'LICENSES/Lody-Apache-2.0.txt': 'LICENSES/Lody-Apache-2.0.txt',
  'THIRD_PARTY_NOTICES.md': 'THIRD_PARTY_NOTICES.md',
  'Lody-theme-NOTICE.md': 'packages/components/src/lib/vscode-theme/bundled/NOTICE.md'
}

export function stageLegalResources(directory = stagedDirectory) {
  for (const [destination, source] of Object.entries(LEGAL_RESOURCE_SOURCES)) {
    const target = join(directory, destination)
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(join(repositoryRoot, source), target)
  }
  verifyLegalResources(directory)
}

export function verifyLegalResources(directory) {
  for (const name of Object.keys(LEGAL_RESOURCE_SOURCES)) {
    const file = join(directory, name)
    let contents
    try {
      contents = readFileSync(file, 'utf8')
    } catch (cause) {
      throw new Error(`[licenses] missing or unreadable legal resource: ${file}`, { cause })
    }
    if (!contents.trim()) throw new Error(`[licenses] empty legal resource: ${file}`)
  }
}
