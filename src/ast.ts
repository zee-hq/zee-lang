import type { Loc } from './error.ts'

export type BinaryOp =
  | '+'
  | '-'
  | '*'
  | '/'
  | '=='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | '&&'
  | '||'

export type UnaryOp = '-' | '!'

export interface TypeAst {
  name: string
  loc: Loc
}

export interface Param {
  name: string
  type: TypeAst
  loc: Loc
}

export interface Block {
  stmts: Stmt[]
  loc: Loc
}

export type Expr =
  | { kind: 'int'; value: number; loc: Loc }
  | { kind: 'bool'; value: boolean; loc: Loc }
  | { kind: 'string'; value: string; loc: Loc }
  | { kind: 'ident'; name: string; loc: Loc }
  | { kind: 'binary'; op: BinaryOp; left: Expr; right: Expr; loc: Loc }
  | { kind: 'unary'; op: UnaryOp; expr: Expr; loc: Loc }
  | { kind: 'call'; callee: Expr; args: Expr[]; loc: Loc }
  | { kind: 'if'; cond: Expr; then: Block; else?: Block; loc: Loc }
  | { kind: 'block'; block: Block; loc: Loc }

export type Stmt =
  | { kind: 'let'; name: string; typeAnn?: TypeAst; init: Expr; loc: Loc }
  | { kind: 'return'; expr?: Expr; loc: Loc }
  | { kind: 'fn'; name: string; params: Param[]; returnType?: TypeAst; body: Block; loc: Loc }
  | { kind: 'expr'; expr: Expr; loc: Loc }

export interface Program {
  file: string
  stmts: Stmt[]
}
