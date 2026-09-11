import type { AssignOp, Block, Expr, MatchPattern, Program, Stmt, TypeAst, Visibility } from './ast.ts'
import { ZeeError } from './error.ts'
import {
  canWidenInt,
  intFits,
  intBits,
  intSigned,
  isEquatable,
  isHashable,
  isIdentityType,
  isIntKind,
  isIntType,
  isFloatKind,
  isFloatType,
  isInterpolable,
  isNeverType,
  isOrdType,
  isReceiverType,
  isAssignable,
  namedTypeKey,
  T_BOOL,
  T_CHAR,
  T_ERROR,
  T_FAIL,
  T_I32,
  T_NEVER,
  T_STRING,
  T_U8,
  T_U32,
  T_UNIT,
  T_USIZE,
  typeEq,
  typeFromName,
  typeImplements,
  typeName,
  type ZeeType,
  type EnumType,
  type InterfaceType,
  type NewtypeType,
  type SealedType,
  type SealedVariantType,
} from './types.ts'

export interface TypeHint {
  file: string
  line: number
  column: number
  name: string
  type: string
}

export interface CheckedProgram {
  program: Program
  functions: Map<string, ZeeType>
  hints: TypeHint[]
}

interface TypeAliasInfo {
  name: string
  module: string
  visibility: Visibility
  typeParams: string[]
  aliased: TypeAst
  loc: { file: string; line: number; column: number }
  file: string
}

interface MethodInfo {
  name: string
  type: Extract<ZeeType, { kind: 'fn' }>
  mutating: boolean
  visibility: Visibility
  file: string
  module: string
}

interface AssociatedInfo {
  name: string
  type: ZeeType
  visibility: Visibility
  file: string
  module: string
}

class TypeEnv {
  private captureLimit: TypeEnv | undefined
  loopDepth = 0
  fnDepth = 0
  describeDepth = 0
  file: string
  module: string
  moduleHome: TypeEnv
  private readonly structMap = new Map<string, Extract<ZeeType, { kind: 'struct' }>>()
  private readonly enumMap = new Map<string, EnumType>()
  private readonly sealedMap = new Map<string, SealedType>()
  private readonly aliasMap = new Map<string, TypeAliasInfo>()
  private readonly newtypeMap = new Map<string, NewtypeType>()
  private readonly interfaceMap = new Map<string, InterfaceType>()

  private modules: Map<string, TypeEnv> | undefined
  private readonly structVis = new Map<string, Visibility>()
  private readonly enumVis = new Map<string, Visibility>()
  private readonly sealedVis = new Map<string, Visibility>()
  private readonly aliasVis = new Map<string, Visibility>()
  private readonly newtypeVis = new Map<string, Visibility>()
  private readonly interfaceVis = new Map<string, Visibility>()
  private readonly methodMap = new Map<string, Map<string, MethodInfo>>()
  private readonly associatedMap = new Map<string, Map<string, AssociatedInfo>>()
  private readonly mutatingFns = new Set<string>()
  private readonly typeParamNames = new Set<string>()
  readonly hints: TypeHint[]

  constructor(
    private readonly parent: TypeEnv | undefined,
    private readonly bindings = new Map<
      string,
      { type: ZeeType; mutable: boolean; visibility: Visibility }
    >(),
  ) {
    this.file = parent?.file ?? '<input>'
    this.module = parent?.module ?? ''
    this.moduleHome = parent?.moduleHome ?? this
    this.hints = parent?.hints ?? []
  }

  attachModules(modules: Map<string, TypeEnv>): void {
    this.modules = modules
  }

  getModule(name: string): TypeEnv | undefined {
    return this.modules?.get(name) ?? this.parent?.getModule(name)
  }

  define(name: string, type: ZeeType, mutable = false, visibility: Visibility = 'private'): void {
    this.bindings.set(name, { type, mutable, visibility })
  }

  defineStruct(
    name: string,
    type: Extract<ZeeType, { kind: 'struct' }>,
    visibility: Visibility = 'private',
  ): void {
    this.structMap.set(name, type)
    this.structVis.set(name, visibility)
  }

  defineEnum(name: string, type: EnumType, visibility: Visibility = 'private'): void {
    this.enumMap.set(name, type)
    this.enumVis.set(name, visibility)
  }

  defineSealed(name: string, type: SealedType, visibility: Visibility = 'private'): void {
    this.sealedMap.set(name, type)
    this.sealedVis.set(name, visibility)
  }

  defineAlias(info: TypeAliasInfo): void {
    this.aliasMap.set(info.name, info)
    this.aliasVis.set(info.name, info.visibility)
  }

  defineNewtype(name: string, type: NewtypeType, visibility: Visibility = 'private'): void {
    this.newtypeMap.set(name, type)
    this.newtypeVis.set(name, visibility)
  }

  defineInterface(name: string, type: InterfaceType, visibility: Visibility = 'private'): void {
    this.interfaceMap.set(name, type)
    this.interfaceVis.set(name, visibility)
  }

  getStruct(name: string): Extract<ZeeType, { kind: 'struct' }> | undefined {
    return this.structMap.get(name) ?? this.parent?.getStruct(name)
  }

  getEnum(name: string): EnumType | undefined {
    return this.enumMap.get(name) ?? this.parent?.getEnum(name)
  }

  getSealed(name: string): SealedType | undefined {
    return this.sealedMap.get(name) ?? this.parent?.getSealed(name)
  }

  getAlias(name: string): TypeAliasInfo | undefined {
    return this.aliasMap.get(name) ?? this.parent?.getAlias(name)
  }

  getNewtype(name: string): NewtypeType | undefined {
    return this.newtypeMap.get(name) ?? this.parent?.getNewtype(name)
  }

  getInterface(name: string): InterfaceType | undefined {
    return this.interfaceMap.get(name) ?? this.parent?.getInterface(name)
  }

  structVisibility(name: string): Visibility | undefined {
    return this.structVis.get(name) ?? this.parent?.structVisibility(name)
  }

  enumVisibility(name: string): Visibility | undefined {
    return this.enumVis.get(name) ?? this.parent?.enumVisibility(name)
  }

  sealedVisibility(name: string): Visibility | undefined {
    return this.sealedVis.get(name) ?? this.parent?.sealedVisibility(name)
  }

  aliasVisibility(name: string): Visibility | undefined {
    return this.aliasVis.get(name) ?? this.parent?.aliasVisibility(name)
  }

  newtypeVisibility(name: string): Visibility | undefined {
    return this.newtypeVis.get(name) ?? this.parent?.newtypeVisibility(name)
  }

  interfaceVisibility(name: string): Visibility | undefined {
    return this.interfaceVis.get(name) ?? this.parent?.interfaceVisibility(name)
  }

  defineMethod(typeKey: string, info: MethodInfo): void {
    let bucket = this.methodMap.get(typeKey)
    if (!bucket) {
      bucket = new Map()
      this.methodMap.set(typeKey, bucket)
    }
    bucket.set(info.name, info)
  }

  ownMethod(typeKey: string, name: string): MethodInfo | undefined {
    return this.methodMap.get(typeKey)?.get(name)
  }

  getMethod(typeKey: string, name: string): MethodInfo | undefined {
    return this.ownMethod(typeKey, name) ?? this.parent?.getMethod(typeKey, name)
  }

  defineAssociated(typeKey: string, info: AssociatedInfo): void {
    let bucket = this.associatedMap.get(typeKey)
    if (!bucket) {
      bucket = new Map()
      this.associatedMap.set(typeKey, bucket)
    }
    bucket.set(info.name, info)
  }

  ownAssociated(typeKey: string, name: string): AssociatedInfo | undefined {
    return this.associatedMap.get(typeKey)?.get(name)
  }

  getAssociated(typeKey: string, name: string): AssociatedInfo | undefined {
    return this.ownAssociated(typeKey, name) ?? this.parent?.getAssociated(typeKey, name)
  }

  markMutatingFn(name: string): void {
    this.mutatingFns.add(name)
  }

  isMutatingFn(name: string): boolean {
    return this.mutatingFns.has(name) || (this.parent?.isMutatingFn(name) ?? false)
  }

  defineTypeParam(name: string): void {
    this.typeParamNames.add(name)
  }

  isTypeParam(name: string): boolean {
    return this.typeParamNames.has(name) || (this.parent?.isTypeParam(name) ?? false)
  }

  hasOwn(name: string): boolean {
    return this.bindings.has(name)
  }

  hasOwnStruct(name: string): boolean {
    return this.structMap.has(name)
  }

  hasOwnEnum(name: string): boolean {
    return this.enumMap.has(name)
  }

  hasOwnSealed(name: string): boolean {
    return this.sealedMap.has(name)
  }

  hasOwnAlias(name: string): boolean {
    return this.aliasMap.has(name)
  }

  hasOwnNewtype(name: string): boolean {
    return this.newtypeMap.has(name)
  }

  hasOwnInterface(name: string): boolean {
    return this.interfaceMap.has(name)
  }

  hasOwnType(name: string): boolean {
    return (
      this.hasOwnStruct(name) ||
      this.hasOwnEnum(name) ||
      this.hasOwnSealed(name) ||
      this.hasOwnAlias(name) ||
      this.hasOwnNewtype(name) ||
      this.hasOwnInterface(name)
    )
  }

  own(name: string): { type: ZeeType; mutable: boolean; visibility: Visibility } | undefined {
    return this.bindings.get(name)
  }

  get(name: string): ZeeType | undefined {
    return this.lookup(name)?.type
  }

  lookup(name: string): { type: ZeeType; mutable: boolean; visibility: Visibility; home: TypeEnv } | undefined {
    const own = this.bindings.get(name)
    if (own) return { ...own, home: this }
    return this.parent?.lookup(name)
  }

  setType(name: string, type: ZeeType): void {
    const own = this.bindings.get(name)
    if (own) {
      own.type = type
      return
    }
    this.parent?.setType(name, type)
  }

  child(): TypeEnv {
    const env = new TypeEnv(this)
    env.captureLimit = this.captureLimit
    env.loopDepth = this.loopDepth
    env.fnDepth = this.fnDepth
    env.describeDepth = this.describeDepth
    env.file = this.file
    env.module = this.module
    env.moduleHome = this.moduleHome
    return env
  }

  withLoop(): TypeEnv {
    const env = this.child()
    env.loopDepth += 1
    return env
  }

  inLoop(): boolean {
    return this.loopDepth > 0
  }

  inFn(): boolean {
    return this.fnDepth > 0
  }

  lambdaFrame(): TypeEnv {
    const env = new TypeEnv(this)
    env.captureLimit = env
    env.loopDepth = 0
    env.fnDepth = this.fnDepth + 1
    return env
  }

  captureError(name: string): string | undefined {
    if (!this.captureLimit) return undefined
    const binding = this.lookup(name)
    if (!binding || !binding.mutable) return undefined
    if (binding.home.isAtOrBelow(this.captureLimit)) return undefined
    return `lambda cannot capture var \`${name}\``
  }

  private isAtOrBelow(ancestor: TypeEnv): boolean {
    let current: TypeEnv | undefined = this
    while (current) {
      if (current === ancestor) return true
      current = current.parent
    }
    return false
  }
}

