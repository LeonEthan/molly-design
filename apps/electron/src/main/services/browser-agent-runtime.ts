import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { chmod, lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { app } from 'electron'
import { z } from 'zod'
import {
  BROWSER_AGENT_PROTOCOL_VERSION,
  type BrowserHostCapabilities
} from '@molly/shared/browser-agent-rpc'

const REVISION = '44af39842650f0bb9c1afb7354df9a82921d4f09'
const ManifestSchema = z.object({
  revision: z.literal(REVISION),
  protocol: z.literal(BROWSER_AGENT_PROTOCOL_VERSION),
  platform: z.string(),
  arch: z.string(),
  files: z.array(z.object({ path: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) })).max(8)
})
const ResponseSchema = z.object({
  success: z.boolean(),
  data: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional()
})
export type NativeBrowserResponse = z.infer<typeof ResponseSchema>
const unavailable = (): Error => new Error('The packaged agent-browser runtime is unavailable.')

function runtimeDirectory(): string {
  return join(
    app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked'),
    'resources',
    'agent-browser'
  )
}

let verified: Promise<string> | undefined
function verifiedBinary(): Promise<string> {
  verified ??= (async () => {
    const directory = runtimeDirectory()
    const manifest = ManifestSchema.parse(
      JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))
    )
    if (manifest.platform !== process.platform || manifest.arch !== process.arch)
      throw unavailable()
    const binary = join(
      directory,
      process.platform === 'win32' ? 'agent-browser.exe' : 'agent-browser'
    )
    if (!(await lstat(binary)).isFile()) throw unavailable()
    if (
      createHash('sha256')
        .update(await readFile(binary))
        .digest('hex') !==
      manifest.files.find(
        (file) =>
          file.path === (process.platform === 'win32' ? 'agent-browser.exe' : 'agent-browser')
      )?.sha256
    )
      throw unavailable()
    return binary
  })().catch(() => {
    verified = undefined
    throw unavailable()
  })
  return verified
}

export async function browserRuntimeCapabilities(): Promise<BrowserHostCapabilities | null> {
  try {
    if (!(Number(process.versions.chrome?.split('.')[0]) >= 152)) return null
    await verifiedBinary()
    return {
      version: BROWSER_AGENT_PROTOCOL_VERSION,
      driver: 'agent-browser',
      driverRevision: REVISION
    }
  } catch {
    return null
  }
}

export class BrowserAgentRuntime {
  private directory: string | undefined
  private binary: string | undefined
  private daemon: ChildProcess | undefined
  private child: ChildProcess | undefined
  private readonly session = randomBytes(8).toString('hex')
  private environment: NodeJS.ProcessEnv = {}
  private closed = false
  private closing: Promise<void> | undefined
  private starting: Promise<void> | undefined

  constructor(
    private readonly assertActive: () => void,
    private readonly lost: () => void
  ) {}

  start(): Promise<void> {
    this.starting ??= this.prepare()
    return this.starting
  }

