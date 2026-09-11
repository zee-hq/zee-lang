import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ZeeError } from './error.ts'
import { fetchRegistryPackage } from './registry.ts'
import { registryHttpRequest } from './registry-http.ts'
import {
  type DepSpec,
  listPackageSources,
  parseDepSpec,
  parseInlineTable,
  readManifest,
  type Manifest,
} from './project.ts'
import { isVersionConstraint, parseVersion, pickMatchingVersion, satisfiesConstraint } from './semver.ts'

export const LOCK_FILE = 'zee.lock'
export const CACHE_DIR = '.zee'
export const CATALOG_FILE = 'libs.toml'
export const CATALOG_JSON = 'catalog.json'
/** Default Maven-style index until the landing-page central exists. Override with `ZEE_CATALOG`. */
export const DEFAULT_CATALOG_URL = 'https://raw.githubusercontent.com/zee-hq/zee-lang/main/catalog.json'

export interface LockedPackage {
  name: string
  version: string
  hash: string
  root: string
  source: 'path' | 'git' | 'registry'
  path?: string
  git?: string
  tag?: string
  rev?: string
}

export interface Lockfile {
  version: number
  packages: LockedPackage[]
}

export interface GetResult {
  packages: LockedPackage[]
  lockPath: string
}

export interface GetOptions {
  update?: boolean
  names?: string[]
}

export interface UpdateChange {
  name: string
  from: string
  to: string
}

export interface UpdateResult extends GetResult {
  changes: UpdateChange[]
}

type Refresh = 'all' | 'none' | Set<string>

export interface Catalog {
  file: string
  dir: string
  versions: Map<string, string>
  libraries: Map<string, DepSpec>
}

/** Fetch [deps] into `.zee/`, write zee.lock. `aliases` are Gradle-style catalog keys (AC-ZEE-4). */
export function getPackages(cwd: string, aliases: string[] = [], options: GetOptions = {}): GetResult {
  const root = resolve(cwd)
  for (const alias of aliases) {
    addCatalogAlias(root, alias)
  }
  const manifest = readManifest(root)
  if (options.names && options.names.length > 0) {
    for (const name of options.names) {
      if (!manifest.deps.has(name)) {
        throw new ZeeError(`unknown dep \`${name}\``, 1, 1, join(root, 'zee.toml'))
      }
    }
  }
  const lock = lockMap(loadLock(root))
  const refresh: Refresh = options.update
    ? options.names && options.names.length > 0
      ? new Set(options.names)
      : 'all'
    : 'none'
  const found = new Map<string, LockedPackage>()
  collectDeps(root, root, manifest, new Set(), found, lock, refresh)
  const packages = [...found.values()].sort((a, b) => a.name.localeCompare(b.name))
  for (const pkg of packages) {
    materialize(root, pkg)
  }
  const lockPath = join(root, LOCK_FILE)
  const text = formatLockfile({ version: 1, packages })
  if (!existsSync(lockPath) || readFileSync(lockPath, 'utf8') !== text) {
    writeFileSync(lockPath, text, 'utf8')
  }
  return { packages, lockPath }
}

/** Re-resolve [deps] within current constraints and rewrite zee.lock (AC-ZEE-update). */
export function updatePackages(cwd: string, names: string[] = []): UpdateResult {
  const root = resolve(cwd)
  const before = new Map((loadLock(root)?.packages ?? []).map((pkg) => [pkg.name, pkg.version]))
  const got = getPackages(cwd, [], { update: true, names })
  const changes: UpdateChange[] = []
  for (const pkg of got.packages) {
    const from = before.get(pkg.name)
    if (from !== undefined && from !== pkg.version) {
      changes.push({ name: pkg.name, from, to: pkg.version })
    }
  }
  return { ...got, changes }
}

function loadLock(root: string): Lockfile | undefined {
  const file = join(root, LOCK_FILE)
  if (!existsSync(file)) return undefined
  return parseLockfile(readFileSync(file, 'utf8'), file)
}

