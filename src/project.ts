import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { ZeeError } from './error.ts'

const NAME_RE = /^[A-Za-z][A-Za-z0-9_-]*$/
const DEFAULT_ENTRY = 'src/main.zee'

export interface CreateProjectOptions {
  name: string
  parentDir: string
  mode: 'new' | 'init'
}

export interface CreatedProject {
  root: string
  entry: string
  name: string
}

export type DepSpec =
  | { kind: 'path'; path: string }
  | { kind: 'git'; git: string; tag?: string; rev?: string; branch?: string }
  | { kind: 'lib'; lib: string }
  | { kind: 'version'; version: string }

export interface Manifest {
  name: string
  version: string
  entry: string
  description?: string
  author?: string
  company?: string
  contact?: string
  license?: string
  homepage?: string
  repository?: string
  /** All `[package]` quoted keys, including name/version/entry. */
  meta: Map<string, string>
  deps: Map<string, DepSpec>
  registryUrl?: string
}

export function validatePackageName(name: string): void {
  if (!NAME_RE.test(name)) {
    throw new ZeeError(
      `invalid package name \`${name}\` (use letters, digits, \`-\` or \`_\`)`,
      1,
      1,
      'zee.toml',
    )
  }
}

/** Scaffolds a Zee package: zee.toml + src/main.zee + editor workspace. Covered by test/project.test.ts (AC-new-project). */
export function createProject(options: CreateProjectOptions): CreatedProject {
  validatePackageName(options.name)
  const parent = resolve(options.parentDir)
  const root = options.mode === 'new' ? join(parent, options.name) : parent

  if (options.mode === 'new' && existsSync(root)) {
    throw new ZeeError(`directory \`${root}\` already exists`, 1, 1, root)
  }
  if (existsSync(join(root, 'zee.toml'))) {
    throw new ZeeError(`\`${root}\` is already a Zee project`, 1, 1, join(root, 'zee.toml'))
  }

  mkdirSync(join(root, 'src'), { recursive: true })
  mkdirSync(join(root, '.vscode'), { recursive: true })
  writeFileSync(join(root, 'zee.toml'), manifestSource(options.name), 'utf8')
  writeFileSync(join(root, DEFAULT_ENTRY), mainSource(options.name), 'utf8')
  writeFileSync(join(root, '.gitignore'), '.zee/\n', 'utf8')
  writeFileSync(join(root, '.vscode/settings.json'), editorSettingsSource(), 'utf8')
  writeFileSync(join(root, '.vscode/extensions.json'), editorExtensionsSource(), 'utf8')

  return { root, name: options.name, entry: join(root, DEFAULT_ENTRY) }
}

export function findProjectRoot(startDir: string): string | undefined {
  let dir = resolve(startDir)
  while (true) {
    if (existsSync(join(dir, 'zee.toml'))) return dir
    const parent = resolve(dir, '..')
    if (parent === dir) return undefined
    dir = parent
  }
}

export function readManifest(root: string): Manifest {
  const file = join(root, 'zee.toml')
  return parseManifest(readUtf8(file), file)
}

export function resolveEntry(cwd: string, file?: string): string {
  if (file) return isAbsolute(file) ? file : resolve(cwd, file)
  const root = findProjectRoot(cwd)
  if (!root) {
    throw new ZeeError('missing file path (or run inside a Zee project)', 1, 1, cwd)
  }
  const manifest = readManifest(root)
  return resolve(root, manifest.entry)
}

/** All `.zee` files under `src/`, grouped by directory module. Nested folders are other modules. */
export function listPackageSources(root: string, modulePrefix = ''): { file: string; module: string }[] {
  const src = join(root, 'src')
  if (!existsSync(src) || !statSync(src).isDirectory()) {
    throw new ZeeError('project is missing src/', 1, 1, src)
  }
  const files: { file: string; module: string }[] = []
  walkModuleDir(src, '', files, modulePrefix)
  return files.sort((a, b) => a.file.localeCompare(b.file))
}

