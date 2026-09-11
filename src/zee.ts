import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Program } from './ast.ts'
import { check } from './checker.ts'
import { ZeeError } from './error.ts'
import { display, interpret, type RunResult, type RuntimeIo, type TestReport, type ZeeValue } from './interpreter.ts'
import { parse } from './parser.ts'
import { getPackages } from './pkg.ts'
import {
  findProjectRoot,
  isPackageSourceFile,
  listPackageSources,
  readManifest,
} from './project.ts'

export { VERSION } from './error.ts'
export { ZeeError, PanicError } from './error.ts'
export { parse } from './parser.ts'
export { check } from './checker.ts'
export { interpret, display } from './interpreter.ts'

export interface ExecuteOptions {
  file?: string
  print?: (text: string) => void
  callMain?: boolean
  root?: string
  processEnv?: NodeJS.Dict<string>
  readText?: (path: string) => string | undefined
}

export interface ExecuteResult extends RunResult {
  stdout: string
}

export function execute(source: string, options: ExecuteOptions = {}): ExecuteResult {
  const file = options.file ?? '<input>'
  let stdout = ''
  const print = options.print ?? ((text: string) => {
    stdout += text
  })
  const program = parse(source, file)
  check(program)
  const result = interpret(
    program,
    { print, root: options.root, processEnv: options.processEnv, readText: options.readText },
    { callMain: options.callMain },
  )
  return { ...result, stdout }
}

export const OFFICIAL_TEST_MODULE = 'ZeeTest'

/** Loads a package plus `[deps]` (AC-ZEE-4). `zee test` injects `libs/ZeeTest`. */
export function loadProgramFromPath(
  path: string,
  options?: { injectTestLib?: boolean; overlay?: Map<string, string> },
): Program {
  const read = (file: string) => {
    const key = resolve(file)
    return options?.overlay?.get(key) ?? options?.overlay?.get(file) ?? readFileSync(file, 'utf8')
  }
  const root = isPackageSourceFile(path)
  if (!root) {
    return parse(read(path), path)
  }
  const sources = listPackageSources(root)
  const localModules = new Set(sources.map((item) => item.module).filter((module) => module.length > 0))
  const manifest = readManifest(root)
  if (manifest.deps.size > 0) {
    const got = getPackages(root)
    for (const pkg of got.packages) {
      if (localModules.has(pkg.name)) {
        throw new ZeeError(
          `dep \`${pkg.name}\` clashes with local module \`${pkg.name}\``,
          1,
          1,
          path,
        )
      }
      sources.push(...listPackageSources(pkg.root, pkg.name))
      localModules.add(pkg.name)
    }
  }
  if (options?.injectTestLib) injectOfficialTestLib(root, sources, localModules, manifest)
  const units = sources.map((source) => {
    const parsed = parse(read(source.file), source.file)
    return { file: source.file, module: source.module, stmts: parsed.stmts, innerDoc: parsed.innerDoc }
  })
  const stmts = units.flatMap((unit) => unit.stmts)
  return { file: path, stmts, units }
}

export function officialTestLibRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../libs/ZeeTest')
}

function injectOfficialTestLib(
  root: string,
  sources: { file: string; module: string }[],
  localModules: Set<string>,
  manifest: ReturnType<typeof readManifest>,
): void {
  const lib = officialTestLibRoot()
  if (resolve(root) === lib) return
  if (localModules.has(OFFICIAL_TEST_MODULE) || manifest.deps.has(OFFICIAL_TEST_MODULE)) return
  sources.push(...listPackageSources(lib, OFFICIAL_TEST_MODULE))
}

export function executePath(path: string, options: Omit<ExecuteOptions, 'file'> = {}): ExecuteResult {
  const program = loadProgramFromPath(path)
  let stdout = ''
  const print = options.print ?? ((text: string) => {
    stdout += text
  })
  check(program)
  const root = options.root ?? findProjectRoot(dirname(path))
  const result = interpret(
    program,
    { print, root, processEnv: options.processEnv, readText: options.readText },
    { callMain: options.callMain },
  )
  return { ...result, stdout }
}

export function executeFile(path: string, options: Omit<ExecuteOptions, 'file'> = {}): ExecuteResult {
  return executePath(path, options)
}

export function checkPath(path: string): void {
  check(loadProgramFromPath(path))
}

export function checkSource(source: string, file = '<input>'): void {
  check(parse(source, file))
}

export interface PackageTestResult {
  reports: TestReport[]
  passed: number
  failed: number
  stdout: string
  exitCode: number
}

export function runPackageTests(
  root: string,
  options: Omit<ExecuteOptions, 'file' | 'callMain'> = {},
): PackageTestResult {
  const manifest = readManifest(root)
  const entry = resolve(root, manifest.entry)
  const program = loadProgramFromPath(entry, { injectTestLib: true })
  check(program)
  let stdout = ''
  const print = (text: string) => {
    stdout += text
    options.print?.(text)
  }
  const invoke = {
    module: (program.units ?? []).some((unit) => unit.module === OFFICIAL_TEST_MODULE)
      ? OFFICIAL_TEST_MODULE
      : '',
    name: 'run',
  }
  const io: RuntimeIo = { print, root, processEnv: options.processEnv, readText: options.readText }
  const result = interpret(program, io, { callMain: false, invoke })
  const reports = io.test?.reports ?? []
  const passed = reports.filter((item) => item.ok).length
  const failed = reports.filter((item) => !item.ok).length
  return { reports, passed, failed, stdout, exitCode: result.exitCode }
}

export function formatValue(value: ZeeValue): string {
  if (value.type === 'string') return JSON.stringify(value.value)
  return display(value)
}

export class ZeeSession {
  private declarations: string[] = []

  eval(source: string): { stdout: string; display: string | undefined } {
    const trimmed = source.trim()
    if (trimmed.length === 0) return { stdout: '', display: undefined }

    const incoming = parse(trimmed, '<repl>')
    const keep = incoming.stmts.some(
      (stmt) =>
        stmt.kind === 'fn' ||
        stmt.kind === 'structDecl' ||
        stmt.kind === 'enumDecl' ||
        stmt.kind === 'typeAliasDecl' ||
        stmt.kind === 'newtypeDecl' ||
        stmt.kind === 'interfaceDecl' ||
        stmt.kind === 'bind' ||
        stmt.kind === 'redim' ||
        stmt.kind === 'redimArray' ||
        stmt.kind === 'assign' ||
        stmt.kind === 'indexAssign' ||
        stmt.kind === 'fieldAssign',
    )
    const combined = [...this.declarations, trimmed].join('\n')
    const program = parse(combined, '<repl>')
    check(program)

    let stdout = ''
    const result = interpret(
      program,
      { print: (text) => { stdout += text } },
      { callMain: false },
    )

    if (keep) this.declarations.push(trimmed)

    const last = incoming.stmts[incoming.stmts.length - 1]
    const show = last?.kind === 'expr' && result.value.type !== 'unit'
    return { stdout, display: show ? formatValue(result.value) : undefined }
  }
}