function lockMap(lock: Lockfile | undefined): Map<string, LockedPackage> {
  return new Map((lock?.packages ?? []).map((pkg) => [pkg.name, pkg]))
}

export function findCatalogFile(startDir: string): string | undefined {
  let dir = resolve(startDir)
  while (true) {
    const file = join(dir, CATALOG_FILE)
    if (existsSync(file)) return file
    const parent = resolve(dir, '..')
    if (parent === dir) return undefined
    dir = parent
  }
}

export function readCatalog(startDir: string): Catalog {
  const file = findCatalogFile(startDir)
  if (!file) {
    throw new ZeeError(`missing ${CATALOG_FILE} (walked up from project)`, 1, 1, startDir)
  }
  return parseCatalog(readFileSync(file, 'utf8'), file)
}

export function parseCatalog(source: string, file: string): Catalog {
  const versions = new Map<string, string>()
  const libraries = new Map<string, DepSpec>()
  let section: 'versions' | 'libraries' | undefined
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.length === 0 || line.startsWith('#')) continue
    if (line === '[versions]') {
      section = 'versions'
      continue
    }
    if (line === '[libraries]') {
      section = 'libraries'
      continue
    }
    if (line.startsWith('[')) {
      section = undefined
      continue
    }
    const match = /^([A-Za-z][A-Za-z0-9_-]*)\s*=\s*(.+)$/.exec(line)
    if (!match) {
      throw new ZeeError(`invalid catalog line \`${line}\``, 1, 1, file)
    }
    const name = match[1]!
    const value = match[2]!.trim()
    if (section === 'versions') {
      if (!(value.startsWith('"') && value.endsWith('"') && value.length >= 2)) {
        throw new ZeeError(`invalid version \`${name}\``, 1, 1, file)
      }
      versions.set(name, value.slice(1, -1))
      continue
    }
    if (section === 'libraries') {
      libraries.set(name, parseLibrarySpec(value, name, file, versions))
    }
  }
  return { file, dir: dirname(file), versions, libraries }
}

export function parseCatalogJson(source: string, file: string): Catalog {
  let payload: unknown
  try {
    payload = JSON.parse(source)
  } catch {
    throw new ZeeError('invalid catalog json', 1, 1, file)
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new ZeeError('invalid catalog json', 1, 1, file)
  }
  const root = payload as Record<string, unknown>
  const versions = new Map<string, string>()
  if (root.versions !== undefined) {
    if (typeof root.versions !== 'object' || root.versions === null || Array.isArray(root.versions)) {
      throw new ZeeError('invalid catalog json versions', 1, 1, file)
    }
    for (const [name, value] of Object.entries(root.versions as Record<string, unknown>)) {
      if (typeof value !== 'string') {
        throw new ZeeError(`invalid version \`${name}\``, 1, 1, file)
      }
      versions.set(name, value)
    }
  }
  const libraries = new Map<string, DepSpec>()
  if (root.libraries !== undefined) {
    if (typeof root.libraries !== 'object' || root.libraries === null || Array.isArray(root.libraries)) {
      throw new ZeeError('invalid catalog json libraries', 1, 1, file)
    }
    for (const [name, value] of Object.entries(root.libraries as Record<string, unknown>)) {
      libraries.set(name, specFromCatalogJson(value, name, file, versions))
    }
  }
  return { file, dir: catalogDir(file), versions, libraries }
}