export function check(program: Program): CheckedProgram {
  const units = program.units ?? [{ file: program.file, module: '', stmts: program.stmts }]
  const builtins = new TypeEnv(undefined)
  defineBuiltins(builtins)

  const moduleIds = [...new Set(units.map((unit) => unit.module))]
  const moduleEnvs = new Map<string, TypeEnv>()
  for (const module of moduleIds) {
    const env = builtins.child()
    env.file = `<module:${module || 'root'}>`
    env.module = module
    env.moduleHome = env
    moduleEnvs.set(module, env)
  }
  builtins.attachModules(moduleEnvs)

  const fileEnvs = new Map<string, TypeEnv>()
  for (const unit of units) {
    const moduleEnv = moduleEnvs.get(unit.module)!
    const fileEnv = moduleEnv.child()
    fileEnv.file = unit.file
    fileEnv.module = unit.module
    fileEnv.moduleHome = moduleEnv
    fileEnvs.set(unit.file, fileEnv)
  }

  for (const unit of units) {
    const fileEnv = fileEnvs.get(unit.file)!
    for (const stmt of unit.stmts) {
      if (stmt.kind === 'structDecl') {
        registerStructDecl(stmt, fileEnv, unit.module, unit.file, undefined)
      } else if (stmt.kind === 'enumDecl') {
        defineTopLevelName(stmt.name, stmt.visibility, fileEnv, stmt.loc)
        const enumType: EnumType = {
          kind: 'enum',
          name: stmt.name,
          module: unit.module,
          variants: stmt.variants.map((variant) => variant.name),
          implements: [],
        }
        publishEnum(fileEnv, stmt.name, enumType, stmt.visibility)
      } else if (stmt.kind === 'typeAliasDecl') {
        rejectReservedTypeName(stmt.name, stmt.loc)
        defineTopLevelName(stmt.name, stmt.visibility, fileEnv, stmt.loc)
        const info: TypeAliasInfo = {
          name: stmt.name,
          module: unit.module,
          visibility: stmt.visibility,
          typeParams: stmt.typeParams,
          aliased: stmt.aliased,
          loc: stmt.loc,
          file: unit.file,
        }
        fileEnv.defineAlias(info)
        if (stmt.visibility !== 'private') {
          fileEnv.moduleHome.defineAlias(info)
        }
      } else if (stmt.kind === 'newtypeDecl') {
        rejectReservedTypeName(stmt.name, stmt.loc)
        defineTopLevelName(stmt.name, stmt.visibility, fileEnv, stmt.loc)
        const newtype: NewtypeType = {
          kind: 'newtype',
          name: stmt.name,
          module: unit.module,
          inner: T_UNIT,
          implements: [],
        }
        fileEnv.defineNewtype(stmt.name, newtype, stmt.visibility)
        if (stmt.visibility !== 'private') {
          fileEnv.moduleHome.defineNewtype(stmt.name, newtype, stmt.visibility)
        }
      } else if (stmt.kind === 'interfaceDecl') {
        rejectReservedTypeName(stmt.name, stmt.loc)
        defineTopLevelName(stmt.name, stmt.visibility, fileEnv, stmt.loc)
        const iface: InterfaceType = {
          kind: 'interface',
          name: stmt.name,
          module: unit.module,
          sealed: stmt.sealed,
          methods: [],
          implementors: [],
        }
        fileEnv.defineInterface(stmt.name, iface, stmt.visibility)
        if (stmt.visibility !== 'private') {
          fileEnv.moduleHome.defineInterface(stmt.name, iface, stmt.visibility)
        }
      }
    }
  }

  const deps = new Map<string, Set<string>>()
  for (const module of moduleIds) deps.set(module, new Set())
  for (const unit of units) {
    const fileEnv = fileEnvs.get(unit.file)!
    for (const stmt of unit.stmts) {
      if (stmt.kind !== 'import') continue
      const target = resolveImportTarget(stmt, moduleEnvs, stmt.loc)
      if (target.module !== unit.module) deps.get(unit.module)!.add(target.module)
      applyImport(stmt, fileEnv, moduleEnvs, { skipMissing: true })
    }
  }
  detectImportCycle(deps, { file: program.file, line: 1, column: 1 })

  for (const unit of units) {
    const fileEnv = fileEnvs.get(unit.file)!
    for (const stmt of unit.stmts) {
      if (stmt.kind === 'structDecl' && !stmt.sealed) {
        fillStructFields(stmt, fileEnv, unit.file, undefined)
      } else if (stmt.kind === 'structDecl' && stmt.sealed) {
        const sealedType = fileEnv.getSealed(stmt.name)!
        const seen = new Set<string>()
        sealedType.variants = stmt.variants.map((variant) => {
          if (seen.has(variant.name)) throw error(variant.loc, `duplicate variant \`${variant.name}\``)
          seen.add(variant.name)
          const fieldSeen = new Set<string>()
          const fields = variant.fields.map((field) => {
            if (fieldSeen.has(field.name)) throw error(field.loc, `duplicate field \`${field.name}\``)
            fieldSeen.add(field.name)
            return {
              name: field.name,
              mutable: field.mutable,
              visibility: field.visibility,
              file: unit.file,
              type: resolveTypeAst(field.type, fileEnv),
            }
          })
          return {
            name: variant.name,
            visibility: variant.visibility ?? stmt.visibility,
            file: unit.file,
            data: variant.data,
            readonly: variant.readonly,
            fields,
          }
        })
      } else if (stmt.kind === 'interfaceDecl') {
        const iface = fileEnv.getInterface(stmt.name)!
        const seen = new Set<string>()
        iface.methods = stmt.methods.map((method) => {
          if (seen.has(method.name)) throw error(method.loc, `duplicate method \`${method.name}\``)
          seen.add(method.name)
          return {
            name: method.name,
            mutating: method.mutating,
            params: method.params.map((param) => resolveTypeAst(param.type, fileEnv)),
            ret: method.returnType ? resolveTypeAst(method.returnType, fileEnv) : T_UNIT,
          }
        })
      }
    }
  }

  for (const unit of units) {
    const fileEnv = fileEnvs.get(unit.file)!
    for (const stmt of unit.stmts) {
      if (stmt.kind !== 'newtypeDecl') continue
      const newtype = fileEnv.getNewtype(stmt.name)!
      const inner = resolveTypeAst(stmt.inner, fileEnv)
      if (inner.kind === 'newtype' && inner.name === newtype.name && inner.module === newtype.module) {
        throw error(stmt.loc, `cyclic newtype \`${stmt.name}\``)
      }
      newtype.inner = inner
      const ctor: ZeeType = { kind: 'fn', params: [inner], ret: newtype }
      fileEnv.define(stmt.name, ctor, false, stmt.visibility)
      if (stmt.visibility !== 'private') {
        fileEnv.moduleHome.define(stmt.name, ctor, false, stmt.visibility)
      }
    }
  }

  const functions = new Map<string, ZeeType>()
  const registerFn = (
    stmt: Extract<Stmt, { kind: 'fn' }>,
    fileEnv: TypeEnv,
    unitModule: string,
    unitFile: string,
  ): void => {
    const seenParams = new Set<string>()
    const sigEnv = fileEnv.child()
    for (const typeParam of stmt.typeParams) {
      if (seenParams.has(typeParam)) throw error(stmt.loc, `duplicate type parameter \`${typeParam}\``)
      seenParams.add(typeParam)
      sigEnv.defineTypeParam(typeParam)
    }
    const params = stmt.params.map((param) => resolveTypeAst(param.type, sigEnv))
    const ret = stmt.returnType ? resolveTypeAst(stmt.returnType, sigEnv) : T_UNIT
    const fnType: Extract<ZeeType, { kind: 'fn' }> = {
      kind: 'fn',
      params,
      ret,
      typeParams: stmt.typeParams.length > 0 ? stmt.typeParams : undefined,
    }
    const first = stmt.params[0]
    const selfType = params[0]
    const asMethod = first?.name === 'self' && !!selfType && isReceiverType(selfType)
    if (asMethod) {
      const typeKey = namedTypeKey(selfType)!
      if (fileEnv.ownMethod(typeKey, stmt.name) || fileEnv.moduleHome.ownMethod(typeKey, stmt.name)) {
        throw error(stmt.loc, `duplicate method \`${stmt.name}\` on ${typeName(selfType)}`)
      }
      const method: MethodInfo = {
        name: stmt.name,
        type: fnType,
        mutating: first.mutable,
        visibility: stmt.visibility,
        file: unitFile,
        module: unitModule,
      }
      fileEnv.defineMethod(typeKey, method)
      if (stmt.visibility !== 'private') {
        fileEnv.moduleHome.defineMethod(typeKey, method)
      }
      if (first.mutable) {
        fileEnv.markMutatingFn(stmt.name)
        if (stmt.visibility !== 'private') fileEnv.moduleHome.markMutatingFn(stmt.name)
      }
      return
    }
    defineTopLevelName(stmt.name, stmt.visibility, fileEnv, stmt.loc)
    fileEnv.define(stmt.name, fnType, false, stmt.visibility)
    if (stmt.visibility !== 'private') {
      fileEnv.moduleHome.define(stmt.name, fnType, false, stmt.visibility)
    }
    functions.set(stmt.name, fnType)
  }
  for (const unit of units) {
    const fileEnv = fileEnvs.get(unit.file)!
    for (const stmt of unit.stmts) {
      if (stmt.kind === 'fn') registerFn(stmt, fileEnv, unit.module, unit.file)
      if (stmt.kind === 'structDecl') {
        registerStructMembers(stmt, fileEnv, unit.module, unit.file, undefined, registerFn)
      }
    }
  }

  for (const unit of units) {
    const fileEnv = fileEnvs.get(unit.file)!
    for (const stmt of unit.stmts) {
      if (stmt.kind !== 'structDecl' || stmt.sealed) continue
      const structType = fileEnv.getStruct(stmt.name)!
      structType.implements = resolveImplements(stmt.implements, fileEnv, unit.module, stmt.loc)
      for (const iface of structType.implements) {
        if (!iface.implementors.some((item) => item.name === structType.name && item.module === structType.module)) {
          iface.implementors.push({ name: structType.name, module: structType.module })
        }
        checkImplementsMethods(structType, iface, fileEnv, stmt.loc)
      }
    }
  }

  for (const module of topoModules(moduleIds, deps)) {
    for (const unit of units) {
      if (unit.module !== module) continue
      const fileEnv = fileEnvs.get(unit.file)!
      for (const stmt of unit.stmts) {
        if (stmt.kind === 'import') applyImport(stmt, fileEnv, moduleEnvs)
      }
      for (const stmt of unit.stmts) {
        if (
          stmt.kind === 'fn' ||
          stmt.kind === 'structDecl' ||
          stmt.kind === 'enumDecl' ||
          stmt.kind === 'typeAliasDecl' ||
          stmt.kind === 'newtypeDecl' ||
          stmt.kind === 'interfaceDecl' ||
          stmt.kind === 'import'
        ) {
          continue
        }
        checkStmt(stmt, fileEnv, T_UNIT)
      }
    }
  }

  for (const unit of units) {
    const fileEnv = fileEnvs.get(unit.file)!
    for (const stmt of unit.stmts) {
      if (stmt.kind === 'fn') checkFnBody(stmt, fileEnv)
      if (stmt.kind === 'structDecl') {
        checkStructBodies(stmt, fileEnv, undefined)
      }
    }
  }

  const rootEnv = fileEnvs.get(program.file) ?? [...fileEnvs.values()].find((env) => env.module === '')
  const main = rootEnv?.get('main') ?? functions.get('main')
  if (main) {
    if (main.kind !== 'fn' || main.params.length !== 0) {
      throw error({ file: program.file, line: 1, column: 1 }, '`main` must take no parameters')
    }
    if (!typeEq(main.ret, T_UNIT) && !typeEq(main.ret, T_I32)) {
      throw error({ file: program.file, line: 1, column: 1 }, '`main` must return Unit or i32')
    }
  }

  return { program, functions, hints: builtins.hints }
}

function fnTypeForCheck(
  stmt: Extract<Stmt, { kind: 'fn' }>,
  fileEnv: TypeEnv,
  fnTypeHint?: ZeeType,
): Extract<ZeeType, { kind: 'fn' }> | undefined {
  if (fnTypeHint?.kind === 'fn') return fnTypeHint
  const named = fileEnv.get(stmt.name)
  if (named?.kind === 'fn') return named
  const first = stmt.params[0]
  if (first?.name !== 'self') return undefined
  const selfType = resolveTypeAst(first.type, fileEnv)
  if (!isReceiverType(selfType)) return undefined
  return lookupMethod(selfType, stmt.name, fileEnv)?.type
}

