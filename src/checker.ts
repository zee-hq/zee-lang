import type { Block, Expr, Program, Stmt } from './ast.ts'
import { ZeeError } from './error.ts'
import {
  T_BOOL,
  T_I32,
  T_STRING,
  T_UNIT,
  typeEq,
  typeFromName,
  typeName,
  type ZeeType,
} from './types.ts'

export interface CheckedProgram {
  program: Program
  functions: Map<string, ZeeType>
}

class TypeEnv {
  constructor(
    private readonly parent: TypeEnv | undefined,
    private readonly bindings = new Map<string, ZeeType>(),
  ) {}

  define(name: string, type: ZeeType): void {
    this.bindings.set(name, type)
  }

  get(name: string): ZeeType | undefined {
    return this.bindings.get(name) ?? this.parent?.get(name)
  }

  child(): TypeEnv {
    return new TypeEnv(this)
  }
}

export function check(program: Program): CheckedProgram {
  const globals = new TypeEnv(undefined)
  defineBuiltins(globals)

  const functions = new Map<string, ZeeType>()
  for (const stmt of program.stmts) {
    if (stmt.kind !== 'fn') continue
    if (globals.get(stmt.name)) {
      throw error(stmt.loc, `duplicate definition of \`${stmt.name}\``)
    }
    const params = stmt.params.map((param) => resolveType(param.type.name, param.type.loc))
    const ret = stmt.returnType ? resolveType(stmt.returnType.name, stmt.returnType.loc) : T_UNIT
    const fnType: ZeeType = { kind: 'fn', params, ret }
    globals.define(stmt.name, fnType)
    functions.set(stmt.name, fnType)
  }

  for (const stmt of program.stmts) {
    if (stmt.kind === 'fn') {
      const fnType = functions.get(stmt.name)!
      if (fnType.kind !== 'fn') continue
      const bodyEnv = globals.child()
      stmt.params.forEach((param, index) => {
        bodyEnv.define(param.name, fnType.params[index]!)
      })
      const bodyType = checkBlock(stmt.body, bodyEnv, fnType.ret)
      if (!typeEq(bodyType, fnType.ret) && !typeEq(bodyType, T_UNIT)) {
        throw error(
          stmt.body.loc,
          `function \`${stmt.name}\` returns ${typeName(bodyType)}, expected ${typeName(fnType.ret)}`,
        )
      }
      if (!typeEq(fnType.ret, T_UNIT) && typeEq(bodyType, T_UNIT) && !blockHasReturn(stmt.body)) {
        throw error(
          stmt.body.loc,
          `function \`${stmt.name}\` returns Unit, expected ${typeName(fnType.ret)}`,
        )
      }
    } else {
      checkStmt(stmt, globals, T_UNIT)
    }
  }

  const main = functions.get('main')
  if (main) {
    if (main.kind !== 'fn' || main.params.length !== 0) {
      throw error({ file: program.file, line: 1, column: 1 }, '`main` must take no parameters')
    }
    if (!typeEq(main.ret, T_UNIT) && !typeEq(main.ret, T_I32)) {
      throw error({ file: program.file, line: 1, column: 1 }, '`main` must return Unit or i32')
    }
  }

  return { program, functions }
}

function defineBuiltins(env: TypeEnv): void {
  const printable: ZeeType = T_STRING
  env.define('print', { kind: 'fn', params: [printable], ret: T_UNIT })
  env.define('println', { kind: 'fn', params: [printable], ret: T_UNIT })
  env.define('str', { kind: 'fn', params: [T_I32], ret: T_STRING })
}

function resolveType(name: string, loc: { file: string; line: number; column: number }): ZeeType {
  const type = typeFromName(name)
  if (!type) throw error(loc, `unknown type \`${name}\``)
  return type
}

function checkStmt(stmt: Stmt, env: TypeEnv, returnType: ZeeType): ZeeType {
  switch (stmt.kind) {
    case 'let': {
      const initType = checkExpr(stmt.init, env, returnType)
      if (stmt.typeAnn) {
        const annotated = resolveType(stmt.typeAnn.name, stmt.typeAnn.loc)
        if (!typeEq(initType, annotated)) {
          throw error(
            stmt.init.loc,
            `cannot assign ${typeName(initType)} to \`${stmt.name}: ${typeName(annotated)}\``,
          )
        }
        env.define(stmt.name, annotated)
      } else {
        env.define(stmt.name, initType)
      }
      return T_UNIT
    }
    case 'return': {
      const valueType = stmt.expr ? checkExpr(stmt.expr, env, returnType) : T_UNIT
      if (!typeEq(valueType, returnType)) {
        throw error(
          stmt.loc,
          `return has type ${typeName(valueType)}, expected ${typeName(returnType)}`,
        )
      }
      return T_UNIT
    }
    case 'fn':
      throw error(stmt.loc, 'nested functions are not supported yet')
    case 'expr':
      return checkExpr(stmt.expr, env, returnType)
  }
}

function checkBlock(block: Block, env: TypeEnv, returnType: ZeeType): ZeeType {
  const local = env.child()
  if (block.stmts.length === 0) return T_UNIT
  let last: ZeeType = T_UNIT
  for (const stmt of block.stmts) {
    last = checkStmt(stmt, local, returnType)
  }
  const lastStmt = block.stmts[block.stmts.length - 1]
  if (lastStmt?.kind === 'let' || lastStmt?.kind === 'fn') return T_UNIT
  return last
}