function specFromCatalogJson(
  raw: unknown,
  name: string,
  file: string,
  versions: Map<string, string>,
): DepSpec {
  if (typeof raw === 'string') return { kind: 'version', version: raw }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ZeeError(`invalid catalog library \`${name}\``, 1, 1, file)
  }
  const fields = raw as Record<string, unknown>
  const ref = fields['version.ref']
  if (typeof fields.git === 'string') {
    let tag: string | undefined
    if (typeof ref === 'string') {
      const version = versions.get(ref)
      if (version === undefined) {
        throw new ZeeError(`unknown version.ref \`${ref}\` for \`${name}\``, 1, 1, file)
      }
      tag = version
    } else if (typeof fields.tag === 'string') {
      tag = fields.tag
    }
    return {
      kind: 'git',
      git: fields.git,
      tag,
      rev: typeof fields.rev === 'string' ? fields.rev : undefined,
      branch: typeof fields.branch === 'string' ? fields.branch : undefined,
    }
  }
  if (typeof fields.path === 'string') return { kind: 'path', path: fields.path }
  if (typeof fields.lib === 'string') return { kind: 'lib', lib: fields.lib }
  if (typeof fields.version === 'string') return { kind: 'version', version: fields.version }
  throw new ZeeError(`invalid catalog library \`${name}\``, 1, 1, file)
}

function catalogDir(file: string): string {
  if (file.startsWith('http://') || file.startsWith('https://')) return '.'
  const path = file.startsWith('file://') ? file.slice('file://'.length) : file
  return dirname(resolve(path))
}

function tryReadLocalCatalog(startDir: string): Catalog | undefined {
  const file = findCatalogFile(startDir)
  if (!file) return undefined
  return parseCatalog(readFileSync(file, 'utf8'), file)
}

function bundledCatalogPath(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), `../${CATALOG_JSON}`)
}

function loadBundledCatalog(): Catalog {
  const file = bundledCatalogPath()
  return parseCatalogJson(readFileSync(file, 'utf8'), file)
}

function loadCatalogFromLocation(location: string): Catalog {
  if (location.startsWith('http://') || location.startsWith('https://')) {
    const response = registryHttpRequest({ method: 'GET', url: location })
    if (response.status !== 200) {
      throw new ZeeError(`catalog fetch failed (${response.status})`, 1, 1, location)
    }
    return parseCatalogJson(response.body.toString('utf8'), location)
  }
  const path = location.startsWith('file://') ? location.slice('file://'.length) : resolve(location)
  if (!existsSync(path)) {
    throw new ZeeError(`missing ${CATALOG_JSON}`, 1, 1, path)
  }
  return parseCatalogJson(readFileSync(path, 'utf8'), path)
}

function loadCentralCatalog(): Catalog {
  const override = process.env.ZEE_CATALOG?.trim()
  if (override) return loadCatalogFromLocation(override)
  if (!process.env.ZEE_OFFLINE) {
    try {
      return loadCatalogFromLocation(DEFAULT_CATALOG_URL)
    } catch {
      /* landing-page central is later; bundled index is enough for v0 */
    }
  }
  return loadBundledCatalog()
}

function findAlias(catalog: Catalog, alias: string): { name: string; spec: DepSpec } | undefined {
  const exact = catalog.libraries.get(alias)
  if (exact) return { name: alias, spec: exact }
  const lower = alias.toLowerCase()
  for (const [name, spec] of catalog.libraries) {
    if (name.toLowerCase() === lower) return { name, spec }
  }
  return undefined
}

function lookupLibrary(startDir: string, alias: string): { name: string; spec: DepSpec; catalog: Catalog } {
  const local = tryReadLocalCatalog(startDir)
  if (local) {
    const hit = findAlias(local, alias)
    if (hit) return { ...hit, catalog: local }
  }
  const central = loadCentralCatalog()
  const hit = findAlias(central, alias)
  if (hit) return { ...hit, catalog: central }
  throw new ZeeError(`unknown library \`${alias}\``, 1, 1, central.file)
}

function parseLibrarySpec(raw: string, name: string, file: string, versions: Map<string, string>): DepSpec {
  if (raw.startsWith('{') && raw.endsWith('}')) {
    const fields = parseInlineTable(raw.slice(1, -1), file)
    const ref = fields['version.ref']
    if (ref) {
      const version = versions.get(ref)
      if (version === undefined) {
        throw new ZeeError(`unknown version.ref \`${ref}\` for \`${name}\``, 1, 1, file)
      }
      if (fields.git) {
        return { kind: 'git', git: fields.git, tag: version, rev: fields.rev, branch: fields.branch }
      }
      return { kind: 'version', version }
    }
  }
  return parseDepSpec(raw, name, file)
}