/** `users.service.test.zee` only. Not `foo_test.zee`, not `.spec.zee`. */
export function isZeeTestFile(file: string): boolean {
  return basename(file).endsWith('.test.zee')
}

function qualifyModule(module: string, prefix: string): string {
  if (!prefix) return module
  return module ? `${prefix}.${module}` : prefix
}

function walkModuleDir(
  dir: string,
  module: string,
  files: { file: string; module: string }[],
  prefix: string,
): void {
  const names = readdirSync(dir)
  const zeeFiles: string[] = []
  const dirs = new Set<string>()
  for (const name of names) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      dirs.add(name)
      continue
    }
    if (extname(name) === '.zee') zeeFiles.push(name)
  }
  for (const name of zeeFiles) {
    const stem = basename(name, '.zee')
    if (dirs.has(stem)) {
      const file = join(dir, name)
      throw new ZeeError(
        `file vs folder clash: \`${file}\` and \`${join(dir, stem)}/\``,
        1,
        1,
        file,
      )
    }
    files.push({ file: join(dir, name), module: qualifyModule(module, prefix) })
  }
  for (const name of dirs) {
    const child = module ? `${module}.${name}` : name
    walkModuleDir(join(dir, name), child, files, prefix)
  }
}

/** Immediate `src/*.zee` files. Nested folders are other modules. */
export function listRootModuleFiles(root: string): string[] {
  return listPackageSources(root)
    .filter((item) => item.module === '')
    .map((item) => item.file)
}

export function isPackageSourceFile(path: string): string | undefined {
  const root = findProjectRoot(dirname(path))
  if (!root) return undefined
  const resolved = resolve(path)
  const src = resolve(root, 'src')
  if (extname(resolved) !== '.zee') return undefined
  const rel = relative(src, resolved)
  if (rel.startsWith('..') || isAbsolute(rel)) return undefined
  return root
}

export function isRootModuleFile(path: string): string | undefined {
  return isPackageSourceFile(path)
}

export function defaultInitName(cwd: string): string {
  const name = basename(resolve(cwd))
  validatePackageName(name)
  return name
}

export function parseManifest(source: string, file = 'zee.toml'): Manifest {
  const values = new Map<string, string>()
  const deps = new Map<string, DepSpec>()
  let registryUrl: string | undefined
  let section: 'package' | 'deps' | 'registry' | undefined
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.length === 0 || line.startsWith('#')) continue
    if (line === '[package]') {
      section = 'package'
      continue
    }
    if (line === '[deps]') {
      section = 'deps'
      continue
    }
    if (line === '[registry]') {
      section = 'registry'
      continue
    }
    if (line.startsWith('[')) {
      section = undefined
      continue
    }
    if (section === 'package') {
      const match = /^([A-Za-z][A-Za-z0-9_]*)\s*=\s*"([^"]*)"\s*$/.exec(line)
      if (!match) {
        throw new ZeeError(`invalid manifest line \`${line}\``, 1, 1, file)
      }
      values.set(match[1]!, match[2]!)
      continue
    }
    if (section === 'registry') {
      const match = /^([A-Za-z][A-Za-z0-9_]*)\s*=\s*"([^"]*)"\s*$/.exec(line)
      if (!match) {
        throw new ZeeError(`invalid registry line \`${line}\``, 1, 1, file)
      }
      if (match[1] === 'url') registryUrl = match[2]
      continue
    }
    if (section === 'deps') {
      const match = /^([A-Za-z][A-Za-z0-9_-]*)\s*=\s*(.+)$/.exec(line)
      if (!match) {
        throw new ZeeError(`invalid deps line \`${line}\``, 1, 1, file)
      }
      const depName = match[1]!
      validatePackageName(depName)
      deps.set(depName, parseDepSpec(match[2]!.trim(), depName, file))
    }
  }
  const name = values.get('name')
  if (!name) throw new ZeeError('zee.toml is missing package.name', 1, 1, file)
  validatePackageName(name)
  const version = values.get('version') ?? '0.1.0'
  if (!values.has('version')) values.set('version', version)
  const entry = values.get('entry') ?? DEFAULT_ENTRY
  return {
    name,
    version,
    entry,
    description: optionalMeta(values, 'description'),
    author: optionalMeta(values, 'author'),
    company: optionalMeta(values, 'company'),
    contact: optionalMeta(values, 'contact'),
    license: optionalMeta(values, 'license'),
    homepage: optionalMeta(values, 'homepage'),
    repository: optionalMeta(values, 'repository'),
    meta: values,
    deps,
    registryUrl,
  }
}

