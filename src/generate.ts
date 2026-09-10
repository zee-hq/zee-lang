import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ZeeError } from './error.ts'
import { pluralizeLast } from './inflect.ts'
import { findProjectRoot } from './project.ts'

const MODULE_SEGMENT_RE = /^[a-z][a-z0-9_]*$/

export type ControllerKind = 'empty' | 'api' | 'invokable'

export interface GenerateOptions {
  cwd: string
  path: string
}

export interface GeneratedFile {
  root: string
  dir: string
  file: string
  name: string
  importPath: string
}

export interface GenerateControllerOptions extends GenerateOptions {
  kind?: ControllerKind
}

export interface GeneratedResource {
  module: GeneratedFile
  controller: GeneratedFile
  service: GeneratedFile
}

export interface GenerateFlags {
  api?: boolean
  invokable?: boolean
}

/** Nest/Laravel schematic: src/<plural>/<plural>.module.zee. AC-generate-module. */
export function generateModule(options: GenerateOptions): GeneratedFile {
  return writeRole(options, 'module', moduleSource)
}

/** Nest file name + Laravel --api / --invokable. AC-generate-controller. */
export function generateController(options: GenerateControllerOptions): GeneratedFile {
  const kind = options.kind ?? 'empty'
  return writeRole(options, 'controller', (importPath, name) => controllerSource(name, kind, importPath))
}

/** Nest-style <name>.service.zee. AC-generate-service. */
export function generateService(options: GenerateOptions): GeneratedFile {
  return writeRole(options, 'service', (_importPath, name) => serviceSource(name))
}

/** Nest resource: module + controller + service. AC-generate-resource. */
export function generateResource(options: GenerateControllerOptions): GeneratedResource {
  const layout = resolveLayout(options)
  const kind = options.kind ?? 'empty'
  const files = [
    join(layout.dir, `${layout.name}.module.zee`),
    join(layout.dir, `${layout.name}.controller.zee`),
    join(layout.dir, `${layout.name}.service.zee`),
  ]
  const existing = files.find((file) => existsSync(file))
  if (existing) {
    throw new ZeeError(`file \`${existing}\` already exists`, 1, 1, existing)
  }
  return {
    module: generateModule(options),
    controller: generateController({ ...options, kind }),
    service: generateService(options),
  }
}

export function controllerKindFromFlags(flags: GenerateFlags): ControllerKind {
  if (flags.api && flags.invokable) {
    throw new ZeeError('use either `--api` or `--invokable` / `-i`, not both', 1, 1, 'zee')
  }
  if (flags.api) return 'api'
  if (flags.invokable) return 'invokable'
  return 'empty'
}

export function parseModulePath(raw: string): string[] {
  const normalized = raw.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (normalized.length === 0) {
    throw new ZeeError('missing module name', 1, 1, 'zee')
  }
  if (normalized === 'src' || normalized.startsWith('src/')) {
    const hint = normalized === 'src' ? '<name>' : normalized.slice(4)
    throw new ZeeError(`module path is relative to src/ (use \`${hint}\`)`, 1, 1, 'zee')
  }
  const segments = normalized.split('/').filter((part) => part.length > 0)
  for (const segment of segments) {
    if (segment === '.' || segment === '..' || !MODULE_SEGMENT_RE.test(segment)) {
      throw new ZeeError(
        `invalid module name \`${segment}\` (use lowercase letters, digits, or \`_\`; path is relative to src/)`,
        1,
        1,
        'zee',
      )
    }
  }
  return pluralizeLast(segments)
}

function writeRole(
  options: GenerateOptions,
  role: 'module' | 'controller' | 'service',
  source: (importPath: string, name: string) => string,
): GeneratedFile {
  const layout = resolveLayout(options)
  const file = join(layout.dir, `${layout.name}.${role}.zee`)
  if (existsSync(file)) {
    throw new ZeeError(`${role} file \`${file}\` already exists`, 1, 1, file)
  }
  mkdirSync(layout.dir, { recursive: true })
  writeFileSync(file, source(layout.importPath, layout.name), 'utf8')
  return { ...layout, file }
}

function resolveLayout(options: GenerateOptions): Omit<GeneratedFile, 'file'> {
  const root = findProjectRoot(options.cwd)
  if (!root) {
    throw new ZeeError('not a Zee project (no zee.toml — run inside a package or use `zee new`)', 1, 1, options.cwd)
  }
  const segments = parseModulePath(options.path)
  const name = segments[segments.length - 1]!
  const dir = join(root, 'src', ...segments)
  assertNoFileFolderClash(root, segments)
  return { root, dir, name, importPath: segments.join('.') }
}

function assertNoFileFolderClash(root: string, segments: string[]): void {
  for (let i = 0; i < segments.length; i++) {
    const siblingFile = join(root, 'src', ...segments.slice(0, i), `${segments[i]}.zee`)
    if (existsSync(siblingFile)) {
      throw new ZeeError(
        `file vs folder clash: \`${siblingFile}\` already exists (cannot create module directory \`${segments.slice(0, i + 1).join('/')}\`)`,
        1,
        1,
        siblingFile,
      )
    }
  }
}

function moduleSource(importPath: string, name: string): string {
  return `// ${name}.module — module ${importPath}
// Same directory = same module. Import from elsewhere: import ${importPath}
`
}

function controllerSource(name: string, kind: ControllerKind, importPath: string): string {
  const header = `// ${name}.controller — module ${importPath}\n`
  if (kind === 'api') {
    return `${header}fn index() {}\nfn store() {}\nfn show(id: i32) {}\nfn update(id: i32) {}\nfn destroy(id: i32) {}\n`
  }
  if (kind === 'invokable') {
    return `${header}fn invoke() {}\n`
  }
  return header
}

function serviceSource(name: string): string {
  return `// ${name}.service\n`
}