function addCatalogAlias(root: string, alias: string): void {
  const hit = lookupLibrary(root, alias)
  const manifest = readManifest(root)
  const already = [...manifest.deps.keys()].some((name) => name.toLowerCase() === hit.name.toLowerCase())
  if (already) return
  const file = join(root, 'zee.toml')
  const current = readFileSync(file, 'utf8')
  const line = `${hit.name} = { lib = "${hit.name}" }`
  if (/\n\[deps\]\s*$/m.test(current) || current.includes('[deps]')) {
    writeFileSync(file, `${current.trimEnd()}\n${line}\n`, 'utf8')
    return
  }
  writeFileSync(file, `${current.trimEnd()}\n\n[deps]\n${line}\n`, 'utf8')
}

export function parseLockfile(source: string, file = LOCK_FILE): Lockfile {
  const packages: LockedPackage[] = []
  let version = 1
  let current: Partial<LockedPackage> | undefined
  const flush = (): void => {
    if (!current) return
    if (!current.name || !current.hash || !current.source) {
      throw new ZeeError('invalid lockfile package', 1, 1, file)
    }
    packages.push({
      name: current.name,
      version: current.version ?? '0.1.0',
      hash: current.hash,
      root: '',
      source: current.source,
      path: current.path,
      git: current.git,
      tag: current.tag,
      rev: current.rev,
    })
    current = undefined
  }
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.length === 0 || line.startsWith('#')) continue
    if (line === '[[pkg]]') {
      flush()
      current = {}
      continue
    }
    const match = /^([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(line)
    if (!match) continue
    const key = match[1]!
    const value = unquote(match[2]!.trim())
    if (!current) {
      if (key === 'version') version = Number(value)
      continue
    }
    if (key === 'name') current.name = value
    else if (key === 'version') current.version = value
    else if (key === 'hash') current.hash = value
    else if (key === 'source') current.source = value as LockedPackage['source']
    else if (key === 'path') current.path = value
    else if (key === 'git') current.git = value
    else if (key === 'tag') current.tag = value
    else if (key === 'rev') current.rev = value
  }
  flush()
  return { version, packages }
}

function collectDeps(
  pkgRoot: string,
  cacheRoot: string,
  manifest: Manifest,
  visiting: Set<string>,
  found: Map<string, LockedPackage>,
  lock: Map<string, LockedPackage>,
  refresh: Refresh,
): void {
  for (const [name, spec] of manifest.deps) {
    if (visiting.has(name)) {
      throw new ZeeError(`package cycle involving \`${name}\``, 1, 1, join(pkgRoot, 'zee.toml'))
    }
    const dest = resolveDep(pkgRoot, cacheRoot, name, spec, lock, refresh)
    const destManifest = readManifest(dest)
    if (destManifest.name !== name) {
      throw new ZeeError(
        `dep \`${name}\` is package \`${destManifest.name}\``,
        1,
        1,
        join(pkgRoot, 'zee.toml'),
      )
    }
    const existing = found.get(name)
    const hash = hashPackage(dest)
    if (existing) {
      if (existing.hash !== hash) {
        throw new ZeeError(`incompatible versions of \`${name}\``, 1, 1, join(pkgRoot, 'zee.toml'))
      }
      continue
    }
    visiting.add(name)
    collectDeps(dest, cacheRoot, destManifest, visiting, found, lock, refresh)
    visiting.delete(name)
    const expanded = expandSpec(pkgRoot, spec)
    found.set(name, lockedFrom(name, destManifest, dest, expanded, hash))
  }
}

function expandSpec(pkgRoot: string, spec: DepSpec): DepSpec {
  if (spec.kind === 'lib') return resolveLibSpec(pkgRoot, spec.lib)
  return spec
}

