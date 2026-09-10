import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { ZeeError } from './error.ts'

const NAME_RE = /^[a-z][a-z0-9_-]*$/
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

export interface Manifest {
  name: string
  version: string
  entry: string
}

export function validatePackageName(name: string): void {
  if (!NAME_RE.test(name)) {
    throw new ZeeError(
      `invalid package name \`${name}\` (use lowercase letters, digits, \`-\` or \`_\`)`,
      1,
      1,
      'zee.toml',
    )
  }
}

/** Scaffolds a Zee package: zee.toml + src/main.zee. Covered by test/project.test.ts (AC-new-project). */
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
  writeFileSync(join(root, 'zee.toml'), manifestSource(options.name), 'utf8')
  writeFileSync(join(root, DEFAULT_ENTRY), mainSource(options.name), 'utf8')
  writeFileSync(join(root, '.gitignore'), '.zee/\n', 'utf8')

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
export function listPackageSources(root: string): { file: string; module: string }[] {
  const src = join(root, 'src')
  if (!existsSync(src) || !statSync(src).isDirectory()) {
    throw new ZeeError('project is missing src/', 1, 1, src)
  }
  const files: { file: string; module: string }[] = []
  walkModuleDir(src, '', files)
  return files.sort((a, b) => a.file.localeCompare(b.file))
}

function walkModuleDir(dir: string, module: string, files: { file: string; module: string }[]): void {
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
    files.push({ file: join(dir, name), module })
  }
  for (const name of dirs) {
    const child = module ? `${module}.${name}` : name
    walkModuleDir(join(dir, name), child, files)
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
  let inPackage = false
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.length === 0 || line.startsWith('#')) continue
    if (line === '[package]') {
      inPackage = true
      continue
    }
    if (line.startsWith('[')) {
      inPackage = false
      continue
    }
    if (!inPackage) continue
    const match = /^([A-Za-z][A-Za-z0-9_]*)\s*=\s*"([^"]*)"\s*$/.exec(line)
    if (!match) {
      throw new ZeeError(`invalid manifest line \`${line}\``, 1, 1, file)
    }
    values.set(match[1]!, match[2]!)
  }
  const name = values.get('name')
  if (!name) throw new ZeeError('zee.toml is missing package.name', 1, 1, file)
  validatePackageName(name)
  return {
    name,
    version: values.get('version') ?? '0.1.0',
    entry: values.get('entry') ?? DEFAULT_ENTRY,
  }
}

function manifestSource(name: string): string {
  return `[package]\nname = "${name}"\nversion = "0.1.0"\nentry = "${DEFAULT_ENTRY}"\n`
}

function mainSource(name: string): string {
  return `fn main() {\n  println("hello, ${name}")\n}\n`
}

function readUtf8(path: string): string {
  return readFileSync(path, 'utf8')
}
