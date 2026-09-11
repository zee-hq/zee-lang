import { spawnSync } from 'node:child_process'
import { timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ZeeError } from './error.ts'
import { readManifest } from './project.ts'
import { packStoreZip, unpackStoreZip, type ZipEntry } from './zip-store.ts'

export interface RegistryListenOptions {
  root: string
  token: string
  host?: string
  port?: number
}

export interface RegistryListenResult {
  url: string
  close: () => Promise<void>
}

export interface RegistryHttpResult {
  status: number
  contentType: string
  body: Buffer
}

interface RegistryResponse {
  status: number
  headers: Record<string, string>
  body: Buffer
}

/** File-backed HTTP registry from docs/REGISTRY.md (AC-ZEE-5). */
export async function listenRegistry(options: RegistryListenOptions): Promise<RegistryListenResult> {
  const host = options.host ?? '127.0.0.1'
  const server = createServer((req, res) => {
    void reply(req, res, options)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 0, host, () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new ZeeError('registry did not bind a port', 1, 1, options.root)
  }
  return {
    url: `http://${host}:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}

async function reply(req: IncomingMessage, res: ServerResponse, options: RegistryListenOptions): Promise<void> {
  const body = await readBody(req)
  const url = new URL(req.url ?? '/', 'http://registry.local')
  const handled = handleRegistryRequest(
    {
      method: req.method ?? 'GET',
      pathname: url.pathname,
      authorization: header(req.headers.authorization),
      body,
    },
    { root: options.root, token: options.token },
  )
  res.writeHead(handled.status, handled.headers)
  res.end(handled.body)
}

function header(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(chunk as Buffer))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

export function handleRegistryRequest(
  req: { method: string; pathname: string; authorization?: string; body: Buffer },
  ctx: { root: string; token: string },
): RegistryResponse {
  const route = parseRoute(req.pathname)
  if (!route) return json(404, 'unknown_package')
  if (req.method === 'GET' && route.version === undefined) {
    return listPackage(ctx.root, route.name)
  }
  if (req.method === 'GET' && route.version) {
    return getPackageZip(ctx.root, route.name, route.version)
  }
  if (req.method === 'PUT' && route.version) {
    if (!bearerOk(req.authorization, ctx.token)) return json(401, 'unauthorized')
    return putPackage(ctx.root, route.name, route.version, req.body)
  }
  return json(404, 'unknown_package')
}

function parseRoute(pathname: string): { name: string; version?: string } | undefined {
  const match = /^\/api\/v1\/packages\/([A-Za-z][A-Za-z0-9_-]*)(?:\/(\d+(?:\.\d+){0,2}))?$/.exec(pathname)
  if (!match) return undefined
  return { name: match[1]!, version: match[2] }
}

function listPackage(root: string, name: string): RegistryResponse {
  const base = join(root, 'packages', name)
  if (!existsSync(base)) return json(404, 'unknown_package')
  const versions = readdirSync(base).filter((entry) => existsSync(join(base, entry, 'zee.toml')))
  if (versions.length === 0) return json(404, 'unknown_package')
  return json(200, undefined, { name, versions })
}

function getPackageZip(root: string, name: string, version: string): RegistryResponse {
  const dest = join(root, 'packages', name, version)
  if (!existsSync(join(dest, 'zee.toml'))) return json(404, 'unknown_package')
  return { status: 200, headers: { 'content-type': 'application/zip' }, body: packStoreZip(listPackageZipEntries(dest)) }
}

function putPackage(root: string, name: string, version: string, zip: Buffer): RegistryResponse {
  const dest = join(root, 'packages', name, version)
  if (existsSync(join(dest, 'zee.toml'))) return json(409, 'already_published')
  const staging = `${dest}.incoming`
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  try {
    unpackStoreZip(zip, staging)
    const manifest = readManifest(staging)
    if (manifest.name !== name || manifest.version !== version) {
      rmSync(staging, { recursive: true, force: true })
      return json(404, 'unknown_package')
    }
    mkdirSync(join(root, 'packages', name), { recursive: true })
    renameSync(staging, dest)
  } catch (error) {
    rmSync(staging, { recursive: true, force: true })
    if (error instanceof ZeeError) return json(404, 'unknown_package')
    throw error
  }
  return json(200, undefined, { name, version })
}

export function listPackageZipEntries(root: string): ZipEntry[] {
  const entries: ZipEntry[] = [{ name: 'zee.toml', data: readFileSync(join(root, 'zee.toml')) }]
  const src = join(root, 'src')
  if (existsSync(src)) walkZipDir(src, 'src', entries)
  return entries
}

function walkZipDir(dir: string, prefix: string, entries: ZipEntry[]): void {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const rel = `${prefix}/${name}`
    if (statSync(full).isDirectory()) {
      walkZipDir(full, rel, entries)
      continue
    }
    entries.push({ name: rel, data: readFileSync(full) })
  }
}

function json(status: number, error?: string, extra?: Record<string, unknown>): RegistryResponse {
  const payload = error ? { error, ...extra } : extra ?? {}
  return {
    status,
    headers: { 'content-type': 'application/json' },
    body: Buffer.from(`${JSON.stringify(payload)}\n`),
  }
}

function bearerOk(authorization: string | undefined, token: string): boolean {
  const match = /^Bearer\s+(\S+)$/i.exec(authorization ?? '')
  if (!match) return false
  return secretEqual(match[1]!, token)
}

function secretEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** Blocking HTTP for `zee get` / `zee publish` (child process, so a local server can answer). */
export function registryHttpRequest(options: {
  method: string
  url: string
  headers?: Record<string, string>
  body?: Buffer
}): RegistryHttpResult {
  const worker = fileURLToPath(new URL('./registry-http-worker.mjs', import.meta.url))
  const result = spawnSync(process.execPath, [worker], {
    input: JSON.stringify({
      method: options.method,
      url: options.url,
      headers: options.headers ?? {},
      bodyBase64: options.body ? options.body.toString('base64') : null,
    }),
    maxBuffer: 32 * 1024 * 1024,
    timeout: 60_000,
  })
  if (result.status !== 0) {
    const detail = result.stderr?.toString('utf8').trim() || 'registry request failed'
    throw new ZeeError(detail, 1, 1, options.url)
  }
  const parsed = JSON.parse(result.stdout.toString('utf8')) as {
    status: number
    contentType: string
    bodyBase64: string
  }
  return {
    status: parsed.status,
    contentType: parsed.contentType,
    body: Buffer.from(parsed.bodyBase64, 'base64'),
  }
}
