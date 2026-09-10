import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { ZeeError } from './error.ts'
import { listPackageZipEntries, registryHttpRequest } from './registry-http.ts'
import { pickMatchingVersion } from './semver.ts'
import { packStoreZip, unpackStoreZip } from './zip-store.ts'
import { readManifest, type Manifest } from './project.ts'

export const REGISTRY_PACKAGES = 'packages'

/** Local default: `$ZEE_HOME/.zee/registry` or `~/.zee/registry` (AC-ZEE-5). */
export function defaultRegistryUrl(): string {
  const home = process.env.ZEE_HOME?.trim() || homedir()
  return join(home, '.zee', 'registry')
}

export function resolveRegistryUrl(_startDir: string, manifest?: Manifest): string {
  const fromEnv = process.env.ZEE_REGISTRY?.trim()
  if (fromEnv) return fromEnv
  const fromManifest = manifest?.registryUrl?.trim()
  if (fromManifest) return fromManifest
  return defaultRegistryUrl()
}

export function isHttpRegistry(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://')
}

export function registryRoot(url: string): string {
  if (url.startsWith('file://')) return resolve(url.slice('file://'.length))
  if (isHttpRegistry(url)) {
    throw new ZeeError('http registry fetch is not wired yet — use a file registry path', 1, 1, url)
  }
  return resolve(url)
}

/** Publish `zee.toml` + `src/` into the registry. Refuses overwrite (AC-ZEE-5). */
export function publishPackage(cwd: string): { name: string; version: string; dest: string } {
  const root = resolve(cwd)
  const file = join(root, 'zee.toml')
  const source = readFileSync(file, 'utf8')
  if (!/^\s*version\s*=/m.test(source)) {
    throw new ZeeError('zee.toml is missing package.version', 1, 1, file)
  }
  const manifest = readManifest(root)
  const url = resolveRegistryUrl(root, manifest)
  if (isHttpRegistry(url)) {
    return publishHttp(root, file, manifest, url)
  }
  const dest = join(registryRoot(url), REGISTRY_PACKAGES, manifest.name, manifest.version)
  if (existsSync(join(dest, 'zee.toml'))) {
    throw new ZeeError(`already published \`${manifest.name}@${manifest.version}\``, 1, 1, file)
  }
  copyPublished(root, dest)
  return { name: manifest.name, version: manifest.version, dest }
}

export function fetchRegistryPackage(
  pkgRoot: string,
  name: string,
  constraint: string,
  manifest: Manifest,
): string {
  const url = resolveRegistryUrl(pkgRoot, manifest)
  if (isHttpRegistry(url)) {
    return fetchHttp(pkgRoot, name, constraint, url)
  }
  const base = join(registryRoot(url), REGISTRY_PACKAGES, name)
  if (!existsSync(base)) {
    throw new ZeeError(`package \`${name}\` is not in the registry`, 1, 1, join(pkgRoot, 'zee.toml'))
  }
  const published = readdirSync(base).filter((entry) => existsSync(join(base, entry, 'zee.toml')))
  const picked = pickMatchingVersion(published, constraint)
  if (!picked) {
    throw new ZeeError(`no published ${name} matches \`${constraint}\``, 1, 1, join(pkgRoot, 'zee.toml'))
  }
  return join(base, picked)
}

function copyPublished(from: string, to: string): void {
  mkdirSync(to, { recursive: true })
  cpSync(join(from, 'zee.toml'), join(to, 'zee.toml'))
  const srcFrom = join(from, 'src')
  const srcTo = join(to, 'src')
  if (existsSync(srcTo)) rmSync(srcTo, { recursive: true, force: true })
  if (existsSync(srcFrom)) cpSync(srcFrom, srcTo, { recursive: true })
}

function publishHttp(
  root: string,
  file: string,
  manifest: Manifest,
  url: string,
): { name: string; version: string; dest: string } {
  const token = process.env.ZEE_REGISTRY_TOKEN?.trim()
  if (!token) {
    throw new ZeeError('http publish needs ZEE_REGISTRY_TOKEN', 1, 1, file)
  }
  const dest = `${httpBase(url)}/api/v1/packages/${manifest.name}/${manifest.version}`
  const response = registryHttpRequest({
    method: 'PUT',
    url: dest,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/zip',
    },
    body: packStoreZip(listPackageZipEntries(root)),
  })
  if (response.status === 401) {
    throw new ZeeError('unauthorized', 1, 1, file)
  }
  if (response.status === 409) {
    throw new ZeeError(`already published \`${manifest.name}@${manifest.version}\``, 1, 1, file)
  }
  if (response.status !== 200) {
    throw new ZeeError(httpError(response, `publish ${manifest.name}@${manifest.version} failed`), 1, 1, file)
  }
  return { name: manifest.name, version: manifest.version, dest }
}

function fetchHttp(pkgRoot: string, name: string, constraint: string, url: string): string {
  const file = join(pkgRoot, 'zee.toml')
  const listed = registryHttpRequest({ method: 'GET', url: `${httpBase(url)}/api/v1/packages/${name}` })
  if (listed.status === 404) {
    throw new ZeeError(`package \`${name}\` is not in the registry`, 1, 1, file)
  }
  if (listed.status !== 200) {
    throw new ZeeError(httpError(listed, `registry list ${name} failed`), 1, 1, file)
  }
  const payload = JSON.parse(listed.body.toString('utf8')) as { versions?: string[] }
  const picked = pickMatchingVersion(payload.versions ?? [], constraint)
  if (!picked) {
    throw new ZeeError(`no published ${name} matches \`${constraint}\``, 1, 1, file)
  }
  const blob = registryHttpRequest({
    method: 'GET',
    url: `${httpBase(url)}/api/v1/packages/${name}/${picked}`,
  })
  if (blob.status !== 200) {
    throw new ZeeError(httpError(blob, `registry fetch ${name}@${picked} failed`), 1, 1, file)
  }
  const dest = join(pkgRoot, '.zee', '.registry', name, picked)
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })
  unpackStoreZip(blob.body, dest)
  return dest
}

function httpBase(url: string): string {
  return url.replace(/\/$/, '')
}

function httpError(response: { status: number; body: Buffer }, fallback: string): string {
  try {
    const payload = JSON.parse(response.body.toString('utf8')) as { error?: string }
    if (payload.error) return payload.error
  } catch {
    /* use fallback */
  }
  return `${fallback} (${response.status})`
}
