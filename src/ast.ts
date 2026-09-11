import type { Loc } from './error.ts'
import type { FloatKind, IntKind, ZeeType } from './types.ts'

export type BinaryOp =
  | '+'
  | '-'
  | '*'
  | '/'
  | '%'
  | '=='
  | '==='
  | '!='
  | '!=='
  | '<'
  | '<='
  | '>'
  | '>='
  | '&&'
  | '||'
  | '?:'
  | '<===>'

export type UnaryOp = '-' | '!'

export type AssignOp = '=' | '??=' | '!!=' | '&&=' | '||=' | '+=' | '-=' | '*=' | '/=' | '%='

export type LoopMode = 'while' | 'until' | 'do-while' | 'do-until'

export type Visibility = 'private' | 'internal' | 'pub'

export interface ImportName {
  name: string
  alias?: string
}

export interface SourceUnit {
  file: string
  module: string
  stmts: Stmt[]
}

export type TypeAst =
  | { kind: 'named'; name: string; loc: Loc }
  | { kind: 'unit'; loc: Loc }
  | { kind: 'tuple'; parts: TypeAst[]; loc: Loc }
  | { kind: 'generic'; name: string; args: TypeAst[]; loc: Loc }
  | { kind: 'fn'; params: TypeAst[]; ret: TypeAst; loc: Loc }
  | { kind: 'array'; elem: TypeAst; loc: Loc }

export interface StructField {
  name: string
  mutable: boolean
  visibility: Visibility
  type: TypeAst
  loc: Loc
}

export interface AssociatedConst {
  name: string
  mutable: boolean
  visibility: Visibility
  typeAnn?: TypeAst
  init: Expr
  loc: Loc
}

export interface Param {
  name: string
  type: TypeAst
  loc: Loc
  mutable: boolean
}

export interface Block {
  stmts: Stmt[]
  loc: Loc
}

export interface StructVariant {
  name: string
  visibility?: Visibility
  data: boolean
  readonly: boolean
  identity: boolean
  fields: StructField[]
  loc: Loc
}

export interface InterfaceMethod {
  name: string
  mutating: boolean
  params: Param[]
  returnType?: TypeAst
  loc: Loc
}

export type InterpPart =
  | { kind: 'text'; value: string }
  | { kind: 'expr'; expr: Expr }

export type MatchPattern =
  | { kind: 'wildcard'; loc: Loc }
  | { kind: 'value'; expr: Expr; loc: Loc }
  | { kind: 'variant'; path: string[]; fields?: { name: string }[]; loc: Loc }

export interface MatchArm {
  patterns: MatchPattern[]
  body: Expr
  loc: Loc
}

export type Expr =
  | { kind: 'int'; value: bigint; suffix?: IntKind; loc: Loc }
  | { kind: 'float'; value: number; suffix?: FloatKind; loc: Loc }
  | { kind: 'bool'; value: boolean; loc: Loc }
  | { kind: 'string'; value: string; loc: Loc }
  | { kind: 'char'; value: string; loc: Loc }
  | { kind: 'interp'; parts: InterpPart[]; loc: Loc }
  | { kind: 'unit'; loc: Loc }
  | { kind: 'ident'; name: string; loc: Loc }
  | { kind: 'binary'; op: BinaryOp; left: Expr; right: Expr; loc: Loc }
  | { kind: 'unary'; op: UnaryOp; expr: Expr; loc: Loc }
  | { kind: 'call'; callee: Expr; args: Expr[]; typeArgs?: TypeAst[]; loc: Loc }
  | { kind: 'tuple'; items: Expr[]; loc: Loc }
  | { kind: 'tupleIndex'; target: Expr; index: number; loc: Loc }
  | { kind: 'index'; target: Expr; index: Expr; loc: Loc }
  | { kind: 'member'; target: Expr; field: string; loc: Loc }
  | { kind: 'arrayLit'; items: Expr[]; loc: Loc; elemType?: ZeeType; asList?: boolean }
  | {
      kind: 'mapLit'
      entries: { key: Expr; value: Expr }[]
      loc: Loc
      keyType?: ZeeType
      valueType?: ZeeType
    }
  | {
      kind: 'structLit'
      name: string
      qualifier?: string[]
      fields: { name: string; value: Expr }[]
      loc: Loc
    }
  | { kind: 'if'; cond: Expr; then: Block; else?: Block; loc: Loc }
  | { kind: 'block'; block: Block; loc: Loc; lambdaParams?: string[]; mapType?: { key: ZeeType; value: ZeeType } }
  | { kind: 'lambda'; params: string[]; body: Block; loc: Loc }
  | { kind: 'match'; scrutinee: Expr; arms: MatchArm[]; loc: Loc }
  | { kind: 'copy'; target: Expr; fields: { name: string; value: Expr }[]; loc: Loc }
  | { kind: 'returnExpr'; expr?: Expr; loc: Loc }
  | { kind: 'isType'; expr: Expr; type: TypeAst; loc: Loc }