function optionalMeta(values: Map<string, string>, key: string): string | undefined {
  const value = values.get(key)
  if (value === undefined || value.length === 0) return undefined
  return value
}

export function parseDepSpec(raw: string, name: string, file: string): DepSpec {
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
    return { kind: 'version', version: raw.slice(1, -1) }
  }
  if (!raw.startsWith('{') || !raw.endsWith('}')) {
    throw new ZeeError(`invalid deps spec for \`${name}\``, 1, 1, file)
  }
  const fields = parseInlineTable(raw.slice(1, -1), file)
  if (fields.lib && (fields.path || fields.git)) {
    throw new ZeeError(`dep \`${name}\` cannot mix lib with path or git`, 1, 1, file)
  }
  if (fields.path && (fields.git || fields.tag || fields.rev || fields.branch)) {
    throw new ZeeError(`dep \`${name}\` cannot mix path and git`, 1, 1, file)
  }
  if (fields.lib) {
    return { kind: 'lib', lib: fields.lib }
  }
  if (fields.path) {
    return { kind: 'path', path: fields.path }
  }
  if (fields.git) {
    return {
      kind: 'git',
      git: fields.git,
      tag: fields.tag,
      rev: fields.rev,
      branch: fields.branch,
    }
  }
  throw new ZeeError(`dep \`${name}\` needs path, git, lib, or a SemVer string`, 1, 1, file)
}

export function parseInlineTable(inner: string, file: string): Record<string, string> {
  const fields: Record<string, string> = {}
  const trimmed = inner.trim()
  if (trimmed.length === 0) return fields
  for (const part of splitTopLevel(inner, ',')) {
    const item = part.trim()
    if (item.length === 0) continue
    const match = /^([A-Za-z][A-Za-z0-9_.]*)\s*=\s*"([^"]*)"\s*$/.exec(item)
    if (!match) {
      throw new ZeeError(`invalid manifest line \`${item}\``, 1, 1, file)
    }
    fields[match[1]!] = match[2]!
  }
  return fields
}

function splitTopLevel(source: string, sep: string): string[] {
  const parts: string[] = []
  let current = ''
  let inQuote = false
  for (const ch of source) {
    if (ch === '"') {
      inQuote = !inQuote
      current += ch
      continue
    }
    if (ch === sep && !inQuote) {
      parts.push(current)
      current = ''
      continue
    }
    current += ch
  }
  parts.push(current)
  return parts
}

function manifestSource(name: string): string {
  return `[package]\nname = "${name}"\nversion = "0.1.0"\nentry = "${DEFAULT_ENTRY}"\n`
}

function mainSource(name: string): string {
  return `fn main() {\n  println("hello, ${name}")\n}\n`
}

/** Workspace-only: Color Theme ≠ File Icon Theme. Do not set this globally. */
function editorSettingsSource(): string {
  return `${JSON.stringify(
    {
      'workbench.iconTheme': 'zee-icons',
      'workbench.colorTheme': 'Zee Dark',
    },
    null,
    2,
  )}\n`
}

function editorExtensionsSource(): string {
  return `${JSON.stringify({ recommendations: ['zee-hq.zee'] }, null, 2)}\n`
}

function readUtf8(path: string): string {
  return readFileSync(path, 'utf8')
}
