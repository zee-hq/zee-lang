import type { Block, Expr, Program, Stmt } from './ast.ts'
import { ZeeError } from './error.ts'

export type ZeeValue =
  | { type: 'i32'; value: number }
  | { type: 'bool'; value: boolean }
  | { type: 'string'; value: string }
  | { type: 'unit' }
  | { type: 'fn'; name: string; params: string[]; body: Block }
  | { type: 'builtin'; name: string }

export interface RuntimeIo {
  print: (text: string) => void
}

const UNIT: ZeeValue = { type: 'unit' }

class ReturnSignal {
  constructor(readonly value: ZeeValue) {}
}

class Env {
  constructor(
    private readonly parent: Env | undefined,
    private readonly values = new Map<string, ZeeValue>(),
  ) {}

  define(name: string, value: ZeeValue): void {
    this.values.set(name, value)
  }

  get(name: string, loc: { file: string; line: number; column: number }): ZeeValue {
    const value = this.values.get(name) ?? this.parent?.getUnchecked(name)
    if (!value) throw new ZeeError(`undefined name \`${name}\``, loc.line, loc.column, loc.file)
    return value
  }

  private getUnchecked(name: string): ZeeValue | undefined {
    return this.values.get(name) ?? this.parent?.getUnchecked(name)
  }

  child(): Env {
    return new Env(this)
  }

  root(): Env {
    return this.parent ? this.parent.root() : this
  }
}

export interface RunResult {
  value: ZeeValue
  exitCode: number
}

export function interpret(program: Program, io: RuntimeIo, options: { callMain?: boolean } = {}): RunResult {
  const globals = new Env(undefined)
  globals.define('print', { type: 'builtin', name: 'print' })
  globals.define('println', { type: 'builtin', name: 'println' })
  globals.define('str', { type: 'builtin', name: 'str' })

  for (const stmt of program.stmts) {
    if (stmt.kind === 'fn') {
      globals.define(stmt.name, {
        type: 'fn',
        name: stmt.name,
        params: stmt.params.map((param) => param.name),
        body: stmt.body,
      })
    }
  }

  let last: ZeeValue = UNIT
  try {
    for (const stmt of program.stmts) {
      if (stmt.kind === 'fn') continue
      last = execStmt(stmt, globals, io)
    }
  } catch (signal) {
    if (signal instanceof ReturnSignal) {
      throw new ZeeError('`return` outside of a function', 1, 1, program.file)
    }
    throw signal
  }

  const callMain = options.callMain !== false
  const main = maybeGet(globals, 'main')
  if (callMain && main?.type === 'fn') {
    last = callFn(main, [], io, globals, { file: program.file, line: 1, column: 1 })
  }

  const exitCode = last.type === 'i32' ? last.value : 0
  return { value: last, exitCode }
}

function maybeGet(env: Env, name: string): ZeeValue | undefined {
  try {
    return env.get(name, { file: '<runtime>', line: 1, column: 1 })
  } catch {
    return undefined
  }
}

function execStmt(stmt: Stmt, env: Env, io: RuntimeIo): ZeeValue {
  switch (stmt.kind) {
    case 'let':
      env.define(stmt.name, evalExpr(stmt.init, env, io))
      return UNIT
    case 'return':
      throw new ReturnSignal(stmt.expr ? evalExpr(stmt.expr, env, io) : UNIT)
    case 'fn':
      throw new ZeeError('nested functions are not supported yet', stmt.loc.line, stmt.loc.column, stmt.loc.file)
    case 'expr':
      return evalExpr(stmt.expr, env, io)
  }
}

function execBlock(block: Block, env: Env, io: RuntimeIo): ZeeValue {
  const local = env.child()
  let last: ZeeValue = UNIT
  for (const stmt of block.stmts) {
    last = execStmt(stmt, local, io)
  }
  const lastStmt = block.stmts[block.stmts.length - 1]
  if (lastStmt?.kind === 'let') return UNIT
  return last
}

function evalExpr(expr: Expr, env: Env, io: RuntimeIo): ZeeValue {
  switch (expr.kind) {
    case 'int':
      return { type: 'i32', value: expr.value }
    case 'bool':
      return { type: 'bool', value: expr.value }
    case 'string':
      return { type: 'string', value: expr.value }
    case 'ident':
      return env.get(expr.name, expr.loc)
    case 'unary': {
      const inner = evalExpr(expr.expr, env, io)
      if (expr.op === '-' && inner.type === 'i32') return { type: 'i32', value: i32(-inner.value) }
      if (expr.op === '!' && inner.type === 'bool') return { type: 'bool', value: !inner.value }
      throw new ZeeError('invalid unary operand', expr.loc.line, expr.loc.column, expr.loc.file)
    }
    case 'binary':
      return evalBinary(expr, env, io)
    case 'call':
      return evalCall(expr, env, io)
    case 'if': {
      const cond = evalExpr(expr.cond, env, io)
      if (cond.type !== 'bool') {
        throw new ZeeError('if condition must be bool', expr.cond.loc.line, expr.cond.loc.column, expr.cond.loc.file)
      }
      if (cond.value) return execBlock(expr.then, env, io)
      if (expr.else) return execBlock(expr.else, env, io)
      return UNIT
    }
    case 'block':
      return execBlock(expr.block, env, io)
  }
}