function checkExpr(expr: Expr, env: TypeEnv, returnType: ZeeType): ZeeType {
  switch (expr.kind) {
    case 'int':
      return T_I32
    case 'bool':
      return T_BOOL
    case 'string':
      return T_STRING
    case 'ident': {
      const type = env.get(expr.name)
      if (!type) throw error(expr.loc, `undefined name \`${expr.name}\``)
      return type
    }
    case 'unary': {
      const inner = checkExpr(expr.expr, env, returnType)
      if (expr.op === '-' && typeEq(inner, T_I32)) return T_I32
      if (expr.op === '!' && typeEq(inner, T_BOOL)) return T_BOOL
      throw error(expr.loc, `unary \`${expr.op}\` is not defined for ${typeName(inner)}`)
    }
    case 'binary':
      return checkBinary(expr, env, returnType)
    case 'call':
      return checkCall(expr, env, returnType)
    case 'if': {
      const cond = checkExpr(expr.cond, env, returnType)
      if (!typeEq(cond, T_BOOL)) {
        throw error(expr.cond.loc, `if condition must be bool, got ${typeName(cond)}`)
      }
      const thenType = checkBlock(expr.then, env, returnType)
      if (!expr.else) {
        if (!typeEq(thenType, T_UNIT)) {
          throw error(expr.loc, 'if expression is missing `else`')
        }
        return T_UNIT
      }
      const elseType = checkBlock(expr.else, env, returnType)
      if (!typeEq(thenType, elseType)) {
        throw error(
          expr.loc,
          `if branches have different types (${typeName(thenType)} vs ${typeName(elseType)})`,
        )
      }
      return thenType
    }
    case 'block':
      return checkBlock(expr.block, env, returnType)
  }
}

function checkBinary(expr: Extract<Expr, { kind: 'binary' }>, env: TypeEnv, returnType: ZeeType): ZeeType {
  const left = checkExpr(expr.left, env, returnType)
  const right = checkExpr(expr.right, env, returnType)
  const op = expr.op
  if (op === '+' && typeEq(left, T_STRING) && typeEq(right, T_STRING)) return T_STRING
  if ((op === '+' || op === '-' || op === '*' || op === '/') && typeEq(left, T_I32) && typeEq(right, T_I32)) {
    return T_I32
  }
  if ((op === '<' || op === '<=' || op === '>' || op === '>=') && typeEq(left, T_I32) && typeEq(right, T_I32)) {
    return T_BOOL
  }
  if ((op === '==' || op === '!=') && typeEq(left, right) && (left.kind === 'i32' || left.kind === 'bool' || left.kind === 'string')) {
    return T_BOOL
  }
  if ((op === '&&' || op === '||') && typeEq(left, T_BOOL) && typeEq(right, T_BOOL)) return T_BOOL
  throw error(
    expr.loc,
    `operator \`${op}\` is not defined for ${typeName(left)} and ${typeName(right)}`,
  )
}

function checkCall(expr: Extract<Expr, { kind: 'call' }>, env: TypeEnv, returnType: ZeeType): ZeeType {
  if (expr.callee.kind !== 'ident') {
    throw error(expr.callee.loc, 'only named functions can be called')
  }
  const name = expr.callee.name
  if ((name === 'print' || name === 'println') && expr.args.length === 1) {
    const arg = checkExpr(expr.args[0]!, env, returnType)
    if (arg.kind !== 'string' && arg.kind !== 'i32' && arg.kind !== 'bool') {
      throw error(expr.args[0]!.loc, `\`${name}\` cannot print ${typeName(arg)}`)
    }
    return T_UNIT
  }
  if (name === 'str') {
    if (expr.args.length !== 1) throw error(expr.loc, '`str` takes one argument')
    const arg = checkExpr(expr.args[0]!, env, returnType)
    if (arg.kind !== 'i32' && arg.kind !== 'bool') {
      throw error(expr.args[0]!.loc, '`str` expects i32 or bool')
    }
    return T_STRING
  }
  const callee = checkExpr(expr.callee, env, returnType)
  if (callee.kind !== 'fn') {
    throw error(expr.callee.loc, `cannot call ${typeName(callee)}`)
  }
  if (expr.args.length !== callee.params.length) {
    throw error(
      expr.loc,
      `\`${name}\` expects ${callee.params.length} argument(s), got ${expr.args.length}`,
    )
  }
  expr.args.forEach((arg, index) => {
    const actual = checkExpr(arg, env, returnType)
    const expected = callee.params[index]!
    if (!typeEq(actual, expected)) {
      throw error(arg.loc, `argument ${index + 1} has type ${typeName(actual)}, expected ${typeName(expected)}`)
    }
  })
  return callee.ret
}

function blockHasReturn(block: Block): boolean {
  return block.stmts.some((stmt) => stmt.kind === 'return')
}

function error(loc: { file: string; line: number; column: number }, message: string): ZeeError {
  return new ZeeError(message, loc.line, loc.column, loc.file)
}