function lockedFrom(
  name: string,
  destManifest: Manifest,
  dest: string,
  spec: DepSpec,
  hash: string,
): LockedPackage {
  if (spec.kind === 'path') {
    return {
      name,
      version: destManifest.version,
      hash,
      root: dest,
      source: 'path',
      path: spec.path,
    }
  }
  if (spec.kind === 'git') {
    return {
      name,
      version: destManifest.version,
      hash,
      root: dest,
      source: 'git',
      git: spec.git,
      tag: gitExactTag(dest) ?? spec.tag,
      rev: gitRev(dest),
    }
  }
  if (spec.kind === 'version') {
    return {
      name,
      version: destManifest.version,
      hash,
      root: dest,
      source: 'registry',
    }
  }
  throw new ZeeError(`dep \`${name}\` needs path, git, or a SemVer string`, 1, 1, dest)
}

function resolveLibSpec(startDir: string, alias: string): DepSpec {
  return lookupLibrary(startDir, alias).spec
}

function resolveDep(
  pkgRoot: string,
  cacheRoot: string,
  name: string,
  spec: DepSpec,
  lock: Map<string, LockedPackage>,
  refresh: Refresh,
): string {
  if (spec.kind === 'lib') {
    const hit = lookupLibrary(pkgRoot, spec.lib)
    return resolveDep(hit.catalog.dir, cacheRoot, name, hit.spec, lock, refresh)
  }
  const pin = pinFor(name, spec, lock, refresh)
  if (spec.kind === 'version') {
    return fetchRegistryPackage(cacheRoot, name, pin?.version ?? spec.version, readManifest(cacheRoot))
  }
  if (spec.kind === 'path') {
    const dest = resolve(pkgRoot, spec.path)
    if (!existsSync(join(dest, 'zee.toml'))) {
      throw new ZeeError(`dep \`${name}\` path \`${spec.path}\` is not a Zee package`, 1, 1, join(pkgRoot, 'zee.toml'))
    }
    return dest
  }
  return materializeGit(cacheRoot, name, resolveGitSpec(spec, pin))
}

function shouldRefresh(name: string, refresh: Refresh): boolean {
  if (refresh === 'all') return true
  if (refresh === 'none') return false
  return refresh.has(name)
}

function pinFor(
  name: string,
  spec: DepSpec,
  lock: Map<string, LockedPackage>,
  refresh: Refresh,
): LockedPackage | undefined {
  if (shouldRefresh(name, refresh)) return undefined
  const pin = lock.get(name)
  if (!pin) return undefined
  if (spec.kind === 'git') {
    if (pin.source !== 'git' || pin.git !== spec.git) return undefined
    return pin
  }
  if (spec.kind === 'version') {
    if (pin.source !== 'registry') return undefined
    if (!satisfiesConstraint(pin.version, spec.version)) return undefined
    return pin
  }
  return undefined
}

function resolveGitSpec(
  spec: Extract<DepSpec, { kind: 'git' }>,
  pin: LockedPackage | undefined,
): Extract<DepSpec, { kind: 'git' }> {
  if (pin?.tag) {
    return { ...spec, tag: pin.tag, rev: pin.rev }
  }
  if (!spec.tag || !isVersionConstraint(spec.tag)) return spec
  if (parseVersion(spec.tag).precision === 'patch') return spec
  const tags = listRemoteGitTags(spec.git).filter(isVersionConstraint)
  const picked = pickMatchingVersion(tags, spec.tag)
  if (!picked) {
    throw new ZeeError(`no git tag of \`${spec.git}\` matches \`${spec.tag}\``, 1, 1, spec.git)
  }
  return { ...spec, tag: picked }
}