export type Stmt =
  | {
      kind: 'bind'
      mutable: boolean
      visibility: Visibility
      name: string
      typeAnn?: TypeAst
      init: Expr
      loc: Loc
    }
  | {
      kind: 'destructure'
      mutable: boolean
      names: string[]
      init: Expr
      loc: Loc
    }
  | { kind: 'assign'; name: string; op: AssignOp; value: Expr; loc: Loc }
  | { kind: 'indexAssign'; target: Expr; index: Expr; op: AssignOp; value: Expr; loc: Loc }
  | { kind: 'fieldAssign'; target: Expr; field: string; op: AssignOp; value: Expr; loc: Loc }
  | { kind: 'redim'; name: string; type: TypeAst; loc: Loc }
  | { kind: 'redimArray'; name: string; preserve: boolean; length: Expr; loc: Loc }
  | { kind: 'return'; expr?: Expr; loc: Loc }
  | { kind: 'loop'; mode: LoopMode; cond: Expr; body: Block; loc: Loc }
  | {
      kind: 'forC'
      init?: Stmt
      cond?: Expr
      step?: Stmt
      body: Block
      loc: Loc
    }
  | { kind: 'forForever'; body: Block; loc: Loc }
  | { kind: 'forRange'; name: string; start: Expr; end: Expr; body: Block; loc: Loc }
  | { kind: 'forIn'; name: string; indexName?: string; seq: Expr; body: Block; loc: Loc }
  | { kind: 'break'; loc: Loc }
  | { kind: 'continue'; loc: Loc }
  | { kind: 'defer'; body: Expr; loc: Loc }
  | {
      kind: 'fn'
      visibility: Visibility
      name: string
      typeParams: string[]
      params: Param[]
      returnType?: TypeAst
      body: Block
      loc: Loc
    }
  | {
      kind: 'structDecl'
      visibility: Visibility
      name: string
      readonly: boolean
      data: boolean
      sealed: boolean
      identity: boolean
      fields: StructField[]
      associated: AssociatedConst[]
      nested: Stmt[]
      variants: StructVariant[]
      implements: string[]
      methods: Extract<Stmt, { kind: 'fn' }>[]
      loc: Loc
    }
  | {
      kind: 'enumDecl'
      visibility: Visibility
      name: string
      variants: { name: string; loc: Loc }[]
      loc: Loc
    }
  | {
      kind: 'typeAliasDecl'
      visibility: Visibility
      name: string
      typeParams: string[]
      aliased: TypeAst
      loc: Loc
    }
  | {
      kind: 'newtypeDecl'
      visibility: Visibility
      name: string
      inner: TypeAst
      loc: Loc
    }
  | {
      kind: 'interfaceDecl'
      visibility: Visibility
      name: string
      sealed: boolean
      methods: InterfaceMethod[]
      loc: Loc
    }
  | {
      kind: 'import'
      path: string[]
      names?: ImportName[]
      alias?: string
      loc: Loc
    }
  | { kind: 'expr'; expr: Expr; loc: Loc }

export interface Program {
  file: string
  stmts: Stmt[]
  units: SourceUnit[]
}