function evalBinary(expr: Extract<Expr, { kind: 'binary' }>, env: Env, io: RuntimeIo): ZeeValue {
  if (expr.op === '&&' || expr.op === '||') {
    const left = evalExpr(expr.left, env, io)
    if (left.type !== 'bool') {
      throw new ZeeError('logical operand must be bool', expr.left.loc.line, expr.left.loc.column, expr.left.loc.file)
    }
    if (expr.op === '&&') {
      if (!left.value) return { type: 'bool', value: false }
      const right = evalExpr(expr.right, env, io)
      if (right.type !== 'bool') {
        throw new ZeeError('logical operand must be bool', expr.right.loc.line, expr.right.loc.column, expr.right.loc.file)
      }
      return { type: 'bool', value: right.value }
    }
    if (left.value) return { type: 'bool', value: true }
    const right = evalExpr(expr.right, env, io)
    if (right.type !== 'bool') {
      throw new ZeeError('logical operand must be bool', expr.right.loc.line, expr.right.loc.column, expr.right.loc.file)
    }
    return { type: 'bool', value: right.value }
  }

  const left = evalExpr(expr.left, env, io)
  const right = evalExpr(expr.right, env, io)
  if (expr.op === '+' && left.type === 'string' && right.type === 'string') {
    return { type: 'string', value: left.value + right.value }
  }
  if (left.type === 'i32' && right.type === 'i32') {
    switch (expr.op) {
      case '+':
        return { type: 'i32', value: i32(left.value + right.value) }
      case '-':
        return { type: 'i32', value: i32(left.value - right.value) }
      case '*':
        return { type: 'i32', value: i32(left.value * right.value) }
      case '/':
        if (right.value === 0) {
          throw new ZeeError('division by zero', expr.loc.line, expr.loc.column, expr.loc.file)
        }
        return { type: 'i32', value: i32(truncTowardZero(left.value / right.value)) }
      case '<':
        return { type: 'bool', value: left.value < right.value }
      case '<=':
        return { type: 'bool', value: left.value <= right.value }
      case '>':
        return { type: 'bool', value: left.value > right.value }
      case '>=':
        return { type: 'bool', value: left.value >= right.value }
      case '==':
        return { type: 'bool', value: left.value === right.value }
      case '!=':
        return { type: 'bool', value: left.value !== right.value }
    }
  }
  if ((left.type === 'bool' && right.type === 'bool') || (left.type === 'string' && right.type === 'string')) {
    if (expr.op === '==') return { type: 'bool', value: left.value === right.value }
    if (expr.op === '!=') return { type: 'bool', value: left.value !== right.value }
  }
  throw new ZeeError(`operator \`${expr.op}\` is not defined for these values`, expr.loc.line, expr.loc.column, expr.loc.file)
}

function evalCall(expr: Extract<Expr, { kind: 'call' }>, env: Env, io: RuntimeIo): ZeeValue {
  if (expr.callee.kind !== 'ident') {
    throw new ZeeError('only named functions can be called', expr.callee.loc.line, expr.callee.loc.column, expr.callee.loc.file)
  }
  const callee = env.get(expr.callee.name, expr.callee.loc)
  const args = expr.args.map((arg) => evalExpr(arg, env, io))
  if (callee.type === 'builtin') return callBuiltin(callee.name, args, io, expr.loc)
  if (callee.type === 'fn') return callFn(callee, args, io, env, expr.loc)
  throw new ZeeError('cannot call this value', expr.callee.loc.line, expr.callee.loc.column, expr.callee.loc.file)
}

function callFn(
  fn: Extract<ZeeValue, { type: 'fn' }>,
  args: ZeeValue[],
  io: RuntimeIo,
  globals: Env,
  loc: { file: string; line: number; column: number },
): ZeeValue {
  if (args.length !== fn.params.length) {
    throw new ZeeError(
      `\`${fn.name}\` expects ${fn.params.length} argument(s)`,
      loc.line,
      loc.column,
      loc.file,
    )
  }
  const local = globals.root().child()
  fn.params.forEach((name, index) => local.define(name, args[index]!))
  try {
    return execBlock(fn.body, local, io)
  } catch (signal) {
    if (signal instanceof ReturnSignal) return signal.value
    throw signal
  }
}

function callBuiltin(
  name: string,
  args: ZeeValue[],
  io: RuntimeIo,
  loc: { file: string; line: number; column: number },
): ZeeValue {
  if (name === 'print' || name === 'println') {
    const text = display(args[0] ?? UNIT)
    io.print(name === 'println' ? `${text}\n` : text)
    return UNIT
  }
  if (name === 'str') {
    return { type: 'string', value: display(args[0] ?? UNIT) }
  }
  throw new ZeeError(`unknown builtin \`${name}\``, loc.line, loc.column, loc.file)
}

export function display(value: ZeeValue): string {
  switch (value.type) {
    case 'i32':
      return String(value.value)
    case 'bool':
      return value.value ? 'true' : 'false'
    case 'string':
      return value.value
    case 'unit':
      return '()'
    case 'fn':
      return `fn ${value.name}`
    case 'builtin':
      return `fn ${value.name}`
  }
}

function i32(value: number): number {
  return value | 0
}

function truncTowardZero(value: number): number {
  return value < 0 ? Math.ceil(value) : Math.floor(value)
}