function listRemoteGitTags(gitUrl: string): string[] {
  const out = execFileSync('git', ['ls-remote', '--tags', gitUrl], {
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
  const tags: string[] = []
  for (const line of out.split('\n')) {
    const match = /\trefs\/tags\/(\S+)$/.exec(line)
    if (!match) continue
    const tag = match[1]!
    if (tag.endsWith('^{}')) continue
    tags.push(tag)
  }
  return tags
}

function materialize(cacheRoot: string, pkg: LockedPackage): void {
  const dest = join(cacheRoot, CACHE_DIR, pkg.name)
  if (pkg.source === 'git') {
    pkg.root = dest
    pkg.path = `${CACHE_DIR}/${pkg.name}`
    pkg.hash = hashPackage(dest)
    return
  }
  copyPackage(pkg.root, dest)
  pkg.root = dest
  pkg.path = `${CACHE_DIR}/${pkg.name}`
  pkg.hash = hashPackage(dest)
}

function copyPackage(from: string, to: string): void {
  mkdirSync(to, { recursive: true })
  cpSync(join(from, 'zee.toml'), join(to, 'zee.toml'))
  const srcFrom = join(from, 'src')
  const srcTo = join(to, 'src')
  if (existsSync(srcTo)) rmSync(srcTo, { recursive: true, force: true })
  if (existsSync(srcFrom)) cpSync(srcFrom, srcTo, { recursive: true })
}

function materializeGit(
  cacheRoot: string,
  name: string,
  spec: Extract<DepSpec, { kind: 'git' }>,
): string {
  const dest = join(cacheRoot, CACHE_DIR, name)
  const ref = spec.tag ?? spec.branch ?? spec.rev
  if (!existsSync(join(dest, '.git'))) {
    mkdirSync(dirname(dest), { recursive: true })
    if (existsSync(dest)) rmSync(dest, { recursive: true, force: true })
    const args = ['clone']
    if (spec.tag || spec.branch) args.push('--depth', '1', '--branch', spec.tag ?? spec.branch!)
    args.push(spec.git, dest)
    git(args, cacheRoot)
  } else if (ref) {
    git(['fetch', '--tags', '--depth', '1', 'origin', ref], dest)
    git(['checkout', '--force', ref], dest)
  }
  if (spec.rev && gitRev(dest) !== spec.rev) {
    git(['checkout', '--force', spec.rev], dest)
  }
  return dest
}

function git(args: string[], cwd: string): void {
  execFileSync('git', args, {
    cwd,
    stdio: 'pipe',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
}

function gitRev(repo: string): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim()
}

function gitExactTag(repo: string): string | undefined {
  try {
    return execFileSync('git', ['describe', '--tags', '--exact-match'], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  } catch {
    return undefined
  }
}

export function hashPackage(root: string): string {
  const files = [
    join(root, 'zee.toml'),
    ...listPackageSources(root).map((item) => item.file),
  ].sort((a, b) => a.localeCompare(b))
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(posixRel(root, file))
    hash.update('\0')
    hash.update(readFileSync(file))
    hash.update('\0')
  }
  return `sha256:${hash.digest('hex')}`
}

function formatLockfile(lock: Lockfile): string {
  const lines = ['# Generated by zee get / zee update. Do not edit.', `version = ${lock.version}`, '']
  for (const pkg of lock.packages) {
    lines.push('[[pkg]]')
    lines.push(`name = "${pkg.name}"`)
    lines.push(`version = "${pkg.version}"`)
    lines.push(`source = "${pkg.source}"`)
    if (pkg.path) lines.push(`path = "${pkg.path}"`)
    if (pkg.git) lines.push(`git = "${pkg.git}"`)
    if (pkg.tag) lines.push(`tag = "${pkg.tag}"`)
    if (pkg.rev) lines.push(`rev = "${pkg.rev}"`)
    lines.push(`hash = "${pkg.hash}"`)
    lines.push('')
  }
  return `${lines.join('\n')}`
}

function posixRel(from: string, to: string): string {
  const rel = relative(from, to)
  return rel.split('\\').join('/')
}

function unquote(value: string): string {
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return value.slice(1, -1)
  }
  return value
}