function checkFnBody(
  stmt: Extract<Stmt, { kind: 'fn' }>,
  fileEnv: TypeEnv,
  fnTypeHint?: ZeeType,
): void {
  const fnType = fnTypeForCheck(stmt, fileEnv, fnTypeHint)
  if (!fnType) return
  const bodyEnv = fileEnv.child()
  bodyEnv.fnDepth += 1
  for (const typeParam of stmt.typeParams) {
    bodyEnv.defineTypeParam(typeParam)
  }
  stmt.params.forEach((param, index) => {
    bodyEnv.define(param.name, fnType.params[index]!, param.mutable)
  })
  const bodyType = checkBlock(stmt.body, bodyEnv, fnType.ret, fnType.ret)
  if (!isAssignable(bodyType, fnType.ret) && !typeEq(bodyType, T_UNIT)) {
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
}

function checkDescribeBody(arg: Expr, env: TypeEnv): void {
  let block: Block
  if (arg.kind === 'block') {
    block = arg.block
  } else if (arg.kind === 'lambda') {
    if (arg.params.length !== 0) {
      throw error(arg.loc, '`describe` block takes no parameters')
    }
    block = arg.body
  } else {
    throw error(arg.loc, '`describe` block must be `{ ... }`')
  }
  const inner = env.child()
  inner.describeDepth += 1
  checkBlock(block, inner, T_UNIT)
}

function defineTopLevelName(
  name: string,
  visibility: Visibility,
  fileEnv: TypeEnv,
  loc: { file: string; line: number; column: number },
): void {
  if (fileEnv.hasOwn(name) || fileEnv.hasOwnType(name)) {
    throw error(loc, `duplicate definition of \`${name}\``)
  }
  if (visibility === 'private') return
  if (fileEnv.moduleHome.hasOwn(name) || fileEnv.moduleHome.hasOwnType(name)) {
    throw error(loc, `duplicate definition of \`${name}\``)
  }
}

function publishEnum(fileEnv: TypeEnv, name: string, type: EnumType, visibility: Visibility): void {
  fileEnv.defineEnum(name, type, visibility)
  fileEnv.define(name, { kind: 'typeNs', of: type }, false, visibility)
  if (visibility !== 'private') {
    fileEnv.moduleHome.defineEnum(name, type, visibility)
    fileEnv.moduleHome.define(name, { kind: 'typeNs', of: type }, false, visibility)
  }
}

function publishSealed(fileEnv: TypeEnv, name: string, type: SealedType, visibility: Visibility): void {
  fileEnv.defineSealed(name, type, visibility)
  fileEnv.define(name, { kind: 'typeNs', of: type }, false, visibility)
  if (visibility !== 'private') {
    fileEnv.moduleHome.defineSealed(name, type, visibility)
    fileEnv.moduleHome.define(name, { kind: 'typeNs', of: type }, false, visibility)
  }
}

function qualifiedTypeName(owner: string | undefined, name: string): string {
  return owner ? `${owner}.${name}` : name
}

function registerStructDecl(
  stmt: Extract<Stmt, { kind: 'structDecl' }>,
  fileEnv: TypeEnv,
  unitModule: string,
  unitFile: string,
  owner: string | undefined,
): void {
  const name = qualifiedTypeName(owner, stmt.name)
  if (!owner) defineTopLevelName(stmt.name, stmt.visibility, fileEnv, stmt.loc)
  if (stmt.sealed) {
    const sealedType: SealedType = {
      kind: 'sealed',
      name: name,
      module: unitModule,
      identity: stmt.identity,
      variants: [],
      implements: [],
    }
    if (!owner) {
      publishSealed(fileEnv, stmt.name, sealedType, stmt.visibility)
    } else {
      fileEnv.defineSealed(name, sealedType, stmt.visibility)
      if (stmt.visibility !== 'private') {
        fileEnv.moduleHome.defineSealed(name, sealedType, stmt.visibility)
      }
      attachAssociatedType(fileEnv, owner, stmt.name, { kind: 'typeNs', of: sealedType }, stmt.visibility, unitFile, unitModule)
    }
    return
  }
  const structType: Extract<ZeeType, { kind: 'struct' }> = {
    kind: 'struct',
    name,
    module: unitModule,
    data: stmt.data,
    readonly: stmt.readonly,
    identity: stmt.identity,
    fields: [],
    implements: [],
  }
  fileEnv.defineStruct(name, structType, stmt.visibility)
  if (stmt.visibility !== 'private') {
    fileEnv.moduleHome.defineStruct(name, structType, stmt.visibility)
  }
  if (!owner) {
    fileEnv.define(stmt.name, { kind: 'typeNs', of: structType }, false, stmt.visibility)
    if (stmt.visibility !== 'private') {
      fileEnv.moduleHome.define(stmt.name, { kind: 'typeNs', of: structType }, false, stmt.visibility)
    }
  } else {
    attachAssociatedType(
      fileEnv,
      owner,
      stmt.name,
      { kind: 'typeNs', of: structType },
      stmt.visibility,
      unitFile,
      unitModule,
    )
  }
  for (const nested of stmt.nested) {
    registerNestedDecl(nested, fileEnv, unitModule, unitFile, name)
  }
}

function registerNestedDecl(
  stmt: Stmt,
  fileEnv: TypeEnv,
  unitModule: string,
  unitFile: string,
  owner: string,
): void {
  if (stmt.kind === 'structDecl') {
    registerStructDecl(stmt, fileEnv, unitModule, unitFile, owner)
    return
  }
  if (stmt.kind === 'enumDecl') {
    const name = qualifiedTypeName(owner, stmt.name)
    const enumType: EnumType = {
      kind: 'enum',
      name,
      module: unitModule,
      variants: stmt.variants.map((variant) => variant.name),
      implements: [],
    }
    fileEnv.defineEnum(name, enumType, stmt.visibility)
    if (stmt.visibility !== 'private') {
      fileEnv.moduleHome.defineEnum(name, enumType, stmt.visibility)
    }
    attachAssociatedType(
      fileEnv,
      owner,
      stmt.name,
      { kind: 'typeNs', of: enumType },
      stmt.visibility,
      unitFile,
      unitModule,
    )
    return
  }
  if (stmt.kind === 'typeAliasDecl') {
    const info: TypeAliasInfo = {
      name: qualifiedTypeName(owner, stmt.name),
      module: unitModule,
      visibility: stmt.visibility,
      typeParams: stmt.typeParams,
      aliased: stmt.aliased,
      loc: stmt.loc,
      file: unitFile,
    }
    fileEnv.defineAlias(info)
    if (stmt.visibility !== 'private') fileEnv.moduleHome.defineAlias(info)
    return
  }
  if (stmt.kind === 'newtypeDecl') {
    const name = qualifiedTypeName(owner, stmt.name)
    const newtype: NewtypeType = {
      kind: 'newtype',
      name,
      module: unitModule,
      inner: T_UNIT,
      implements: [],
    }
    fileEnv.defineNewtype(name, newtype, stmt.visibility)
    if (stmt.visibility !== 'private') {
      fileEnv.moduleHome.defineNewtype(name, newtype, stmt.visibility)
    }
    attachAssociatedType(fileEnv, owner, stmt.name, newtype, stmt.visibility, unitFile, unitModule)
    return
  }
  if (stmt.kind === 'interfaceDecl') {
    const name = qualifiedTypeName(owner, stmt.name)
    const iface: InterfaceType = {
      kind: 'interface',
      name,
      module: unitModule,
      sealed: stmt.sealed,
      methods: [],
      implementors: [],
    }
    fileEnv.defineInterface(name, iface, stmt.visibility)
    if (stmt.visibility !== 'private') {
      fileEnv.moduleHome.defineInterface(name, iface, stmt.visibility)
    }
    attachAssociatedType(fileEnv, owner, stmt.name, iface, stmt.visibility, unitFile, unitModule)
  }
}

function attachAssociatedType(
  fileEnv: TypeEnv,
  owner: string,
  name: string,
  type: ZeeType,
  visibility: Visibility,
  file: string,
  module: string,
): void {
  const ownerType = fileEnv.getStruct(owner) ?? fileEnv.getSealed(owner)
  const typeKey = ownerType ? namedTypeKey(ownerType) : undefined
  if (!typeKey) return
  const info: AssociatedInfo = { name, type, visibility, file, module }
  fileEnv.defineAssociated(typeKey, info)
  if (visibility !== 'private') fileEnv.moduleHome.defineAssociated(typeKey, info)
}

function fillStructFields(
  stmt: Extract<Stmt, { kind: 'structDecl' }>,
  fileEnv: TypeEnv,
  unitFile: string,
  owner: string | undefined,
): void {
  const name = qualifiedTypeName(owner, stmt.name)
  const structType = fileEnv.getStruct(name)
  if (!structType) return
  const seen = new Set<string>()
  structType.fields = stmt.fields.map((field) => {
    if (seen.has(field.name)) throw error(field.loc, `duplicate field \`${field.name}\``)
    seen.add(field.name)
    return {
      name: field.name,
      mutable: field.mutable,
      visibility: field.visibility,
      file: unitFile,
      type: resolveTypeAst(field.type, fileEnv),
    }
  })
  for (const nested of stmt.nested) {
    if (nested.kind === 'structDecl' && !nested.sealed) {
      fillStructFields(nested, fileEnv, unitFile, name)
    }
  }
}

function registerStructMembers(
  stmt: Extract<Stmt, { kind: 'structDecl' }>,
  fileEnv: TypeEnv,
  unitModule: string,
  unitFile: string,
  owner: string | undefined,
  registerFn: (
    stmt: Extract<Stmt, { kind: 'fn' }>,
    fileEnv: TypeEnv,
    unitModule: string,
    unitFile: string,
  ) => void,
): void {
  const qualified = qualifiedTypeName(owner, stmt.name)
  for (const nested of stmt.nested) {
    if (nested.kind === 'structDecl') {
      registerStructMembers(nested, fileEnv, unitModule, unitFile, qualified, registerFn)
    }
  }
  if (stmt.sealed) return
  const structType = fileEnv.getStruct(qualified)
  if (!structType) return
  const typeKey = namedTypeKey(structType)!
  for (const item of stmt.associated) {
    const annotated = item.typeAnn ? resolveTypeAst(item.typeAnn, fileEnv) : undefined
    const initType = checkExpr(item.init, fileEnv, T_UNIT, annotated)
    const type = annotated ?? initType
    const info: AssociatedInfo = {
      name: item.name,
      type,
      visibility: item.visibility,
      file: unitFile,
      module: unitModule,
    }
    fileEnv.defineAssociated(typeKey, info)
    if (item.visibility !== 'private') fileEnv.moduleHome.defineAssociated(typeKey, info)
  }
  for (const method of stmt.methods) {
    if (method.params[0]?.name === 'self') {
      registerFn(method, fileEnv, unitModule, unitFile)
      continue
    }
    const params = method.params.map((param) => resolveTypeAst(param.type, fileEnv))
    const ret = method.returnType ? resolveTypeAst(method.returnType, fileEnv) : T_UNIT
    const fnType: Extract<ZeeType, { kind: 'fn' }> = { kind: 'fn', params, ret }
    if (fileEnv.ownAssociated(typeKey, method.name)) {
      throw error(method.loc, `duplicate member \`${method.name}\` on ${typeName(structType)}`)
    }
    const info: AssociatedInfo = {
      name: method.name,
      type: fnType,
      visibility: method.visibility,
      file: unitFile,
      module: unitModule,
    }
    fileEnv.defineAssociated(typeKey, info)
    if (method.visibility !== 'private') fileEnv.moduleHome.defineAssociated(typeKey, info)
  }
}

function checkStructBodies(
  stmt: Extract<Stmt, { kind: 'structDecl' }>,
  fileEnv: TypeEnv,
  owner: string | undefined,
): void {
  const qualified = qualifiedTypeName(owner, stmt.name)
  for (const nested of stmt.nested) {
    if (nested.kind === 'structDecl') checkStructBodies(nested, fileEnv, qualified)
  }
  const structType = stmt.sealed ? undefined : fileEnv.getStruct(qualified)
  for (const method of stmt.methods) {
    if (method.params[0]?.name === 'self') {
      checkFnBody(method, fileEnv)
      continue
    }
    const info = structType ? lookupAssociated(structType, method.name, fileEnv) : undefined
    if (info) checkFnBody(method, fileEnv, info.type)
  }
}

function resolveImportTarget(
  stmt: Extract<Stmt, { kind: 'import' }>,
  moduleEnvs: Map<string, TypeEnv>,
  loc: { file: string; line: number; column: number },
): { module: string; name?: string } {
  const joined = stmt.path.join('.')
  if (stmt.names) {
    if (!moduleEnvs.has(joined)) throw error(loc, `unknown module \`${joined}\``)
    return { module: joined }
  }
  if (moduleEnvs.has(joined)) return { module: joined }
  if (stmt.path.length < 2) throw error(loc, `unknown module \`${joined}\``)
  const parent = stmt.path.slice(0, -1).join('.')
  const name = stmt.path[stmt.path.length - 1]!
  if (!moduleEnvs.has(parent)) throw error(loc, `unknown module \`${parent}\``)
  return { module: parent, name }
}

function applyImport(
  stmt: Extract<Stmt, { kind: 'import' }>,
  fileEnv: TypeEnv,
  moduleEnvs: Map<string, TypeEnv>,
  options: { skipMissing?: boolean } = {},
): void {
  const target = resolveImportTarget(stmt, moduleEnvs, stmt.loc)
  const moduleEnv = moduleEnvs.get(target.module)!
  if (stmt.names) {
    for (const item of stmt.names) {
      bindImportedName(fileEnv, moduleEnv, item.name, item.alias ?? item.name, stmt.loc, options)
    }
    return
  }
  if (!target.name) {
    const bindAs = stmt.alias ?? stmt.path[stmt.path.length - 1]!
    if (fileEnv.hasOwn(bindAs) || fileEnv.hasOwnType(bindAs)) return
    fileEnv.define(bindAs, { kind: 'module', name: target.module })
    return
  }
  bindImportedName(fileEnv, moduleEnv, target.name, stmt.alias ?? target.name, stmt.loc, options)
}

function bindImportedName(
  fileEnv: TypeEnv,
  moduleEnv: TypeEnv,
  name: string,
  bindAs: string,
  loc: { file: string; line: number; column: number },
  options: { skipMissing?: boolean } = {},
): void {
  if (fileEnv.hasOwn(bindAs) && fileEnv.hasOwnType(bindAs)) return
  const binding = moduleEnv.own(name)
  const struct = moduleEnv.hasOwnStruct(name) ? moduleEnv.getStruct(name) : undefined
  const enumType = moduleEnv.hasOwnEnum(name) ? moduleEnv.getEnum(name) : undefined
  const sealed = moduleEnv.hasOwnSealed(name) ? moduleEnv.getSealed(name) : undefined
  const alias = moduleEnv.hasOwnAlias(name) ? moduleEnv.getAlias(name) : undefined
  const newtype = moduleEnv.hasOwnNewtype(name) ? moduleEnv.getNewtype(name) : undefined
  const iface = moduleEnv.hasOwnInterface(name) ? moduleEnv.getInterface(name) : undefined
  const vis =
    binding?.visibility ??
    (struct ? moduleEnv.structVisibility(name) : undefined) ??
    (enumType ? moduleEnv.enumVisibility(name) : undefined) ??
    (sealed ? moduleEnv.sealedVisibility(name) : undefined) ??
    (alias ? moduleEnv.aliasVisibility(name) : undefined) ??
    (newtype ? moduleEnv.newtypeVisibility(name) : undefined) ??
    (iface ? moduleEnv.interfaceVisibility(name) : undefined)
  if (!binding && !struct && !enumType && !sealed && !alias && !newtype && !iface) {
    if (options.skipMissing) return
    throw error(loc, `\`${name}\` is not exported from this module`)
  }
  if (vis !== 'pub') {
    throw error(loc, `\`${name}\` is internal and is not exported`)
  }
  if (struct && !fileEnv.hasOwnStruct(bindAs)) fileEnv.defineStruct(bindAs, struct, 'pub')
  if (enumType && !fileEnv.hasOwnEnum(bindAs)) fileEnv.defineEnum(bindAs, enumType, 'pub')
  if (sealed && !fileEnv.hasOwnSealed(bindAs)) fileEnv.defineSealed(bindAs, sealed, 'pub')
  if (alias && !fileEnv.hasOwnAlias(bindAs)) fileEnv.defineAlias({ ...alias, name: bindAs, visibility: 'pub' })
  if (newtype && !fileEnv.hasOwnNewtype(bindAs)) fileEnv.defineNewtype(bindAs, newtype, 'pub')
  if (iface && !fileEnv.hasOwnInterface(bindAs)) fileEnv.defineInterface(bindAs, iface, 'pub')
  if (binding && !fileEnv.hasOwn(bindAs)) fileEnv.define(bindAs, binding.type, binding.mutable, 'pub')
}

function detectImportCycle(
  deps: Map<string, Set<string>>,
  loc: { file: string; line: number; column: number },
): void {
  const visiting = new Set<string>()
  const seen = new Set<string>()
  const visit = (module: string): void => {
    if (seen.has(module)) return
    if (visiting.has(module)) {
      throw error(loc, 'import cycle')
    }
    visiting.add(module)
    for (const next of deps.get(module) ?? []) visit(next)
    visiting.delete(module)
    seen.add(module)
  }
  for (const module of deps.keys()) visit(module)
}

function topoModules(moduleIds: string[], deps: Map<string, Set<string>>): string[] {
  const indegree = new Map<string, number>()
  const importers = new Map<string, string[]>()
  for (const id of moduleIds) {
    indegree.set(id, 0)
    importers.set(id, [])
  }
  for (const [importer, targets] of deps) {
    for (const target of targets) {
      if (target === importer) continue
      importers.get(target)?.push(importer)
      indegree.set(importer, (indegree.get(importer) ?? 0) + 1)
    }
  }
  const ready = moduleIds.filter((id) => (indegree.get(id) ?? 0) === 0)
  const ordered: string[] = []
  while (ready.length > 0) {
    const current = ready.shift()!
    ordered.push(current)
    for (const next of importers.get(current) ?? []) {
      const nextDegree = (indegree.get(next) ?? 0) - 1
      indegree.set(next, nextDegree)
      if (nextDegree === 0) ready.push(next)
    }
  }
  return ordered.length === moduleIds.length ? ordered : moduleIds
}

function defineBuiltins(env: TypeEnv): void {
  const printable: ZeeType = T_STRING
  env.define('print', { kind: 'fn', params: [printable], ret: T_UNIT })
  env.define('println', { kind: 'fn', params: [printable], ret: T_UNIT })
  env.define('printf', { kind: 'fn', params: [T_STRING], ret: T_UNIT })
  env.define('sprintf', { kind: 'fn', params: [T_STRING], ret: T_STRING })
  env.define('str', { kind: 'fn', params: [T_I32], ret: T_STRING })
  env.define('getenv', { kind: 'fn', params: [T_STRING], ret: { kind: 'option', inner: T_STRING } })
  env.define('envProfile', { kind: 'fn', params: [], ret: T_STRING })
  env.define('envAppMeta', { kind: 'fn', params: [T_STRING], ret: { kind: 'option', inner: T_STRING } })
  env.define('testCases', {
    kind: 'fn',
    params: [],
    ret: { kind: 'list', elem: { kind: 'tuple', parts: [T_STRING, T_STRING] } },
  })
  env.define('testCall', {
    kind: 'fn',
    params: [T_STRING, T_STRING],
    ret: { kind: 'option', inner: T_STRING },
  })
  env.defineInterface('Error', T_ERROR, 'pub')
  env.defineStruct('Fail', T_FAIL, 'pub')
  env.defineMethod(`\0Fail`, {
    name: 'message',
    type: { kind: 'fn', params: [T_FAIL], ret: T_STRING },
    mutating: false,
    visibility: 'pub',
    file: '<builtin>',
    module: '',
  })
  env.define('error', { kind: 'fn', params: [T_STRING], ret: T_ERROR })
  env.define('panic', { kind: 'fn', params: [T_STRING], ret: T_NEVER })
}

function resolveImplements(
  names: string[],
  env: TypeEnv,
  module: string,
  loc: { file: string; line: number; column: number },
): InterfaceType[] {
  const seen = new Set<string>()
  const out: InterfaceType[] = []
  for (const name of names) {
    if (seen.has(name)) throw error(loc, `duplicate interface \`${name}\``)
    seen.add(name)
    const iface = env.getInterface(name)
    if (!iface) throw error(loc, `unknown interface \`${name}\``)
    if (iface.sealed && iface.module !== module) {
      throw error(loc, `sealed interface \`${iface.name}\` can only be implemented in this module`)
    }
    out.push(iface)
  }
  return out
}

function checkImplementsMethods(
  type: Extract<ZeeType, { kind: 'struct' | 'enum' | 'sealed' | 'newtype' }>,
  iface: InterfaceType,
  env: TypeEnv,
  loc: { file: string; line: number; column: number },
): void {
  for (const method of iface.methods) {
    const found = lookupMethod(type, method.name, env)
    if (!found) {
      throw error(loc, `\`${type.name}\` does not implement \`${iface.name}\`: missing method \`${method.name}\``)
    }
    if (found.mutating !== method.mutating) {
      throw error(
        loc,
        `\`${type.name}\` does not implement \`${iface.name}\`: \`${method.name}\` receiver mismatch`,
      )
    }
    const rest = found.type.params.slice(1)
    if (rest.length !== method.params.length || !typeEq(found.type.ret, method.ret)) {
      throw error(loc, `\`${type.name}\` does not implement \`${iface.name}\`: \`${method.name}\` has the wrong type`)
    }
    if (!rest.every((param, index) => typeEq(param, method.params[index]!))) {
      throw error(loc, `\`${type.name}\` does not implement \`${iface.name}\`: \`${method.name}\` has the wrong type`)
    }
  }
}

function rejectReservedTypeName(name: string, loc: { file: string; line: number; column: number }): void {
  if (typeFromName(name) || name === 'Option' || name === 'List' || name === 'Map' || name === 'Fail') {
    throw error(loc, `cannot redefine builtin type \`${name}\``)
  }
}

function substituteTypeAst(ast: TypeAst, map: Map<string, TypeAst>): TypeAst {
  switch (ast.kind) {
    case 'named':
      return map.get(ast.name) ?? ast
    case 'generic':
      return { ...ast, args: ast.args.map((arg) => substituteTypeAst(arg, map)) }
    case 'fn':
      return {
        ...ast,
        params: ast.params.map((param) => substituteTypeAst(param, map)),
        ret: substituteTypeAst(ast.ret, map),
      }
    case 'tuple':
      return { ...ast, parts: ast.parts.map((part) => substituteTypeAst(part, map)) }
    case 'array':
      return { ...ast, elem: substituteTypeAst(ast.elem, map) }
    case 'unit':
      return ast
  }
}

function resolveAlias(
  alias: TypeAliasInfo,
  args: TypeAst[],
  env: TypeEnv,
  loc: { file: string; line: number; column: number },
  visiting: Set<string>,
): ZeeType {
  if (alias.typeParams.length !== args.length) {
    if (alias.typeParams.length === 0) {
      throw error(loc, `type \`${alias.name}\` does not take type arguments`)
    }
    throw error(
      loc,
      `\`${alias.name}\` takes ${alias.typeParams.length} type argument(s), got ${args.length}`,
    )
  }
  const key = `${alias.module}\0${alias.name}`
  if (visiting.has(key)) {
    throw error(alias.loc, `cyclic type alias \`${alias.name}\``)
  }
  visiting.add(key)
  const map = new Map<string, TypeAst>()
  alias.typeParams.forEach((param, index) => {
    map.set(param, args[index]!)
  })
  const substituted = map.size === 0 ? alias.aliased : substituteTypeAst(alias.aliased, map)
  const resolved = resolveTypeAst(substituted, env, visiting)
  visiting.delete(key)
  return resolved
}

function resolveTypeAst(ast: TypeAst, env: TypeEnv, visiting: Set<string> = new Set()): ZeeType {
  switch (ast.kind) {
    case 'named':
      return resolveType(ast.name, ast.loc, env, visiting)
    case 'unit':
      return T_UNIT
    case 'array':
      return { kind: 'array', elem: resolveTypeAst(ast.elem, env, visiting) }
    case 'tuple': {
      if (ast.parts.length < 2) {
        throw error(ast.loc, 'tuple types need at least two parts')
      }
      return { kind: 'tuple', parts: ast.parts.map((part) => resolveTypeAst(part, env, visiting)) }
    }
    case 'generic': {
      const alias = env.getAlias(ast.name)
      if (alias) return resolveAlias(alias, ast.args, env, ast.loc, visiting)
      if (ast.name === 'Option') {
        if (ast.args.length !== 1) {
          throw error(ast.loc, '`Option` takes one type argument')
        }
        return { kind: 'option', inner: resolveTypeAst(ast.args[0]!, env, visiting) }
      }
      if (ast.name === 'List') {
        if (ast.args.length !== 1) {
          throw error(ast.loc, '`List` takes one type argument')
        }
        return { kind: 'list', elem: resolveTypeAst(ast.args[0]!, env, visiting) }
      }
      if (ast.name === 'Map') {
        if (ast.args.length !== 2) {
          throw error(ast.loc, '`Map` takes two type arguments')
        }
        const key = resolveTypeAst(ast.args[0]!, env, visiting)
        const value = resolveTypeAst(ast.args[1]!, env, visiting)
        if (!isHashable(key)) {
          throw error(ast.loc, `Map key type ${typeName(key)} is not Hash`)
        }
        return { kind: 'map', key, value }
      }
      throw error(ast.loc, `unknown type \`${ast.name}\``)
    }
    case 'fn':
      return {
        kind: 'fn',
        params: ast.params.map((param) => resolveTypeAst(param, env, visiting)),
        ret: resolveTypeAst(ast.ret, env, visiting),
      }
  }
}

function resolveType(
  name: string,
  loc: { file: string; line: number; column: number },
  env: TypeEnv,
  visiting: Set<string> = new Set(),
): ZeeType {
  const type = typeFromName(name)
  if (type) return type
  if (env.isTypeParam(name)) return { kind: 'typeParam', name }
  const alias = env.getAlias(name)
  if (alias) {
    if (alias.typeParams.length > 0) {
      throw error(loc, `type \`${name}\` needs type arguments`)
    }
    return resolveAlias(alias, [], env, loc, visiting)
  }
  const struct = env.getStruct(name)
  if (struct) return struct
  const enumType = env.getEnum(name)
  if (enumType) return enumType
  const sealed = env.getSealed(name)
  if (sealed) return sealed
  const newtype = env.getNewtype(name)
  if (newtype) return newtype
  const iface = env.getInterface(name)
  if (iface) return iface
  throw error(loc, `unknown type \`${name}\``)
}

function checkStmt(stmt: Stmt, env: TypeEnv, returnType: ZeeType, expected?: ZeeType): ZeeType {
  switch (stmt.kind) {
    case 'bind': {
      const annotated = stmt.typeAnn ? resolveTypeAst(stmt.typeAnn, env) : undefined
      const initType = checkExpr(stmt.init, env, returnType, annotated)
      let type = annotated ?? initType
      if (
        !annotated &&
        stmt.mutable &&
        stmt.init.kind === 'arrayLit' &&
        initType.kind === 'list'
      ) {
        type = { kind: 'array', elem: initType.elem }
        stmt.init.asList = false
      }
      if (stmt.visibility !== 'private') {
        defineTopLevelName(stmt.name, stmt.visibility, env, stmt.loc)
        env.moduleHome.define(stmt.name, type, stmt.mutable, stmt.visibility)
      } else if (env.hasOwn(stmt.name) || env.hasOwnType(stmt.name)) {
        throw error(stmt.loc, `duplicate definition of \`${stmt.name}\``)
      }
      env.define(stmt.name, type, stmt.mutable, stmt.visibility)
      if (!annotated) {
        env.hints.push({
          file: env.file,
          line: stmt.loc.line,
          column: stmt.loc.column,
          name: stmt.name,
          type: typeName(type),
        })
      }
      return T_UNIT
    }
    case 'destructure': {
      const initType = checkExpr(stmt.init, env, returnType)
      if (initType.kind !== 'tuple') {
        throw error(stmt.init.loc, `cannot destructure ${typeName(initType)}`)
      }
      if (initType.parts.length !== stmt.names.length) {
        throw error(
          stmt.loc,
          `destructure expected ${stmt.names.length} value(s), got ${initType.parts.length}`,
        )
      }
      const seen = new Set<string>()
      stmt.names.forEach((name, index) => {
        if (name === '_') return
        if (seen.has(name)) throw error(stmt.loc, `duplicate binding \`${name}\``)
        seen.add(name)
        env.define(name, initType.parts[index]!, stmt.mutable)
      })
      return T_UNIT
    }
    case 'assign': {
      const binding = env.lookup(stmt.name)
      if (!binding) throw error(stmt.loc, `undefined name \`${stmt.name}\``)
      if (!binding.mutable) throw error(stmt.loc, `cannot assign to const \`${stmt.name}\``)
      if (stmt.op === '??=' || stmt.op === '!!=') {
        if (binding.type.kind !== 'option') {
          throw error(stmt.loc, `\`${stmt.op}\` requires \`var Option<T>\``)
        }
        checkExpr(stmt.value, env, returnType, binding.type.inner)
        return T_UNIT
      }
      if (stmt.op === '&&=' || stmt.op === '||=') {
        if (!typeEq(binding.type, T_BOOL)) {
          throw error(stmt.loc, `\`${stmt.op}\` requires \`var bool\``)
        }
        checkExpr(stmt.value, env, returnType, T_BOOL)
        return T_UNIT
      }
      checkCompoundAssign(stmt.op, binding.type, stmt.value, env, returnType, stmt.loc)
      return T_UNIT
    }
    case 'indexAssign': {
      const targetType = checkExpr(stmt.target, env, returnType)
      if (targetType.kind === 'list') {
        throw error(stmt.loc, 'cannot assign through a List index')
      }
      if (stmt.target.kind === 'ident') {
        const binding = env.lookup(stmt.target.name)
        if (binding && !binding.mutable) {
          throw error(stmt.loc, `cannot assign to const \`${stmt.target.name}\``)
        }
      }
      if (targetType.kind === 'string') {
        throw error(stmt.loc, 'cannot assign through a String index')
      }
      if (targetType.kind === 'map') {
        checkExpr(stmt.index, env, returnType, targetType.key)
        checkCompoundAssign(stmt.op, targetType.value, stmt.value, env, returnType, stmt.loc)
        return T_UNIT
      }
      if (targetType.kind !== 'array') {
        throw error(stmt.loc, `index assign requires an array, got ${typeName(targetType)}`)
      }
      checkExpr(stmt.index, env, returnType, T_USIZE)
      checkCompoundAssign(stmt.op, targetType.elem, stmt.value, env, returnType, stmt.loc)
      return T_UNIT
    }
    case 'fieldAssign': {
      const targetType = checkExpr(stmt.target, env, returnType)
      if (stmt.target.kind === 'ident') {
        const binding = env.lookup(stmt.target.name)
        if (binding && !binding.mutable) {
          throw error(stmt.loc, `cannot assign to const \`${stmt.target.name}\``)
        }
      }
      if (targetType.kind !== 'struct') {
        throw error(stmt.loc, `field assign requires a struct or class, got ${typeName(targetType)}`)
      }
      if (targetType.readonly) {
        throw error(
          stmt.loc,
          `cannot assign to field \`${stmt.field}\` on readonly type \`${targetType.name}\``,
        )
      }
      const field = targetType.fields.find((item) => item.name === stmt.field)
      if (!field) throw error(stmt.loc, `unknown field \`${stmt.field}\` on ${targetType.name}`)
      checkFieldVisible(field, targetType.module, env, stmt.loc, stmt.field)
      if (!field.mutable) {
        throw error(stmt.loc, `cannot assign to const field \`${stmt.field}\``)
      }
      checkCompoundAssign(stmt.op, field.type, stmt.value, env, returnType, stmt.loc)
      return T_UNIT
    }
    case 'redim': {
      const binding = env.lookup(stmt.name)
      if (!binding) throw error(stmt.loc, `undefined name \`${stmt.name}\``)
      if (!binding.mutable) throw error(stmt.loc, `cannot redim const \`${stmt.name}\``)
      const target = resolveTypeAst(stmt.type, env)
      if (!isIntType(binding.type) || !isIntType(target)) {
        throw error(stmt.loc, '`redim` on integers needs an integer type')
      }
      if (!canWidenInt(binding.type.kind, target.kind)) {
        if (intSigned(binding.type.kind) !== intSigned(target.kind)) {
          throw error(
            stmt.loc,
            `cannot redim \`${stmt.name}\` across signedness (${typeName(binding.type)} to ${typeName(target)})`,
          )
        }
        throw error(
          stmt.loc,
          `cannot narrow \`${stmt.name}\` with \`redim\` (${typeName(binding.type)} to ${typeName(target)})`,
        )
      }
      env.setType(stmt.name, target)
      return T_UNIT
    }
    case 'redimArray': {
      const binding = env.lookup(stmt.name)
      if (!binding) throw error(stmt.loc, `undefined name \`${stmt.name}\``)
      if (!binding.mutable) throw error(stmt.loc, `cannot redim const \`${stmt.name}\``)
      if (binding.type.kind === 'list' || binding.type.kind === 'map') {
        throw error(stmt.loc, `cannot redim ${typeName(binding.type)}`)
      }
      if (binding.type.kind !== 'array') {
        throw error(stmt.loc, `array \`redim\` requires an array, got ${typeName(binding.type)}`)
      }
      checkExpr(stmt.length, env, returnType, T_USIZE)
      return T_UNIT
    }
    case 'return': {
      const valueType = stmt.expr ? checkExpr(stmt.expr, env, returnType, returnType) : T_UNIT
      if (!isAssignable(valueType, returnType)) {
        throw error(
          stmt.loc,
          `return has type ${typeName(valueType)}, expected ${typeName(returnType)}`,
        )
      }
      return T_UNIT
    }
    case 'loop': {
      const cond = checkExpr(stmt.cond, env, returnType)
      if (!typeEq(cond, T_BOOL)) {
        throw error(stmt.cond.loc, `loop condition must be bool, got ${typeName(cond)}`)
      }
      checkBlock(stmt.body, env.withLoop(), returnType)
      return T_UNIT
    }
    case 'forForever':
      checkBlock(stmt.body, env.withLoop(), returnType)
      return T_UNIT
    case 'forC': {
      const loopEnv = env.child()
      if (stmt.init) checkStmt(stmt.init, loopEnv, returnType)
      if (stmt.cond) {
        const cond = checkExpr(stmt.cond, loopEnv, returnType)
        if (!typeEq(cond, T_BOOL)) {
          throw error(stmt.cond.loc, `loop condition must be bool, got ${typeName(cond)}`)
        }
      }
      if (stmt.step) checkStmt(stmt.step, loopEnv, returnType)
      checkBlock(stmt.body, loopEnv.withLoop(), returnType)
      return T_UNIT
    }
    case 'forRange': {
      const startType = checkRangeBounds(stmt.start, stmt.end, env, returnType)
      const loopEnv = env.child()
      loopEnv.define(stmt.name, startType, true)
      checkBlock(stmt.body, loopEnv.withLoop(), returnType)
      return T_UNIT
    }
    case 'forIn': {
      const seqType = checkExpr(stmt.seq, env, returnType)
      const loopEnv = env.child()
      if (seqType.kind === 'map') {
        if (!stmt.indexName) {
          throw error(stmt.seq.loc, 'for-in on Map needs `(k, v)`')
        }
        if (stmt.indexName === stmt.name) {
          throw error(stmt.loc, `duplicate binding \`${stmt.name}\``)
        }
        loopEnv.define(stmt.indexName, seqType.key, false)
        loopEnv.define(stmt.name, seqType.value, false)
        checkBlock(stmt.body, loopEnv.withLoop(), returnType)
        return T_UNIT
      }
      if (seqType.kind === 'string') {
        if (stmt.indexName) {
          if (stmt.indexName === stmt.name) {
            throw error(stmt.loc, `duplicate binding \`${stmt.name}\``)
          }
          loopEnv.define(stmt.indexName, T_USIZE, false)
        }
        loopEnv.define(stmt.name, T_CHAR, false)
        checkBlock(stmt.body, loopEnv.withLoop(), returnType)
        return T_UNIT
      }
      if (seqType.kind !== 'array' && seqType.kind !== 'list') {
        throw error(stmt.seq.loc, `for-in expects an array, List, or String, got ${typeName(seqType)}`)
      }
      if (stmt.indexName) {
        if (stmt.indexName === stmt.name) {
          throw error(stmt.loc, `duplicate binding \`${stmt.name}\``)
        }
        loopEnv.define(stmt.indexName, T_USIZE, false)
      }
      loopEnv.define(stmt.name, seqType.elem, false)
      checkBlock(stmt.body, loopEnv.withLoop(), returnType)
      return T_UNIT
    }
    case 'break':
      if (!env.inLoop()) throw error(stmt.loc, '`break` outside of a loop')
      return T_UNIT
    case 'continue':
      if (!env.inLoop()) throw error(stmt.loc, '`continue` outside of a loop')
      return T_UNIT
    case 'defer':
      if (!env.inFn()) throw error(stmt.loc, '`defer` outside of a function')
      checkExpr(stmt.body, env, returnType)
      return T_UNIT
    case 'fn': {
      if (env.describeDepth < 1) {
        throw error(stmt.loc, 'nested functions are not supported yet')
      }
      const hook = ['beforeAll', 'beforeEach', 'afterEach', 'afterAll'].includes(stmt.name)
      const test = stmt.name.startsWith('test')
      if ((hook || test) && stmt.params.length > 0) {
        throw error(
          stmt.loc,
          hook ? `hook \`${stmt.name}\` takes no parameters` : `test function \`${stmt.name}\` takes no parameters`,
        )
      }
      if (env.hasOwn(stmt.name)) {
        throw error(stmt.loc, `duplicate definition of \`${stmt.name}\``)
      }
      const params = stmt.params.map((param) => resolveTypeAst(param.type, env))
      const ret = stmt.returnType ? resolveTypeAst(stmt.returnType, env) : T_UNIT
      const fnType: Extract<ZeeType, { kind: 'fn' }> = { kind: 'fn', params, ret }
      env.define(stmt.name, fnType)
      checkFnBody(stmt, env, fnType)
      return T_UNIT
    }
    case 'structDecl':
      throw error(stmt.loc, 'nested structs are not supported yet')
    case 'enumDecl':
      throw error(stmt.loc, 'nested enums are not supported yet')
    case 'typeAliasDecl':
      throw error(stmt.loc, 'nested type aliases are not supported yet')
    case 'newtypeDecl':
      throw error(stmt.loc, 'nested newtypes are not supported yet')
    case 'interfaceDecl':
      throw error(stmt.loc, 'nested interfaces are not supported yet')
    case 'import':
      throw error(stmt.loc, '`import` is only allowed at the top level')
    case 'expr':
      return checkExpr(stmt.expr, env, returnType, expected)
  }
}

function checkCompoundAssign(
  op: AssignOp,
  lhsType: ZeeType,
  value: Expr,
  env: TypeEnv,
  returnType: ZeeType,
  loc: { file: string; line: number; column: number },
): void {
  if (op === '<<=') {
    checkShiftAssign(lhsType, value, env, returnType, loc, '<<=')
    return
  }
  if (op === '>>=') {
    checkShiftAssign(lhsType, value, env, returnType, loc, '>>=')
    return
  }
  checkExpr(value, env, returnType, lhsType)
  if (op === '=') return
  if (op === '+=' && typeEq(lhsType, T_STRING)) return
  if (isCompoundArith(op) && (isIntType(lhsType) || isFloatType(lhsType))) return
  if (isCompoundBit(op) && isIntType(lhsType)) return
  throw error(loc, `operator \`${op}\` is not defined for ${typeName(lhsType)}`)
}

function checkShiftAssign(
  lhsType: ZeeType,
  value: Expr,
  env: TypeEnv,
  returnType: ZeeType,
  loc: { file: string; line: number; column: number },
  op: '<<=' | '>>=',
): void {
  if (!isIntType(lhsType)) {
    throw error(loc, `operator \`${op}\` is not defined for ${typeName(lhsType)}`)
  }
  const countExpected = value.kind === 'int' && !value.suffix ? T_U32 : undefined
  const countType = checkExpr(value, env, returnType, countExpected)
  if (!isShiftCountType(lhsType, countType)) {
    throw error(
      loc,
      `shift count must be u32 or unsigned of the same width as ${typeName(lhsType)}`,
    )
  }
}

function isCompoundArith(op: AssignOp): boolean {
  return op === '+=' || op === '-=' || op === '*=' || op === '/=' || op === '%='
}

function isCompoundBit(op: AssignOp): boolean {
  return op === '&=' || op === '|=' || op === '^='
}

function isShiftCountType(lhs: ZeeType, count: ZeeType): boolean {
  if (!isIntType(lhs) || !isIntType(count)) return false
  if (count.kind === 'u32') return true
  return !intSigned(count.kind) && intBits(count.kind) === intBits(lhs.kind)
}

function checkBlock(block: Block, env: TypeEnv, returnType: ZeeType, expected?: ZeeType): ZeeType {
  const local = env.child()
  if (block.stmts.length === 0) return T_UNIT
  let last: ZeeType = T_UNIT
  block.stmts.forEach((stmt, index) => {
    const isLast = index === block.stmts.length - 1
    const priorReturn = block.stmts.slice(0, index).some((s) => s.kind === 'return')
    const stmtExpected = isLast && stmt.kind === 'expr' && !priorReturn ? expected : undefined
    last = checkStmt(stmt, local, returnType, stmtExpected)
  })
  const lastStmt = block.stmts[block.stmts.length - 1]
  if (
    lastStmt?.kind === 'bind' ||
    lastStmt?.kind === 'assign' ||
    lastStmt?.kind === 'indexAssign' ||
    lastStmt?.kind === 'fieldAssign' ||
    lastStmt?.kind === 'redim' ||
    lastStmt?.kind === 'redimArray' ||
    lastStmt?.kind === 'fn' ||
    lastStmt?.kind === 'structDecl' ||
    lastStmt?.kind === 'enumDecl' ||
    lastStmt?.kind === 'typeAliasDecl' ||
    lastStmt?.kind === 'newtypeDecl' ||
    lastStmt?.kind === 'interfaceDecl' ||
    lastStmt?.kind === 'destructure' ||
    lastStmt?.kind === 'return' ||
    lastStmt?.kind === 'loop' ||
    lastStmt?.kind === 'forC' ||
    lastStmt?.kind === 'forForever' ||
    lastStmt?.kind === 'forRange' ||
    lastStmt?.kind === 'forIn' ||
    lastStmt?.kind === 'break' ||
    lastStmt?.kind === 'continue' ||
    lastStmt?.kind === 'defer' ||
    lastStmt?.kind === 'import'
  ) {
    return T_UNIT
  }
  return last
}

function checkExpr(expr: Expr, env: TypeEnv, returnType: ZeeType, expected?: ZeeType): ZeeType {
  const type = inferExpr(expr, env, returnType, expected)
  if (isNeverType(type)) return expected ?? type
  if (expected && !isAssignable(type, expected)) {
    throw error(expr.loc, `expected ${typeName(expected)}, got ${typeName(type)}`)
  }
  return expected ?? type
}

function inferExpr(expr: Expr, env: TypeEnv, returnType: ZeeType, expected?: ZeeType): ZeeType {
  switch (expr.kind) {
    case 'int': {
      if (expr.suffix) {
        if (!intFits(expr.value, expr.suffix)) {
          throw error(expr.loc, `integer literal ${expr.value} does not fit ${expr.suffix}`)
        }
        return { kind: expr.suffix }
      }
      const kind = expected && isIntType(expected) ? expected.kind : 'i32'
      if (!intFits(expr.value, kind)) {
        throw error(expr.loc, `integer literal ${expr.value} does not fit ${kind}`)
      }
      expr.suffix = kind
      return { kind }
    }
    case 'float': {
      if (expr.suffix) return { kind: expr.suffix }
      const kind = expected && isFloatType(expected) ? expected.kind : 'f64'
      expr.suffix = kind
      return { kind }
    }
    case 'bool':
      return T_BOOL
    case 'string':
      return T_STRING
    case 'char':
      return T_CHAR
    case 'interp': {
      for (const part of expr.parts) {
        if (part.kind !== 'expr') continue
        const partType = checkExpr(part.expr, env, returnType)
        if (!isInterpolable(partType)) {
          throw error(part.expr.loc, `cannot interpolate ${typeName(partType)}`)
        }
      }
      return T_STRING
    }
    case 'unit':
      return T_UNIT
    case 'ident': {
      if (expr.name === 'None') {
        if (expected?.kind === 'option') return expected
        throw error(expr.loc, '`None` needs a type context')
      }
      const capture = env.captureError(expr.name)
      if (capture) throw error(expr.loc, capture)
      const type = env.get(expr.name)
      if (!type) throw error(expr.loc, `undefined name \`${expr.name}\``)
      return type
    }
    case 'unary': {
      const innerExpected =
        expr.op === '-' && expected && (isIntType(expected) || isFloatType(expected)) ? expected : undefined
      const inner = checkExpr(expr.expr, env, returnType, innerExpected)
      if (expr.op === '-' && (isIntType(inner) || isFloatType(inner))) return inner
      if (expr.op === '!' && typeEq(inner, T_BOOL)) return T_BOOL
      if (expr.op === '~' && isIntType(inner)) return inner
      throw error(expr.loc, `unary \`${expr.op}\` is not defined for ${typeName(inner)}`)
    }
    case 'binary':
      if (expr.op === '?:') return checkElvis(expr, env, returnType, expected)
      return checkBinary(expr, env, returnType, expected)
    case 'call':
      return checkCall(expr, env, returnType, expected)
    case 'tuple': {
      const expectedParts =
        expected?.kind === 'tuple' && expected.parts.length === expr.items.length
          ? expected.parts
          : undefined
      const parts = expr.items.map((item, index) =>
        checkExpr(item, env, returnType, expectedParts?.[index]),
      )
      if (parts.length < 2) {
        throw error(expr.loc, 'tuple values need at least two items')
      }
      return { kind: 'tuple', parts }
    }
    case 'tupleIndex': {
      const target = checkExpr(expr.target, env, returnType)
      if (target.kind !== 'tuple') {
        throw error(expr.loc, `tuple index requires a tuple, got ${typeName(target)}`)
      }
      if (expr.index < 0 || expr.index >= target.parts.length) {
        throw error(expr.loc, `tuple index ${expr.index} is out of range for ${typeName(target)}`)
      }
      return target.parts[expr.index]!
    }
    case 'index': {
      const target = checkExpr(expr.target, env, returnType)
      if (target.kind === 'map') {
        checkExpr(expr.index, env, returnType, target.key)
        return { kind: 'option', inner: target.value }
      }
      checkExpr(expr.index, env, returnType, T_USIZE)
      if (target.kind === 'array' || target.kind === 'list') return target.elem
      if (target.kind === 'string') return T_U8
      throw error(expr.loc, `index requires an array, List, Map, or String, got ${typeName(target)}`)
    }
    case 'member': {
      const target = checkExpr(expr.target, env, returnType)
      if (
        expr.field === 'len' &&
        (target.kind === 'array' ||
          target.kind === 'string' ||
          target.kind === 'list' ||
          target.kind === 'map')
      ) {
        return T_USIZE
      }
      if (target.kind === 'expect' && expr.field === 'not') {
        return target
      }
      if (target.kind === 'module') {
        return lookupModuleMember(target.name, expr.field, env, expr.loc)
      }
      if (target.kind === 'typeNs') {
        if (target.of.kind === 'enum') {
          if (!target.of.variants.includes(expr.field)) {
            throw error(expr.loc, `unknown variant \`${expr.field}\` on ${target.of.name}`)
          }
          return target.of
        }
        const associated = lookupAssociated(target.of, expr.field, env)
        if (associated) return associated.type
        if (target.of.kind === 'sealed') {
          throw error(
            expr.loc,
            `sealed variant \`${expr.field}\` needs a struct literal`,
          )
        }
        throw error(expr.loc, `unknown associated name \`${expr.field}\` on ${typeName(target.of)}`)
      }
      if (target.kind !== 'struct') {
        throw error(expr.loc, `no field \`${expr.field}\` on ${typeName(target)}`)
      }
      const field = target.fields.find((item) => item.name === expr.field)
      if (!field) throw error(expr.loc, `unknown field \`${expr.field}\` on ${target.name}`)
      checkFieldVisible(field, target.module, env, expr.loc, expr.field)
      return field.type
    }
    case 'arrayLit': {
      if (expected && expected.kind !== 'array' && expected.kind !== 'list') {
        throw error(expr.loc, `expected ${typeName(expected)}, got array`)
      }
      if (expr.items.length === 0) {
        if (!expected || (expected.kind !== 'array' && expected.kind !== 'list')) {
          throw error(expr.loc, 'empty array needs a type')
        }
        expr.elemType = expected.elem
        expr.asList = expected.kind === 'list'
        return expected
      }
      const elemExpected =
        expected?.kind === 'array' || expected?.kind === 'list' ? expected.elem : undefined
      const first = checkExpr(expr.items[0]!, env, returnType, elemExpected)
      for (let index = 1; index < expr.items.length; index += 1) {
        checkExpr(expr.items[index]!, env, returnType, elemExpected ?? first)
      }
      const elem = elemExpected ?? first
      const asList = !expected || expected.kind === 'list'
      expr.elemType = elem
      expr.asList = asList
      return asList ? { kind: 'list', elem } : { kind: 'array', elem }
    }
    case 'mapLit': {
      if (expected && expected.kind !== 'map') {
        throw error(expr.loc, `expected ${typeName(expected)}, got Map`)
      }
      if (expr.entries.length === 0) {
        if (!expected || expected.kind !== 'map') {
          throw error(expr.loc, 'empty `{}` needs a type')
        }
        expr.keyType = expected.key
        expr.valueType = expected.value
        return expected
      }
      const keyExpected = expected?.kind === 'map' ? expected.key : undefined
      const valueExpected = expected?.kind === 'map' ? expected.value : undefined
      const firstKey = checkExpr(expr.entries[0]!.key, env, returnType, keyExpected)
      const firstValue = checkExpr(expr.entries[0]!.value, env, returnType, valueExpected)
      if (!isHashable(firstKey)) {
        throw error(expr.entries[0]!.key.loc, `Map key type ${typeName(firstKey)} is not Hash`)
      }
      for (let index = 1; index < expr.entries.length; index += 1) {
        checkExpr(expr.entries[index]!.key, env, returnType, keyExpected ?? firstKey)
        checkExpr(expr.entries[index]!.value, env, returnType, valueExpected ?? firstValue)
      }
      const mapType: ZeeType = {
        kind: 'map',
        key: keyExpected ?? firstKey,
        value: valueExpected ?? firstValue,
      }
      expr.keyType = mapType.key
      expr.valueType = mapType.value
      return mapType
    }
    case 'structLit': {
      const constructed = resolveStructLit(expr, env)
      if (constructed.kind === 'sealed') {
        const variant = constructed.variant
        checkVariantVisible(variant, constructed.type.module, env, expr.loc)
        const seen = new Set<string>()
        for (const field of expr.fields) {
          if (seen.has(field.name)) throw error(expr.loc, `duplicate field \`${field.name}\``)
          seen.add(field.name)
          const decl = variant.fields.find((item) => item.name === field.name)
          if (!decl) throw error(expr.loc, `unknown field \`${field.name}\` on ${constructed.type.name}.${variant.name}`)
          checkExpr(field.value, env, returnType, decl.type)
        }
        for (const decl of variant.fields) {
          if (!seen.has(decl.name)) {
            throw error(expr.loc, `missing field \`${decl.name}\` in ${constructed.type.name}.${variant.name}`)
          }
        }
        return constructed.type
      }
      const struct = constructed.type
      const seen = new Set<string>()
      for (const field of expr.fields) {
        if (seen.has(field.name)) throw error(expr.loc, `duplicate field \`${field.name}\``)
        seen.add(field.name)
        const decl = struct.fields.find((item) => item.name === field.name)
        if (!decl) throw error(expr.loc, `unknown field \`${field.name}\` on ${struct.name}`)
        checkFieldVisible(decl, struct.module, env, expr.loc, field.name)
        checkExpr(field.value, env, returnType, decl.type)
      }
      for (const decl of struct.fields) {
        if (!seen.has(decl.name)) {
          throw error(expr.loc, `missing field \`${decl.name}\` in ${struct.name}`)
        }
      }
      return struct
    }
    case 'if': {
      const cond = checkExpr(expr.cond, env, returnType)
      if (!typeEq(cond, T_BOOL)) {
        throw error(expr.cond.loc, `if condition must be bool, got ${typeName(cond)}`)
      }
      let thenEnv = env
      if (expr.cond.kind === 'isType' && expr.cond.expr.kind === 'ident') {
        const binding = env.lookup(expr.cond.expr.name)
        const narrowed = resolveTypeAst(expr.cond.type, env)
        if (binding) {
          thenEnv = env.child()
          thenEnv.define(expr.cond.expr.name, narrowed, binding.mutable)
        }
      }
      const thenType = checkBlock(expr.then, thenEnv, returnType, expected)
      if (!expr.else) {
        if (!typeEq(thenType, T_UNIT) && !isNeverType(thenType)) {
          throw error(expr.loc, 'if expression is missing `else`')
        }
        return T_UNIT
      }
      const elseType = checkBlock(expr.else, env, returnType, expected)
      const unified = unifyWithNever(thenType, elseType)
      if (!unified) {
        throw error(
          expr.loc,
          `if branches have different types (${typeName(thenType)} vs ${typeName(elseType)})`,
        )
      }
      return unified
    }
    case 'block':
      if (expected?.kind === 'fn') return checkImplicitLambda(expr, env, expected)
      if (expected?.kind === 'map' && expr.block.stmts.length === 0) {
        expr.mapType = { key: expected.key, value: expected.value }
        return expected
      }
      if (expr.block.stmts.length === 0 && !expected) {
        throw error(expr.loc, 'empty `{}` needs a type')
      }
      return checkBlock(expr.block, env, returnType, expected)
    case 'lambda':
      return checkLambda(expr, env, expected)
    case 'match':
      return checkMatch(expr, env, returnType, expected)
    case 'copy':
      return checkCopy(expr, env, returnType)
    case 'returnExpr': {
      const valueType = expr.expr ? checkExpr(expr.expr, env, returnType, returnType) : T_UNIT
      if (!isAssignable(valueType, returnType) && !isNeverType(valueType)) {
        throw error(
          expr.loc,
          `return has type ${typeName(valueType)}, expected ${typeName(returnType)}`,
        )
      }
      return T_NEVER
    }
    case 'isType': {
      checkExpr(expr.expr, env, returnType)
      resolveTypeAst(expr.type, env)
      return T_BOOL
    }
  }
}

function checkElvis(
  expr: Extract<Expr, { kind: 'binary' }>,
  env: TypeEnv,
  returnType: ZeeType,
  expected?: ZeeType,
): ZeeType {
  const noneLeft = expr.left.kind === 'ident' && expr.left.name === 'None'
  if (noneLeft) {
    const rightType = checkExpr(expr.right, env, returnType, expected)
    if (isNeverType(rightType)) {
      const inner = expected ?? T_NEVER
      checkExpr(expr.left, env, returnType, { kind: 'option', inner })
      return inner
    }
    const inner = rightType
    if (!inner) throw error(expr.left.loc, '`None` needs a type context')
    checkExpr(expr.left, env, returnType, { kind: 'option', inner })
    return inner
  }
  const leftExpected = expected ? { kind: 'option' as const, inner: expected } : undefined
  const leftType = checkExpr(expr.left, env, returnType, leftExpected)
  if (leftType.kind !== 'option') {
    throw error(expr.loc, `operator \`?:\` expects Option, got ${typeName(leftType)}`)
  }
  checkExpr(expr.right, env, returnType, leftType.inner)
  return leftType.inner
}

function checkMatch(
  expr: Extract<Expr, { kind: 'match' }>,
  env: TypeEnv,
  returnType: ZeeType,
  expected?: ZeeType,
): ZeeType {
  const scrutType = checkExpr(expr.scrutinee, env, returnType)
  if (!canMatch(scrutType)) {
    throw error(expr.scrutinee.loc, `cannot match on ${typeName(scrutType)}`)
  }
  let bodyType: ZeeType | undefined
  for (const arm of expr.arms) {
    const armEnv = env.child()
    for (const pattern of arm.patterns) {
      checkMatchPattern(pattern, scrutType, env, armEnv, returnType)
    }
    const armType = checkExpr(arm.body, armEnv, returnType, expected)
    if (!bodyType) bodyType = armType
    else {
      const unified = unifyWithNever(bodyType, armType)
      if (!unified) {
        throw error(
          arm.loc,
          `match arms have different types (${typeName(bodyType)} vs ${typeName(armType)})`,
        )
      }
      bodyType = unified
    }
  }
  if (!bodyType) throw error(expr.loc, '`match` needs at least one arm')
  if (!matchIsExhaustive(scrutType, expr.arms, env)) {
    throw error(expr.loc, '`match` is not exhaustive')
  }
  return bodyType
}

function canMatch(type: ZeeType): boolean {
  return (
    isEquatable(type) ||
    type.kind === 'sealed' ||
    type.kind === 'interface' ||
    type.kind === 'option'
  )
}

function checkMatchPattern(
  pattern: MatchPattern,
  scrutType: ZeeType,
  env: TypeEnv,
  armEnv: TypeEnv,
  returnType: ZeeType,
): void {
  if (pattern.kind === 'wildcard') return
  if (pattern.kind === 'value') {
    checkExpr(pattern.expr, env, returnType, scrutType)
    return
  }
  if (scrutType.kind === 'interface') {
    checkInterfacePattern(pattern, scrutType, env, armEnv)
    return
  }
  const resolved = resolveVariantPath(pattern.path, env, pattern.loc)
  if (!typeEq(resolved.type, scrutType)) {
    throw error(
      pattern.loc,
      `pattern \`${pattern.path.join('.')}\` has type ${typeName(resolved.type)}, expected ${typeName(scrutType)}`,
    )
  }
  if (resolved.kind === 'enum') {
    if (pattern.fields) {
      throw error(pattern.loc, `enum variant \`${resolved.variant}\` has no fields`)
    }
    return
  }
  checkVariantVisible(resolved.variantInfo, resolved.type.module, env, pattern.loc)
  const fields = pattern.fields ?? []
  const seen = new Set<string>()
  for (const field of fields) {
    if (seen.has(field.name)) throw error(pattern.loc, `duplicate field \`${field.name}\``)
    seen.add(field.name)
    const decl = resolved.variantInfo.fields.find((item) => item.name === field.name)
    if (!decl) {
      throw error(
        pattern.loc,
        `unknown field \`${field.name}\` on ${resolved.type.name}.${resolved.variant}`,
      )
    }
    if (field.name !== '_') {
      if (armEnv.hasOwn(field.name)) throw error(pattern.loc, `duplicate binding \`${field.name}\``)
      armEnv.define(field.name, decl.type)
    }
  }
  for (const decl of resolved.variantInfo.fields) {
    if (!seen.has(decl.name)) {
      throw error(
        pattern.loc,
        `missing field \`${decl.name}\` in ${resolved.type.name}.${resolved.variant}`,
      )
    }
  }
}

function checkInterfacePattern(
  pattern: Extract<MatchPattern, { kind: 'variant' }>,
  iface: InterfaceType,
  env: TypeEnv,
  armEnv: TypeEnv,
): void {
  if (pattern.path.length !== 1) {
    throw error(pattern.loc, 'interface match uses `Type { fields }`')
  }
  const name = pattern.path[0]!
  const struct = env.getStruct(name)
  if (!struct) throw error(pattern.loc, `unknown type \`${name}\``)
  if (!typeImplements(struct, iface)) {
    throw error(pattern.loc, `\`${name}\` does not implement ${typeName(iface)}`)
  }
  const fields = pattern.fields ?? []
  const seen = new Set<string>()
  for (const field of fields) {
    if (seen.has(field.name)) throw error(pattern.loc, `duplicate field \`${field.name}\``)
    seen.add(field.name)
    const decl = struct.fields.find((item) => item.name === field.name)
    if (!decl) throw error(pattern.loc, `unknown field \`${field.name}\` on ${struct.name}`)
    if (field.name !== '_') {
      if (armEnv.hasOwn(field.name)) throw error(pattern.loc, `duplicate binding \`${field.name}\``)
      armEnv.define(field.name, decl.type)
    }
  }
  for (const decl of struct.fields) {
    if (!seen.has(decl.name)) {
      throw error(pattern.loc, `missing field \`${decl.name}\` in ${struct.name}`)
    }
  }
}

function matchIsExhaustive(
  scrutType: ZeeType,
  arms: Extract<Expr, { kind: 'match' }>['arms'],
  env: TypeEnv,
): boolean {
  if (arms.some((arm) => arm.patterns.some((pattern) => pattern.kind === 'wildcard'))) return true
  if (scrutType.kind === 'enum' || scrutType.kind === 'sealed') {
    const needed =
      scrutType.kind === 'enum'
        ? new Set(scrutType.variants)
        : new Set(scrutType.variants.map((variant) => variant.name))
    const covered = new Set<string>()
    for (const arm of arms) {
      for (const pattern of arm.patterns) {
        const name = variantCoveredByPattern(pattern, scrutType, env)
        if (name) covered.add(name)
      }
    }
    return [...needed].every((name) => covered.has(name))
  }
  if (scrutType.kind === 'interface') {
    if (!scrutType.sealed) return false
    const needed = new Set(scrutType.implementors.map((item) => item.name))
    const covered = new Set<string>()
    for (const arm of arms) {
      for (const pattern of arm.patterns) {
        if (pattern.kind === 'variant') covered.add(pattern.path[pattern.path.length - 1]!)
      }
    }
    return [...needed].every((name) => covered.has(name))
  }
  if (scrutType.kind !== 'bool') return false
  let hasTrue = false
  let hasFalse = false
  for (const arm of arms) {
    for (const pattern of arm.patterns) {
      if (pattern.kind !== 'value' || pattern.expr.kind !== 'bool') continue
      if (pattern.expr.value) hasTrue = true
      else hasFalse = true
    }
  }
  return hasTrue && hasFalse
}

function variantCoveredByPattern(
  pattern: Extract<Expr, { kind: 'match' }>['arms'][number]['patterns'][number],
  scrutType: ZeeType,
  env: TypeEnv,
): string | undefined {
  if (pattern.kind === 'variant') {
    return pattern.path[pattern.path.length - 1]
  }
  if (pattern.kind !== 'value' || scrutType.kind !== 'enum') return undefined
  return enumVariantFromExpr(pattern.expr, scrutType, env)
}

function enumVariantFromExpr(expr: Expr, scrutType: EnumType, env: TypeEnv): string | undefined {
  if (expr.kind !== 'member') return undefined
  if (!scrutType.variants.includes(expr.field)) return undefined
  if (expr.target.kind === 'ident') {
    const ns = env.get(expr.target.name)
    if (ns?.kind === 'typeNs' && ns.of.kind === 'enum' && typeEq(ns.of, scrutType)) {
      return expr.field
    }
  }
  if (expr.target.kind === 'member' && expr.target.target.kind === 'ident') {
    const mod = env.get(expr.target.target.name)
    if (mod?.kind !== 'module') return undefined
    const moduleEnv = env.getModule(mod.name)
    const ns = moduleEnv?.own(expr.target.field)?.type
    if (ns?.kind === 'typeNs' && ns.of.kind === 'enum' && typeEq(ns.of, scrutType)) {
      return expr.field
    }
  }
  return undefined
}

function resolveVariantPath(
  path: string[],
  env: TypeEnv,
  loc: { file: string; line: number; column: number },
):
  | { kind: 'enum'; type: EnumType; variant: string }
  | { kind: 'sealed'; type: SealedType; variant: string; variantInfo: SealedVariantType } {
  if (path.length < 2) {
    throw error(loc, 'variant pattern needs `Type.Variant`')
  }
  const variant = path[path.length - 1]!
  const typeParts = path.slice(0, -1)
  let enumType: EnumType | undefined
  let sealed: SealedType | undefined
  if (typeParts.length === 1) {
    enumType = env.getEnum(typeParts[0]!)
    sealed = env.getSealed(typeParts[0]!)
  } else if (typeParts.length === 2) {
    const first = env.get(typeParts[0]!)
    if (!first || first.kind !== 'module') {
      throw error(loc, `unknown type \`${path.join('.')}\``)
    }
    const moduleEnv = env.getModule(first.name)
    if (!moduleEnv) throw error(loc, `unknown module \`${first.name}\``)
    enumType = moduleEnv.getEnum(typeParts[1]!)
    sealed = moduleEnv.getSealed(typeParts[1]!)
  } else {
    throw error(loc, `unknown type \`${path.join('.')}\``)
  }
  if (enumType) {
    if (!enumType.variants.includes(variant)) {
      throw error(loc, `unknown variant \`${variant}\` on ${enumType.name}`)
    }
    return { kind: 'enum', type: enumType, variant }
  }
  if (sealed) {
    const variantInfo = sealed.variants.find((item) => item.name === variant)
    if (!variantInfo) throw error(loc, `unknown variant \`${variant}\` on ${sealed.name}`)
    return { kind: 'sealed', type: sealed, variant, variantInfo }
  }
  throw error(loc, `unknown type \`${typeParts.join('.')}\``)
}

function checkImplicitLambda(
  expr: Extract<Expr, { kind: 'block' }>,
  env: TypeEnv,
  expected: Extract<ZeeType, { kind: 'fn' }>,
): ZeeType {
  if (expected.params.length > 1) {
    throw error(expr.loc, 'lambda with several parameters needs names (`{ a, b -> ... }`)')
  }
  const params = expected.params.length === 1 ? ['it'] : []
  expr.lambdaParams = params
  return checkLambdaBody(params, expr.block, env, expected, expr.loc)
}

function checkLambda(
  expr: Extract<Expr, { kind: 'lambda' }>,
  env: TypeEnv,
  expected?: ZeeType,
): ZeeType {
  if (!expected || expected.kind !== 'fn') {
    throw error(expr.loc, 'lambda needs a type context')
  }
  if (expr.params.length !== expected.params.length) {
    throw error(
      expr.loc,
      `lambda has ${expr.params.length} parameter(s), expected ${expected.params.length}`,
    )
  }
  return checkLambdaBody(expr.params, expr.body, env, expected, expr.loc)
}

function checkLambdaBody(
  params: string[],
  body: Block,
  env: TypeEnv,
  expected: Extract<ZeeType, { kind: 'fn' }>,
  loc: { file: string; line: number; column: number },
): ZeeType {
  const bodyEnv = env.lambdaFrame()
  const seen = new Set<string>()
  params.forEach((name, index) => {
    if (name === '_') return
    if (seen.has(name)) throw error(loc, `duplicate binding \`${name}\``)
    seen.add(name)
    bodyEnv.define(name, expected.params[index]!)
  })
  const bodyType = checkBlock(body, bodyEnv, expected.ret, expected.ret)
  if (!isAssignable(bodyType, expected.ret) && !typeEq(bodyType, T_UNIT)) {
    throw error(body.loc, `lambda returns ${typeName(bodyType)}, expected ${typeName(expected.ret)}`)
  }
  if (!typeEq(expected.ret, T_UNIT) && typeEq(bodyType, T_UNIT) && !blockHasReturn(body)) {
    throw error(body.loc, `lambda returns Unit, expected ${typeName(expected.ret)}`)
  }
  return expected
}

function checkBinary(
  expr: Extract<Expr, { kind: 'binary' }>,
  env: TypeEnv,
  returnType: ZeeType,
  expected?: ZeeType,
): ZeeType {
  const op = expr.op
  if (op === '===' || op === '!==') {
    const left = checkExpr(expr.left, env, returnType)
    const right = checkExpr(expr.right, env, returnType, left)
    if (!typeEq(left, right) || !isIdentityType(left)) {
      throw error(
        expr.loc,
        `operator \`${op}\` is only defined for class, not ${typeName(left)}`,
      )
    }
    return T_BOOL
  }
  if (op === '==' || op === '!=') {
    const leftIsNone = expr.left.kind === 'ident' && expr.left.name === 'None'
    const rightIsNone = expr.right.kind === 'ident' && expr.right.name === 'None'
    const first = leftIsNone && !rightIsNone ? expr.right : expr.left
    const second = first === expr.left ? expr.right : expr.left
    const firstType = checkExpr(first, env, returnType)
    const secondType = checkExpr(second, env, returnType, firstType)
    const noneCompare = leftIsNone || rightIsNone
    if (!typeEq(firstType, secondType) || (!noneCompare && !isEquatable(firstType) && !isFloatType(firstType))) {
      throw error(
        expr.loc,
        `operator \`${op}\` is not defined for ${typeName(firstType)} and ${typeName(secondType)}`,
      )
    }
    return T_BOOL
  }

  if (op === '<<' || op === '>>') {
    const leftExpected = expected && isIntType(expected) ? expected : undefined
    const left = checkExpr(expr.left, env, returnType, leftExpected)
    const countExpected = expr.right.kind === 'int' && !expr.right.suffix ? T_U32 : undefined
    const right = checkExpr(expr.right, env, returnType, countExpected)
    if (!isIntType(left)) {
      throw error(expr.loc, `operator \`${op}\` is not defined for ${typeName(left)}`)
    }
    if (!isShiftCountType(left, right)) {
      throw error(
        expr.loc,
        `shift count must be u32 or unsigned of the same width as ${typeName(left)}`,
      )
    }
    return left
  }

  const arithmetic = op === '+' || op === '-' || op === '*' || op === '/' || op === '%'
  const bitwise = op === '&' || op === '|' || op === '^'
  const numExpected =
    arithmetic && expected && (isIntType(expected) || isFloatType(expected))
      ? expected
      : bitwise && expected && isIntType(expected)
        ? expected
        : undefined
  let left: ZeeType
  let right: ZeeType
  if (isNumericLiteral(expr.left) && !isNumericLiteral(expr.right)) {
    right = checkExpr(expr.right, env, returnType, numExpected)
    left = checkExpr(expr.left, env, returnType, literalExpected(expr.left, right, numExpected))
  } else if (!isNumericLiteral(expr.left) && isNumericLiteral(expr.right)) {
    left = checkExpr(expr.left, env, returnType, numExpected)
    right = checkExpr(expr.right, env, returnType, literalExpected(expr.right, left, numExpected))
  } else {
    left = checkExpr(expr.left, env, returnType, numExpected)
    right = checkExpr(
      expr.right,
      env,
      returnType,
      isNumericLiteral(expr.right) ? literalExpected(expr.right, left, numExpected) : numExpected,
    )
  }

  if (op === '+' && typeEq(left, T_STRING) && typeEq(right, T_STRING)) return T_STRING
  if (
    op === '+' &&
    (left.kind === 'list' || left.kind === 'array') &&
    right.kind === left.kind &&
    typeEq(left, right)
  ) {
    return left
  }
  if (
    (op === '+' || op === '-' || op === '*' || op === '/' || op === '%') &&
    (isIntType(left) || isFloatType(left)) &&
    typeEq(left, right)
  ) {
    return left
  }
  if ((op === '&' || op === '|' || op === '^') && isIntType(left) && typeEq(left, right)) {
    return left
  }
  if (op === '<===>' && isOrdType(left) && typeEq(left, right)) return T_I32
  if ((op === '<' || op === '<=' || op === '>' || op === '>=') && isOrdType(left) && typeEq(left, right)) {
    return T_BOOL
  }
  if ((op === '&&' || op === '||') && typeEq(left, T_BOOL) && typeEq(right, T_BOOL)) return T_BOOL
  throw error(
    expr.loc,
    `operator \`${op}\` is not defined for ${typeName(left)} and ${typeName(right)}`,
  )
}

function isIntLiteral(expr: Expr): boolean {
  return expr.kind === 'int'
}

function isNumericLiteral(expr: Expr): boolean {
  return expr.kind === 'int' || expr.kind === 'float'
}

function literalExpected(expr: Expr, other: ZeeType, fallback?: ZeeType): ZeeType | undefined {
  if (expr.kind === 'int' && !expr.suffix && isIntType(other)) return other
  if (expr.kind === 'float' && !expr.suffix && isFloatType(other)) return other
  return fallback
}

function checkRangeBounds(start: Expr, end: Expr, env: TypeEnv, returnType: ZeeType): ZeeType {
  let startType: ZeeType
  let endType: ZeeType
  if (isIntLiteral(start) && !isIntLiteral(end)) {
    endType = checkExpr(end, env, returnType)
    startType = checkExpr(start, env, returnType, isIntType(endType) ? endType : undefined)
  } else if (!isIntLiteral(start) && isIntLiteral(end)) {
    startType = checkExpr(start, env, returnType)
    endType = checkExpr(end, env, returnType, isIntType(startType) ? startType : undefined)
  } else {
    startType = checkExpr(start, env, returnType)
    endType = checkExpr(
      end,
      env,
      returnType,
      isIntLiteral(end) && isIntType(startType) ? startType : undefined,
    )
  }
  if (!isIntType(startType) || !typeEq(startType, endType)) {
    throw error(
      start.loc,
      `range bounds must be the same integer type, got ${typeName(startType)} and ${typeName(endType)}`,
    )
  }
  return startType
}

function checkCopy(
  expr: Extract<Expr, { kind: 'copy' }>,
  env: TypeEnv,
  returnType: ZeeType,
): ZeeType {
  const target = checkExpr(expr.target, env, returnType)
  if (target.kind !== 'struct' || !target.data) {
    throw error(expr.loc, '`copy` is only defined on `data` struct and `data` class')
  }
  const seen = new Set<string>()
  for (const field of expr.fields) {
    if (seen.has(field.name)) throw error(expr.loc, `duplicate field \`${field.name}\` in \`copy\``)
    seen.add(field.name)
    const decl = target.fields.find((item) => item.name === field.name)
    if (!decl) throw error(expr.loc, `unknown field \`${field.name}\` on ${target.name}`)
    checkFieldVisible(decl, target.module, env, expr.loc, field.name)
    checkExpr(field.value, env, returnType, decl.type)
  }
  return target
}

function checkWrapCall(
  expr: Extract<Expr, { kind: 'call' }>,
  env: TypeEnv,
  returnType: ZeeType,
): ZeeType {
  const name = expr.callee.kind === 'member' ? expr.callee.field : ''
  if (name !== 'add' && name !== 'sub' && name !== 'mul' && name !== 'shl') {
    throw error(expr.loc, `undefined name \`${name}\` on module \`wrap\``)
  }
  if (expr.args.length !== 2) {
    throw error(expr.loc, `\`wrap.${name}\` takes two arguments`)
  }
  const first = checkExpr(expr.args[0]!, env, returnType)
  if (!isIntType(first)) {
    throw error(expr.args[0]!.loc, `\`wrap.${name}\` expects integers`)
  }
  const second = checkExpr(expr.args[1]!, env, returnType, first)
  if (!typeEq(first, second)) {
    throw error(expr.loc, `\`wrap.${name}\` needs the same integer type on both sides`)
  }
  return first
}

function checkCall(
  expr: Extract<Expr, { kind: 'call' }>,
  env: TypeEnv,
  returnType: ZeeType,
  expected?: ZeeType,
): ZeeType {
  if (expr.callee.kind === 'ident') {
    const name = expr.callee.name
    if (name === 'Some') {
      if (expr.args.length !== 1) throw error(expr.loc, '`Some` takes one argument')
      const innerExpected = expected?.kind === 'option' ? expected.inner : undefined
      const inner = checkExpr(expr.args[0]!, env, returnType, innerExpected)
      return { kind: 'option', inner }
    }
    if (name === 'expect') {
      if (expr.args.length !== 1) throw error(expr.loc, '`expect` takes one argument')
      const inner = checkExpr(expr.args[0]!, env, returnType)
      if (!isEquatable(inner) && !isFloatType(inner)) {
        throw error(expr.args[0]!.loc, '`expect` needs an Eq value')
      }
      return { kind: 'expect', inner }
    }
    if (name === 'describe') {
      if (expr.args.length < 1 || expr.args.length > 2) {
        throw error(expr.loc, '`describe` takes a title and an optional `{ ... }` block')
      }
      const arg = expr.args[0]!
      if (arg.kind !== 'string') {
        throw error(arg.loc, '`describe` needs a string literal')
      }
      checkExpr(arg, env, returnType, T_STRING)
      if (expr.args[1]) checkDescribeBody(expr.args[1], env)
      return T_UNIT
    }
    if (name === 'narrow') {
      if (!expr.typeArgs || expr.typeArgs.length !== 1) {
        throw error(expr.loc, '`narrow` takes one type argument')
      }
      if (expr.args.length !== 1) throw error(expr.loc, '`narrow` takes one argument')
      const target = resolveTypeAst(expr.typeArgs[0]!, env)
      if (!isIntType(target)) {
        throw error(expr.loc, '`narrow` target must be an integer type')
      }
      const arg = checkExpr(expr.args[0]!, env, returnType)
      if (!isIntType(arg) && !isFloatType(arg)) {
        throw error(expr.args[0]!.loc, '`narrow` expects an integer or float')
      }
      return { kind: 'option', inner: target }
    }
    if (isFloatKind(name)) {
      if (expr.args.length !== 1) throw error(expr.loc, `\`${name}\` takes one argument`)
      const target = { kind: name } as ZeeType
      const from = checkExpr(expr.args[0]!, env, returnType)
      if (from.kind === 'newtype' && (isIntType(from.inner) || isFloatType(from.inner))) {
        return target
      }
      if (isIntType(from) || isFloatType(from)) return target
      throw error(expr.args[0]!.loc, `cannot convert ${typeName(from)} to ${name}`)
    }
    if (isIntKind(name)) {
      if (expr.args.length !== 1) throw error(expr.loc, `\`${name}\` takes one argument`)
      const target = { kind: name } as ZeeType
      const argExpr = expr.args[0]!
      if (argExpr.kind === 'int') {
        checkExpr(argExpr, env, returnType, target)
        return target
      }
      const from = checkExpr(argExpr, env, returnType)
      if (from.kind === 'newtype' && typeEq(from.inner, target)) return target
      if (!isIntType(from) || !isIntType(target)) {
        throw error(argExpr.loc, `cannot convert ${typeName(from)} to ${name}`)
      }
      if (typeEq(from, target) || canWidenInt(from.kind, target.kind)) return target
      throw error(
        expr.loc,
        `cannot convert ${typeName(from)} to ${name}; use narrow<${name}>(…)`,
      )
    }
    if (expr.args.length === 1) {
      const target = typeFromName(name)
      if (target) {
        const from = checkExpr(expr.args[0]!, env, returnType)
        if (from.kind === 'newtype' && typeEq(from.inner, target)) return target
        throw error(expr.args[0]!.loc, `cannot convert ${typeName(from)} to ${name}`)
      }
    }
    if ((name === 'print' || name === 'println') && expr.args.length === 1) {
      const arg = checkExpr(expr.args[0]!, env, returnType)
      if (arg.kind !== 'string' && arg.kind !== 'bool' && !isIntType(arg) && !isFloatType(arg)) {
        throw error(expr.args[0]!.loc, `\`${name}\` cannot print ${typeName(arg)}`)
      }
      return T_UNIT
    }
    if (name === 'printf' || name === 'sprintf') {
      return checkPrintfCall(name, expr, env, returnType)
    }
    if (name === 'str') {
      if (expr.args.length !== 1) throw error(expr.loc, '`str` takes one argument')
      const arg = checkExpr(expr.args[0]!, env, returnType)
      if (!isIntType(arg) && arg.kind !== 'bool' && !isFloatType(arg)) {
        throw error(expr.args[0]!.loc, '`str` expects an integer, float, or bool')
      }
      return T_STRING
    }
  }
  if (expr.callee.kind === 'member') {
    if (expr.callee.target.kind === 'ident' && expr.callee.target.name === 'wrap') {
      return checkWrapCall(expr, env, returnType)
    }
    if (
      expr.callee.target.kind === 'ident' &&
      expr.callee.target.name === 'String' &&
      expr.callee.field === 'fromBytes'
    ) {
      if (expr.args.length !== 1) throw error(expr.loc, '`String.fromBytes` takes one argument')
      const from = checkExpr(expr.args[0]!, env, returnType)
      if (from.kind !== 'array' || from.elem.kind !== 'u8') {
        throw error(expr.args[0]!.loc, '`String.fromBytes` expects `u8[]`')
      }
      return { kind: 'tuple', parts: [T_STRING, { kind: 'option', inner: T_ERROR }] }
    }
    const targetType = checkExpr(expr.callee.target, env, returnType)
    const builtin = checkBuiltinMethod(targetType, expr.callee.field, expr, env, returnType)
    if (builtin) return builtin
    const method = lookupMethod(targetType, expr.callee.field, env)
    if (method) {
      if (method.mutating) {
        requireVarReceiver(expr.callee.target, env, expr.loc)
      }
      const rest = method.type.params.slice(1)
      if (expr.args.length !== rest.length) {
        throw error(
          expr.loc,
          `\`${expr.callee.field}\` expects ${rest.length} argument(s), got ${expr.args.length}`,
        )
      }
      expr.args.forEach((arg, index) => {
        checkExpr(arg, env, returnType, rest[index])
      })
      return method.type.ret
    }
  }
  const callee = checkExpr(expr.callee, env, returnType)
  if (callee.kind !== 'fn') {
    throw error(expr.callee.loc, `cannot call ${typeName(callee)}`)
  }
  if (callee.typeParams && callee.typeParams.length > 0) {
    return checkGenericCall(expr, callee, env, returnType, expected)
  }
  const label = expr.callee.kind === 'ident' ? expr.callee.name : typeName(callee)
  if (expr.typeArgs && expr.typeArgs.length > 0) {
    throw error(expr.loc, `\`${label}\` does not take type arguments`)
  }
  if (expr.args.length !== callee.params.length) {
    throw error(
      expr.loc,
      `\`${label}\` expects ${callee.params.length} argument(s), got ${expr.args.length}`,
    )
  }
  expr.args.forEach((arg, index) => {
    checkExpr(arg, env, returnType, callee.params[index])
  })
  if (expr.callee.kind === 'ident' && env.isMutatingFn(expr.callee.name) && expr.args[0]) {
    requireVarReceiver(expr.args[0]!, env, expr.loc)
  }
  return callee.ret
}

function checkGenericCall(
  expr: Extract<Expr, { kind: 'call' }>,
  callee: Extract<ZeeType, { kind: 'fn' }>,
  env: TypeEnv,
  returnType: ZeeType,
  expected?: ZeeType,
): ZeeType {
  const typeParams = callee.typeParams ?? []
  const label = expr.callee.kind === 'ident' ? expr.callee.name : typeName(callee)
  if (expr.args.length !== callee.params.length) {
    throw error(
      expr.loc,
      `\`${label}\` expects ${callee.params.length} argument(s), got ${expr.args.length}`,
    )
  }
  const subst = new Map<string, ZeeType>()
  if (expr.typeArgs && expr.typeArgs.length > 0) {
    if (expr.typeArgs.length !== typeParams.length) {
      throw error(
        expr.loc,
        `\`${label}\` takes ${typeParams.length} type argument(s), got ${expr.typeArgs.length}`,
      )
    }
    typeParams.forEach((name, index) => {
      subst.set(name, resolveTypeAst(expr.typeArgs![index]!, env))
    })
  }
  expr.args.forEach((arg, index) => {
    const instantiated = substituteType(callee.params[index]!, subst)
    if (!containsTypeParam(instantiated)) {
      checkExpr(arg, env, returnType, instantiated)
      return
    }
    const argType = checkExpr(arg, env, returnType)
    unifyType(callee.params[index]!, argType, subst, arg.loc)
  })
  if (expected && containsTypeParam(substituteType(callee.ret, subst))) {
    unifyType(callee.ret, expected, subst, expr.loc)
  }
  for (const name of typeParams) {
    if (!subst.has(name)) {
      throw error(expr.loc, `cannot infer type parameter \`${name}\``)
    }
  }
  if (expr.callee.kind === 'ident' && env.isMutatingFn(expr.callee.name) && expr.args[0]) {
    requireVarReceiver(expr.args[0]!, env, expr.loc)
  }
  return substituteType(callee.ret, subst)
}

function containsTypeParam(type: ZeeType): boolean {
  switch (type.kind) {
    case 'typeParam':
      return true
    case 'tuple':
      return type.parts.some(containsTypeParam)
    case 'option':
      return containsTypeParam(type.inner)
    case 'list':
    case 'array':
      return containsTypeParam(type.elem)
    case 'map':
      return containsTypeParam(type.key) || containsTypeParam(type.value)
    case 'fn':
      return type.params.some(containsTypeParam) || containsTypeParam(type.ret)
    default:
      return false
  }
}

function substituteType(type: ZeeType, subst: Map<string, ZeeType>): ZeeType {
  switch (type.kind) {
    case 'typeParam':
      return subst.get(type.name) ?? type
    case 'tuple':
      return { kind: 'tuple', parts: type.parts.map((part) => substituteType(part, subst)) }
    case 'option':
      return { kind: 'option', inner: substituteType(type.inner, subst) }
    case 'list':
      return { kind: 'list', elem: substituteType(type.elem, subst) }
    case 'array':
      return { kind: 'array', elem: substituteType(type.elem, subst) }
    case 'map':
      return {
        kind: 'map',
        key: substituteType(type.key, subst),
        value: substituteType(type.value, subst),
      }
    case 'fn':
      return {
        kind: 'fn',
        params: type.params.map((param) => substituteType(param, subst)),
        ret: substituteType(type.ret, subst),
        typeParams: type.typeParams,
      }
    default:
      return type
  }
}

function unifyType(
  pattern: ZeeType,
  actual: ZeeType,
  subst: Map<string, ZeeType>,
  loc: { file: string; line: number; column: number },
): void {
  const expected = substituteType(pattern, subst)
  if (expected.kind === 'typeParam') {
    if (actual.kind === 'typeParam' && actual.name === expected.name) return
    const existing = subst.get(expected.name)
    if (existing) {
      if (!isAssignable(actual, existing) && !typeEq(actual, existing)) {
        throw error(loc, `expected ${typeName(existing)}, got ${typeName(actual)}`)
      }
      return
    }
    subst.set(expected.name, actual)
    return
  }
  if (isNeverType(actual)) return
  if (expected.kind === 'tuple' && actual.kind === 'tuple') {
    if (expected.parts.length !== actual.parts.length) {
      throw error(loc, `expected ${typeName(expected)}, got ${typeName(actual)}`)
    }
    expected.parts.forEach((part, index) => unifyType(part, actual.parts[index]!, subst, loc))
    return
  }
  if (expected.kind === 'option' && actual.kind === 'option') {
    unifyType(expected.inner, actual.inner, subst, loc)
    return
  }
  if (expected.kind === 'list' && actual.kind === 'list') {
    unifyType(expected.elem, actual.elem, subst, loc)
    return
  }
  if (expected.kind === 'array' && actual.kind === 'array') {
    unifyType(expected.elem, actual.elem, subst, loc)
    return
  }
  if (expected.kind === 'map' && actual.kind === 'map') {
    unifyType(expected.key, actual.key, subst, loc)
    unifyType(expected.value, actual.value, subst, loc)
    return
  }
  if (expected.kind === 'fn' && actual.kind === 'fn') {
    if (expected.params.length !== actual.params.length) {
      throw error(loc, `expected ${typeName(expected)}, got ${typeName(actual)}`)
    }
    expected.params.forEach((param, index) => unifyType(param, actual.params[index]!, subst, loc))
    unifyType(expected.ret, actual.ret, subst, loc)
    return
  }
  if (!isAssignable(actual, expected)) {
    throw error(loc, `expected ${typeName(expected)}, got ${typeName(actual)}`)
  }
}

function checkBuiltinMethod(
  targetType: ZeeType,
  name: string,
  expr: Extract<Expr, { kind: 'call' }>,
  env: TypeEnv,
  returnType: ZeeType,
): ZeeType | undefined {
  if (name === 'isEmpty' || name === 'isNotEmpty') {
    if (
      targetType.kind === 'list' ||
      targetType.kind === 'array' ||
      targetType.kind === 'string' ||
      targetType.kind === 'map'
    ) {
      if (expr.args.length !== 0) throw error(expr.loc, `\`${name}\` takes no arguments`)
      return T_BOOL
    }
  }
  if (name === 'isBlank' || name === 'isNotBlank') {
    if (targetType.kind === 'string') {
      if (expr.args.length !== 0) throw error(expr.loc, `\`${name}\` takes no arguments`)
      return T_BOOL
    }
    if (targetType.kind === 'list' || targetType.kind === 'array' || targetType.kind === 'map') {
      throw error(expr.loc, `\`${name}\` is only on String`)
    }
  }
  if (targetType.kind === 'option') {
    if (name === 'isNone' || name === 'isSome') {
      if (expr.args.length !== 0) throw error(expr.loc, `\`${name}\` takes no arguments`)
      return T_BOOL
    }
    if (name === 'isNoneOrEmpty') {
      if (expr.args.length !== 0) throw error(expr.loc, '`isNoneOrEmpty` takes no arguments')
      const inner = targetType.inner
      if (
        inner.kind !== 'string' &&
        inner.kind !== 'list' &&
        inner.kind !== 'array' &&
        inner.kind !== 'map'
      ) {
        throw error(
          expr.loc,
          '`isNoneOrEmpty` is only on `Option<String>`, `Option<List<T>>`, `Option<T[]>`, or `Option<Map<K, V>>`',
        )
      }
      return T_BOOL
    }
    if (name === 'isNoneOrBlank') {
      if (expr.args.length !== 0) throw error(expr.loc, '`isNoneOrBlank` takes no arguments')
      if (targetType.inner.kind !== 'string') {
        throw error(expr.loc, '`isNoneOrBlank` is only on `Option<String>`')
      }
      return T_BOOL
    }
  }
  if (name === 'toString') {
    if (
      targetType.kind === 'list' ||
      targetType.kind === 'array' ||
      targetType.kind === 'map'
    ) {
      if (expr.args.length !== 0) throw error(expr.loc, '`toString` takes no arguments')
      return T_STRING
    }
  }
  if (targetType.kind === 'map') {
    const mapped = checkMapMethod(targetType, name, expr)
    if (mapped) return mapped
  }
  if (targetType.kind === 'list' || targetType.kind === 'array') {
    const seq = checkSeqMethod(targetType, name, expr, env, returnType)
    if (seq) return seq
  }
  if (targetType.kind === 'list') {
    if (name === 'toArray') {
      if (expr.args.length !== 0) throw error(expr.loc, '`toArray` takes no arguments')
      return { kind: 'array', elem: targetType.elem }
    }
    if (name === 'map') {
      if (expr.args.length !== 1) throw error(expr.loc, '`map` takes one function')
      const mapped = inferFnArg(expr.args[0]!, [targetType.elem], env, returnType)
      return { kind: 'list', elem: mapped.ret }
    }
    if (name === 'filter') {
      if (expr.args.length !== 1) throw error(expr.loc, '`filter` takes one function')
      checkExpr(expr.args[0]!, env, returnType, {
        kind: 'fn',
        params: [targetType.elem],
        ret: T_BOOL,
      })
      return targetType
    }
    if (name === 'forEach') {
      if (expr.args.length !== 1) throw error(expr.loc, '`forEach` takes one function')
      checkExpr(expr.args[0]!, env, returnType, {
        kind: 'fn',
        params: [targetType.elem],
        ret: T_UNIT,
      })
      return T_UNIT
    }
    if (name === 'sort') {
      if (expr.args.length === 0) {
        if (!isOrdType(targetType.elem)) {
          throw error(expr.loc, '`sort` requires `T: Ord`')
        }
        return targetType
      }
      if (expr.args.length !== 1) {
        throw error(expr.loc, '`sort` takes no arguments or a `(T, T) -> i32` comparator')
      }
      checkExpr(expr.args[0]!, env, returnType, {
        kind: 'fn',
        params: [targetType.elem, targetType.elem],
        ret: T_I32,
      })
      return targetType
    }
    if (name === 'sortBy') {
      if (expr.args.length !== 1) throw error(expr.loc, '`sortBy` takes one function')
      const keyed = inferFnArg(expr.args[0]!, [targetType.elem], env, returnType)
      if (!isOrdType(keyed.ret)) {
        throw error(expr.loc, '`sortBy` requires the key to be `Ord`')
      }
      return targetType
    }
    if (name === 'first' || name === 'last') {
      if (expr.args.length !== 0) throw error(expr.loc, `\`${name}\` takes no arguments`)
      return { kind: 'option', inner: targetType.elem }
    }
    if (name === 'reverse') {
      if (expr.args.length !== 0) throw error(expr.loc, '`reverse` takes no arguments')
      return targetType
    }
    if (name === 'unique') {
      if (expr.args.length !== 0) throw error(expr.loc, '`unique` takes no arguments')
      if (!isEquatable(targetType.elem)) {
        throw error(expr.loc, '`unique` requires `T: Eq`')
      }
      return targetType
    }
    if (name === 'join') {
      if (expr.args.length !== 1) throw error(expr.loc, '`join` takes a String separator')
      if (targetType.elem.kind !== 'string') {
        throw error(expr.loc, '`join` requires `List<String>`')
      }
      checkExpr(expr.args[0]!, env, returnType, T_STRING)
      return T_STRING
    }
  }
  if (targetType.kind === 'array' && name === 'toList') {
    if (expr.args.length !== 0) throw error(expr.loc, '`toList` takes no arguments')
    return { kind: 'list', elem: targetType.elem }
  }
  if (targetType.kind === 'expect' && (name === 'toBe' || name === 'toEqual')) {
    if (expr.args.length !== 1) throw error(expr.loc, `\`expect(...).${name}\` takes one argument`)
    checkExpr(expr.args[0]!, env, returnType, targetType.inner)
    return T_UNIT
  }
  return undefined
}

function checkPrintfCall(
  name: 'printf' | 'sprintf',
  expr: Extract<Expr, { kind: 'call' }>,
  env: TypeEnv,
  returnType: ZeeType,
): ZeeType {
  if (expr.args.length < 1) throw error(expr.loc, `\`${name}\` needs a format String`)
  checkExpr(expr.args[0]!, env, returnType, T_STRING)
  for (let index = 1; index < expr.args.length; index += 1) {
    const arg = checkExpr(expr.args[index]!, env, returnType)
    if (arg.kind !== 'string' && arg.kind !== 'bool' && !isIntType(arg) && !isFloatType(arg)) {
      throw error(expr.args[index]!.loc, `\`${name}\` cannot format ${typeName(arg)}`)
    }
  }
  return name === 'sprintf' ? T_STRING : T_UNIT
}

function checkMapMethod(
  targetType: Extract<ZeeType, { kind: 'map' }>,
  name: string,
  expr: Extract<Expr, { kind: 'call' }>,
): ZeeType | undefined {
  if (name === 'keys') {
    if (expr.args.length !== 0) throw error(expr.loc, '`keys` takes no arguments')
    return { kind: 'list', elem: targetType.key }
  }
  if (name === 'values') {
    if (expr.args.length !== 0) throw error(expr.loc, '`values` takes no arguments')
    return { kind: 'list', elem: targetType.value }
  }
  if (name === 'sortByKey') {
    if (expr.args.length !== 0) throw error(expr.loc, '`sortByKey` takes no arguments')
    if (!isOrdType(targetType.key)) {
      throw error(expr.loc, '`sortByKey` requires `K: Ord`')
    }
    return targetType
  }
  if (name === 'sortByValue') {
    if (expr.args.length !== 0) throw error(expr.loc, '`sortByValue` takes no arguments')
    if (!isOrdType(targetType.value)) {
      throw error(expr.loc, '`sortByValue` requires `V: Ord`')
    }
    return targetType
  }
  if (name === 'sort') {
    throw error(expr.loc, '`sort` is List; Map uses `sortByKey` / `sortByValue` (not PHP `ksort` / `asort`)')
  }
  if (name === 'sortBy') {
    throw error(expr.loc, '`sortBy` is List; Map uses `sortByKey` / `sortByValue`')
  }
  return undefined
}

function checkSeqMethod(
  targetType: Extract<ZeeType, { kind: 'list' | 'array' }>,
  name: string,
  expr: Extract<Expr, { kind: 'call' }>,
  env: TypeEnv,
  returnType: ZeeType,
): ZeeType | undefined {
  if (name === 'contains') {
    if (expr.args.length !== 1) throw error(expr.loc, '`contains` takes one argument')
    if (!isEquatable(targetType.elem)) {
      throw error(expr.loc, '`contains` requires `T: Eq`')
    }
    checkExpr(expr.args[0]!, env, returnType, targetType.elem)
    return T_BOOL
  }
  if (name === 'find' || name === 'any' || name === 'all') {
    if (expr.args.length !== 1) throw error(expr.loc, `\`${name}\` takes one function`)
    checkExpr(expr.args[0]!, env, returnType, {
      kind: 'fn',
      params: [targetType.elem],
      ret: T_BOOL,
    })
    if (name === 'find') return { kind: 'option', inner: targetType.elem }
    return T_BOOL
  }
  if (name === 'slice') {
    if (expr.args.length !== 2) throw error(expr.loc, '`slice` takes start and end (`usize`)')
    checkExpr(expr.args[0]!, env, returnType, T_USIZE)
    checkExpr(expr.args[1]!, env, returnType, T_USIZE)
    return targetType
  }
  return undefined
}

function inferFnArg(
  expr: Expr,
  params: ZeeType[],
  env: TypeEnv,
  returnType: ZeeType,
): Extract<ZeeType, { kind: 'fn' }> {
  if (expr.kind === 'block' || expr.kind === 'lambda') {
    const names = expr.kind === 'lambda' ? expr.params : params.length === 1 ? ['it'] : []
    if (expr.kind === 'block') {
      if (params.length > 1) {
        throw error(expr.loc, 'lambda with several parameters needs names (`{ a, b -> ... }`)')
      }
      expr.lambdaParams = names
    } else if (expr.params.length !== params.length) {
      throw error(
        expr.loc,
        `lambda has ${expr.params.length} parameter(s), expected ${params.length}`,
      )
    }
    const body = expr.kind === 'block' ? expr.block : expr.body
    const bodyEnv = env.lambdaFrame()
    const seen = new Set<string>()
    names.forEach((name, index) => {
      if (name === '_') return
      if (seen.has(name)) throw error(expr.loc, `duplicate binding \`${name}\``)
      seen.add(name)
      bodyEnv.define(name, params[index]!)
    })
    const bodyType = checkBlock(body, bodyEnv, T_UNIT, undefined)
    return { kind: 'fn', params, ret: bodyType }
  }
  const fnType = checkExpr(expr, env, returnType)
  if (fnType.kind !== 'fn' || fnType.params.length !== params.length) {
    throw error(expr.loc, '`map` expects `(T) -> U`')
  }
  if (!typeEq(fnType.params[0]!, params[0]!)) {
    throw error(expr.loc, `expected (${typeName(params[0]!)}) -> U, got ${typeName(fnType)}`)
  }
  return fnType
}

function lookupAssociated(type: ZeeType, name: string, env: TypeEnv): AssociatedInfo | undefined {
  const typeKey = namedTypeKey(type)
  if (!typeKey) return undefined
  const found = env.getAssociated(typeKey, name)
  if (found && associatedVisible(found, env)) return found
  const typeModule = env.getModule(type.kind === 'struct' || type.kind === 'enum' || type.kind === 'sealed' || type.kind === 'newtype' || type.kind === 'interface' ? type.module : '')
  const fromTypeMod = typeModule?.ownAssociated(typeKey, name)
  if (fromTypeMod && associatedVisible(fromTypeMod, env)) return fromTypeMod
  return undefined
}

function associatedVisible(info: AssociatedInfo, env: TypeEnv): boolean {
  if (info.visibility === 'pub') return true
  if (info.visibility === 'internal' && env.module === info.module) return true
  if (info.visibility === 'private' && env.file === info.file) return true
  return false
}

function lookupMethod(type: ZeeType, name: string, env: TypeEnv): MethodInfo | undefined {
  if (type.kind === 'interface') {
    const method = type.methods.find((item) => item.name === name)
    if (!method) return undefined
    return {
      name,
      type: { kind: 'fn', params: [type, ...method.params], ret: method.ret },
      mutating: method.mutating,
      visibility: 'pub',
      file: '<interface>',
      module: type.module,
    }
  }
  const typeKey = namedTypeKey(type)
  if (!typeKey) return undefined
  const found = env.getMethod(typeKey, name)
  if (found && methodVisible(found, env)) return found
  if (!isReceiverType(type)) return undefined
  const typeModule = env.getModule(type.module)
  const fromTypeMod = typeModule?.ownMethod(typeKey, name)
  if (fromTypeMod && methodVisible(fromTypeMod, env)) return fromTypeMod
  return undefined
}

function methodVisible(method: MethodInfo, env: TypeEnv): boolean {
  if (method.visibility === 'pub') return true
  if (method.visibility === 'internal' && env.module === method.module) return true
  if (method.visibility === 'private' && env.file === method.file) return true
  return false
}

function requireVarReceiver(
  expr: Expr,
  env: TypeEnv,
  loc: { file: string; line: number; column: number },
): void {
  if (expr.kind !== 'ident') {
    throw error(loc, 'mutating method needs a var binding')
  }
  const binding = env.lookup(expr.name)
  if (!binding) throw error(expr.loc, `undefined name \`${expr.name}\``)
  if (!binding.mutable) {
    throw error(loc, `cannot call mutating method on const \`${expr.name}\``)
  }
}

function lookupModuleMember(
  moduleName: string,
  field: string,
  env: TypeEnv,
  loc: { file: string; line: number; column: number },
): ZeeType {
  const moduleEnv = env.getModule(moduleName)
  if (!moduleEnv) throw error(loc, `unknown module \`${moduleName}\``)
  const binding = moduleEnv.own(field)
  const struct = moduleEnv.hasOwnStruct(field) ? moduleEnv.getStruct(field) : undefined
  const enumType = moduleEnv.hasOwnEnum(field) ? moduleEnv.getEnum(field) : undefined
  const sealed = moduleEnv.hasOwnSealed(field) ? moduleEnv.getSealed(field) : undefined
  const newtype = moduleEnv.hasOwnNewtype(field) ? moduleEnv.getNewtype(field) : undefined
  const iface = moduleEnv.hasOwnInterface(field) ? moduleEnv.getInterface(field) : undefined
  const vis =
    binding?.visibility ??
    (struct ? moduleEnv.structVisibility(field) : undefined) ??
    (enumType ? moduleEnv.enumVisibility(field) : undefined) ??
    (sealed ? moduleEnv.sealedVisibility(field) : undefined) ??
    (newtype ? moduleEnv.newtypeVisibility(field) : undefined) ??
    (iface ? moduleEnv.interfaceVisibility(field) : undefined)
  if (!binding && !struct && !enumType && !sealed && !newtype && !iface) {
    throw error(loc, `undefined name \`${field}\` on module \`${moduleName}\``)
  }
  if (env.module !== moduleName && vis !== 'pub') {
    throw error(loc, `\`${field}\` is not exported from \`${moduleName}\``)
  }
  return binding?.type ?? struct ?? enumType ?? sealed ?? newtype ?? iface!
}

function resolveNestedStructLit(
  expr: Extract<Expr, { kind: 'structLit' }>,
  env: TypeEnv,
): { kind: 'struct'; type: Extract<ZeeType, { kind: 'struct' }> } | undefined {
  const parts = [...(expr.qualifier ?? []), expr.name]
  if (parts.length < 2) return undefined
  const firstName = parts[0]!
  const firstNs = env.get(firstName)
  const start =
    firstNs?.kind === 'typeNs' && firstNs.of.kind === 'struct'
      ? firstNs.of
      : env.getStruct(firstName)
  if (!start) return undefined
  let current: ZeeType = { kind: 'typeNs', of: start }
  for (let index = 1; index < parts.length; index += 1) {
    if (current.kind !== 'typeNs') return undefined
    const associated = lookupAssociated(current.of, parts[index]!, env)
    if (!associated) return undefined
    current = associated.type
  }
  if (current.kind === 'typeNs' && current.of.kind === 'struct') {
    return { kind: 'struct', type: current.of }
  }
  if (current.kind === 'struct') return { kind: 'struct', type: current }
  return undefined
}

function resolveStructLit(
  expr: Extract<Expr, { kind: 'structLit' }>,
  env: TypeEnv,
):
  | { kind: 'struct'; type: Extract<ZeeType, { kind: 'struct' }> }
  | { kind: 'sealed'; type: SealedType; variant: SealedVariantType } {
  if (!expr.qualifier || expr.qualifier.length === 0) {
    const struct = env.getStruct(expr.name)
    if (!struct) throw error(expr.loc, `unknown type \`${expr.name}\``)
    return { kind: 'struct', type: struct }
  }
  const nested = resolveNestedStructLit(expr, env)
  if (nested) return nested
  if (expr.qualifier.length === 1) {
    const firstName = expr.qualifier[0]!
    const sealed = env.getSealed(firstName)
    if (sealed) {
      const variant = sealed.variants.find((item) => item.name === expr.name)
      if (!variant) throw error(expr.loc, `unknown variant \`${expr.name}\` on ${sealed.name}`)
      return { kind: 'sealed', type: sealed, variant }
    }
    const first = env.get(firstName)
    if (!first || first.kind !== 'module') {
      throw error(expr.loc, `unknown type \`${[...expr.qualifier, expr.name].join('.')}\``)
    }
    const moduleEnv = env.getModule(first.name)
    if (!moduleEnv) throw error(expr.loc, `unknown module \`${first.name}\``)
    const struct = moduleEnv.getStruct(expr.name)
    const vis = moduleEnv.structVisibility(expr.name)
    if (!struct) throw error(expr.loc, `unknown type \`${first.name}.${expr.name}\``)
    if (env.module !== first.name && vis !== 'pub') {
      throw error(expr.loc, `\`${expr.name}\` is not exported from \`${first.name}\``)
    }
    return { kind: 'struct', type: struct }
  }
  if (expr.qualifier.length === 2) {
    const first = env.get(expr.qualifier[0]!)
    if (!first || first.kind !== 'module') {
      throw error(expr.loc, `unknown type \`${[...expr.qualifier, expr.name].join('.')}\``)
    }
    const moduleEnv = env.getModule(first.name)
    if (!moduleEnv) throw error(expr.loc, `unknown module \`${first.name}\``)
    const sealed = moduleEnv.getSealed(expr.qualifier[1]!)
    const vis = moduleEnv.sealedVisibility(expr.qualifier[1]!)
    if (!sealed) {
      throw error(expr.loc, `unknown type \`${expr.qualifier.join('.')}.${expr.name}\``)
    }
    if (env.module !== first.name && vis !== 'pub') {
      throw error(expr.loc, `\`${expr.qualifier[1]}\` is not exported from \`${first.name}\``)
    }
    const variant = sealed.variants.find((item) => item.name === expr.name)
    if (!variant) throw error(expr.loc, `unknown variant \`${expr.name}\` on ${sealed.name}`)
    return { kind: 'sealed', type: sealed, variant }
  }
  throw error(expr.loc, `unknown type \`${[...expr.qualifier, expr.name].join('.')}\``)
}

function checkVariantVisible(
  variant: SealedVariantType,
  typeModule: string,
  env: TypeEnv,
  loc: { file: string; line: number; column: number },
): void {
  if (variant.visibility === 'pub') return
  if (variant.visibility === 'internal' && env.module === typeModule) return
  if (variant.visibility === 'private' && env.file === variant.file) return
  throw error(loc, `variant \`${variant.name}\` is private`)
}

function checkFieldVisible(
  field: { visibility: Visibility; file: string },
  structModule: string,
  env: TypeEnv,
  loc: { file: string; line: number; column: number },
  name: string,
): void {
  if (field.visibility === 'pub') return
  if (field.visibility === 'internal' && env.module === structModule) return
  if (field.visibility === 'private' && env.file === field.file) return
  throw error(loc, `field \`${name}\` is private`)
}

function blockHasReturn(block: Block): boolean {
  return block.stmts.some(stmtHasReturn)
}

function stmtHasReturn(stmt: Stmt): boolean {
  switch (stmt.kind) {
    case 'return':
      return true
    case 'loop':
      return blockHasReturn(stmt.body)
    case 'forC':
    case 'forForever':
    case 'forRange':
    case 'forIn':
      return blockHasReturn(stmt.body)
    case 'expr':
      return exprHasReturn(stmt.expr)
    default:
      return false
  }
}

function exprHasReturn(expr: Expr): boolean {
  switch (expr.kind) {
    case 'returnExpr':
      return true
    case 'if':
      return blockHasReturn(expr.then) || (expr.else ? blockHasReturn(expr.else) : false)
    case 'block':
      return blockHasReturn(expr.block)
    case 'match':
      return expr.arms.some((arm) => exprHasReturn(arm.body))
    case 'binary':
      return exprHasReturn(expr.left) || exprHasReturn(expr.right)
    case 'index':
      return exprHasReturn(expr.target) || exprHasReturn(expr.index)
    case 'member':
    case 'tupleIndex':
      return exprHasReturn(expr.target)
    case 'arrayLit':
      return expr.items.some(exprHasReturn)
    case 'mapLit':
      return expr.entries.some((entry) => exprHasReturn(entry.key) || exprHasReturn(entry.value))
    case 'structLit':
      return expr.fields.some((field) => exprHasReturn(field.value))
    case 'copy':
      return exprHasReturn(expr.target) || expr.fields.some((field) => exprHasReturn(field.value))
    case 'interp':
      return expr.parts.some((part) => part.kind === 'expr' && exprHasReturn(part.expr))
    default:
      return false
  }
}

function unifyWithNever(a: ZeeType, b: ZeeType): ZeeType | undefined {
  if (isNeverType(a)) return b
  if (isNeverType(b)) return a
  if (typeEq(a, b)) return a
  return undefined
}

function error(loc: { file: string; line: number; column: number }, message: string): ZeeError {
  return new ZeeError(message, loc.line, loc.column, loc.file)
}
