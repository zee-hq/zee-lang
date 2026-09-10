import { readFileSync } from 'node:fs'
import type { Program } from './ast.ts'
import { check } from './checker.ts'
import { display, interpret, type RunResult, type ZeeValue } from './interpreter.ts'
import { parse } from './parser.ts'
import { isPackageSourceFile, listPackageSources } from './project.ts'

export { VERSION } from './error.ts'
export { ZeeError, PanicError } from './error.ts'
export { parse } from './parser.ts'
export { check } from './checker.ts'
export { interpret, display } from './interpreter.ts'

export interface ExecuteOptions {
  file?: string
  print?: (text: string) => void
  callMain?: boolean
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
  const result = interpret(program, { print }, { callMain: options.callMain })
  return { ...result, stdout }
}

export function loadProgramFromPath(path: string): Program {
  const root = isPackageSourceFile(path)
  if (!root) {
    return parse(readFileSync(path, 'utf8'), path)
  }
  const sources = listPackageSources(root)
  const units = sources.map((source) => {
    const parsed = parse(readFileSync(source.file, 'utf8'), source.file)
    return { file: source.file, module: source.module, stmts: parsed.stmts }
  })
  const stmts = units.flatMap((unit) => unit.stmts)
  return { file: path, stmts, units }
}

export function executePath(path: string, options: Omit<ExecuteOptions, 'file'> = {}): ExecuteResult {
  const program = loadProgramFromPath(path)
  let stdout = ''
  const print = options.print ?? ((text: string) => {
    stdout += text
  })
  check(program)
  const result = interpret(program, { print }, { callMain: options.callMain })
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