  private async prepare(): Promise<void> {
    this.binary = await verifiedBinary()
    this.directory = await mkdtemp(
      join(process.platform === 'win32' ? tmpdir() : '/tmp', 'molly-ab-')
    )
    await chmod(this.directory, 0o700)
    await writeFile(join(this.directory, 'config.json'), '{}', { mode: 0o600 })
    this.environment = {
      ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot } : {}),
      AGENT_BROWSER_EMBEDDED_TOKEN: randomBytes(32).toString('hex'),
      AGENT_BROWSER_EMBEDDED: '1',
      AGENT_BROWSER_SESSION: this.session,
      AGENT_BROWSER_CONFIG: join(this.directory, 'config.json'),
      AGENT_BROWSER_SOCKET_DIR: this.directory,
      AGENT_BROWSER_DEFAULT_TIMEOUT: '10000',
      AGENT_BROWSER_NO_AUTO_DIALOG: '1',
      AGENT_BROWSER_IDLE_TIMEOUT_MS: '0'
    }
    this.assertActive()
    if (this.closed) throw unavailable()
    const daemon = spawn(this.binary, [], {
      cwd: this.directory,
      env: { ...this.environment, AGENT_BROWSER_DAEMON: '1' },
      stdio: ['pipe', 'ignore', 'ignore'],
      shell: false
    })
    this.daemon = daemon
    daemon.on('error', () => {
      if (!this.closed) this.lost()
    })
    daemon.on('exit', () => {
      if (!this.closed) this.lost()
    })
    const until = Date.now() + 5000
    const ready = join(
      this.directory,
      `${this.session}.${process.platform === 'win32' ? 'port' : 'sock'}`
    )
    while (!(await lstat(ready).catch(() => undefined))) {
      this.assertActive()
      if (this.closed || daemon.exitCode !== null || Date.now() >= until) throw unavailable()
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    this.assertActive()
  }

  async call(args: string[]): Promise<NativeBrowserResponse> {
    this.assertActive()
    if (this.closed || !this.binary || !this.directory || !this.daemon || this.child)
      throw unavailable()
    return new Promise((resolve, reject) => {
      const child = spawn(
        this.binary!,
        [
          '--json',
          '--config',
          join(this.directory!, 'config.json'),
          '--session',
          this.session,
          '--screenshot-format',
          'jpeg',
          '--screenshot-quality',
          '75',
          '--',
          ...args
        ],
        {
          cwd: this.directory,
          env: this.environment,
          stdio: ['ignore', 'pipe', 'ignore'],
          shell: false
        }
      )
      this.child = child
      const chunks: Buffer[] = []
      let size = 0
      let invalid = false
      const timer = setTimeout(() => {
        invalid = true
        this.lost()
        child.kill('SIGKILL')
      }, 30_000)
      child.stdout.on('data', (bytes: Buffer) => {
        size += bytes.length
        if (size > 4 * 1024 * 1024) {
          invalid = true
          this.lost()
          child.kill('SIGKILL')
        } else chunks.push(bytes)
      })
      child.on('error', () => {
        invalid = true
      })
      child.on('close', () => {
        clearTimeout(timer)
        if (this.child === child) this.child = undefined
        try {
          this.assertActive()
          if (invalid || this.closed) throw new Error()
          resolve(ResponseSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8'))))
        } catch {
          this.lost()
          reject(
            new Error(
              'Browser outcome is unknown. Observe before continuing; do not repeat the action automatically.'
            )
          )
        }
      })
    })
  }

  screenshotPath(): string {
    if (!this.directory || this.closed) throw unavailable()
    return join(this.directory, 'viewport.jpg')
  }

  async readScreenshot(): Promise<string> {
    const path = this.screenshotPath()
    try {
      const info = await lstat(path)
      if (!info.isFile() || info.size > 2 * 1024 * 1024) throw new Error()
      const bytes = await readFile(path)
      if (
        !bytes.length ||
        bytes.length > 2 * 1024 * 1024 ||
        bytes.subarray(0, 3).toString('hex') !== 'ffd8ff'
      )
        throw new Error()
      this.assertActive()
      return bytes.toString('base64')
    } catch {
      throw new Error('Browser screenshot is empty or exceeds the size limit.')
    } finally {
      await rm(path, { force: true })
    }
  }

  dispose(): Promise<void> {
    if (this.closing) return this.closing
    this.closed = true
    const children = [this.child, this.daemon].filter((child): child is ChildProcess =>
      Boolean(child)
    )
    this.closing = Promise.all(
      children.map(
        (child) =>
          new Promise<void>((resolve) => {
            if (child.exitCode !== null || child.signalCode !== null) {
              resolve()
              return
            }
            child.once('close', () => {
              clearTimeout(timer)
              resolve()
            })
            const timer = setTimeout(() => child.kill('SIGKILL'), 1000)
            child.kill('SIGTERM')
            child.stdin?.end()
          })
      )
    ).then(async () => {
      await this.starting?.catch(() => undefined)
      if (this.directory) await rm(this.directory, { recursive: true, force: true })
    })
    return this.closing
  }
}
