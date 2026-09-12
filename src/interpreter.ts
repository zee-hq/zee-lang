import { isAbsolute, relative, resolve } from 'node:path'
import type { AssignOp, Block, Expr, MatchPattern, Program, Stmt, TypeAst, Visibility } from './ast.ts'
import { PanicError, ZeeError } from './error.ts'
import { hostEnvFor, lookupEnv } from './host-env.ts'
import { isZeeTestFile, MODULES_CONTAINER, TEST_CONTAINER } from './project.ts'
import type { DebugStop } from './debug.ts'
import { decodeJsonToZee, dummyZeeValue, encodeZeeToJson, type JsonTarget } from './json-codec.ts'
import {
  applyCorsHeaders,
  headerGet,
  httpRequestValue,
  httpResponseValue,
  i32ParamFromRequest,
  matchHttpRoute,
  readHttpRequest,
  readHttpResponse,
  resolveCorsAllowOrigin,
  startHttpServer,
  type CorsConfig,
} from './http-host.ts'
import { compileRegex, regexIsMatch } from './regex-host.ts'
import {
  INT_KINDS,
  canWidenInt,
  intBits,
  intFits,
  intSigned,
  isFloatKind,
  isIntKind,
  T_STORED_ATTR,
  T_STORED_FIELD,
  T_STRING,
  type FloatKind,
  type IntKind,
  type ZeeType,
  typeName,
} from './types.ts'

export type ZeeValue =
  | { type: 'i8' | 'i16' | 'i32' | 'u8' | 'u16' | 'u32'; value: number }
  | { type: 'i64' | 'u64' | 'isize' | 'usize'; value: bigint }
  | { type: 'f32' | 'f64'; value: number }
  | { type: 'bool'; value: boolean }
  | { type: 'string'; value: string }
  | { type: 'char'; value: string }
  | { type: 'regex'; source: string; ok: boolean }
  | { type: 'unit' }
  | { type: 'error'; message: string }
  | {
      type: 'newtype'
      name: string
      module: string
      inner: ZeeValue
    }
  | { type: 'newtypeCtor'; name: string; module: string }
  | { type: 'option'; tag: 'none' }
  | { type: 'option'; tag: 'some'; value: ZeeValue }
  | { type: 'tuple'; items: ZeeValue[] }
  | { type: 'array'; items: ZeeValue[]; elem: ZeeType }
  | { type: 'list'; items: ZeeValue[]; elem: ZeeType }
  | {
      type: 'map'
      entries: Map<string, { key: ZeeValue; value: ZeeValue }>
      key: ZeeType
      value: ZeeType
    }
  | {
      type: 'struct'
      name: string
      module: string
      data: boolean
      readonly: boolean
      identity: boolean
      fields: Record<string, ZeeValue>
      fieldMut: Record<string, boolean>
      fieldMeta?: { name: string; attributes?: { name: string; args: string[] }[] }[]
    }
  | {
      type: 'enum'
      name: string
      module: string
      variant: string
      ordinal: number
    }
  | {
      type: 'sealed'
      name: string
      module: string
      variant: string
      data: boolean
      readonly: boolean
      identity: boolean
      fields: Record<string, ZeeValue>
      fieldMut: Record<string, boolean>
    }
  | {
      type: 'typeNs'
      tag: 'enum'
      name: string
      module: string
      variants: string[]
    }
  | {
      type: 'typeNs'
      tag: 'sealed'
      name: string
      module: string
      identity: boolean
      variants: RuntimeSealedVariant[]
    }
  | {
      type: 'typeNs'
      tag: 'struct'
      name: string
      module: string
      members: Record<string, ZeeValue>
    }
  | { type: 'fn'; name: string; params: string[]; body: Block; env: Env; mutatingReceiver: boolean; typeParams?: string[]; attributes?: { name: string; args: string[] }[]; paramMeta?: { name: string; type: TypeAst; attributes?: { name: string; args: string[] }[] }[] }
  | { type: 'closure'; params: string[]; body: Block; env: Env }
  | { type: 'builtin'; name: string }
  | { type: 'module'; name: string; env: Env }
  | { type: 'expect'; value: ZeeValue; negated: boolean }

interface RuntimeSealedVariant {
  name: string
  data: boolean
  readonly: boolean
  fields: { name: string; mutable: boolean }[]
}

interface StructInfo {
  name: string
  module: string
  file: string
  data: boolean
  readonly: boolean
  identity: boolean
  fields: { name: string; mutable: boolean; type?: TypeAst; attributes?: { name: string; args: string[]; argKinds?: ('string' | 'int')[] }[] }[]
  attributes?: { name: string; args: string[] }[]
}

export interface RuntimeIo {
  print: (text: string) => void
  root?: string
  processEnv?: NodeJS.Dict<string>
  readText?: (path: string) => string | undefined
  debug?: { atStmt(event: DebugStop): void }
  /** Filled by the interpreter for the `test` library (`testCases` / `testCall`). */
  test?: { reports: TestReport[] }
}

const TEST_HOOKS = ['beforeAll', 'beforeEach', 'afterEach', 'afterAll'] as const

type TestFn = Extract<ZeeValue, { type: 'fn' }>
type TestHookName = (typeof TEST_HOOKS)[number]
type TestHookSet = Partial<Record<TestHookName, TestFn>>

type TestHost = {
  reports: TestReport[]
  root: string
  cases: {
    file: string
    rel: string
    name: string
    label: string
    suite: string[]
    fn: TestFn
    loc: { file: string; line: number; column: number }
  }[]
  hooks: Map<string, TestHookSet>
  beforeAllError: Map<string, string>
  enteredBeforeAll: Set<string>
  describeStack: string[]
  seqSuite: string[]
}

const testHosts = new WeakMap<RuntimeIo, TestHost>()
const httpDispatchRequests = new WeakMap<RuntimeIo, ZeeValue>()
const jsonTypeSubst: Map<string, JsonTarget>[] = []

const UNIT: ZeeValue = { type: 'unit' }

class ReturnSignal {
  constructor(readonly value: ZeeValue) {}
}

class BreakSignal {}

class ContinueSignal {}

class Env {
  file: string
  module: string
  moduleHome: Env
  defers: Array<() => ZeeValue> | undefined
  frameName: string | undefined
  private modules: Map<string, Env> | undefined
  private readonly structMap = new Map<string, StructInfo>()
  private readonly methodMap = new Map<string, Map<string, Extract<ZeeValue, { type: 'fn' }>>>()

  constructor(
    private readonly parent: Env | undefined,
    private readonly slots = new Map<string, { value: ZeeValue; mutable: boolean; visibility: Visibility }>(),
  ) {
    this.file = parent?.file ?? '<input>'
    this.module = parent?.module ?? ''
    this.moduleHome = parent?.moduleHome ?? this
  }

  attachModules(modules: Map<string, Env>): void {
    this.modules = modules
  }

  getModule(name: string): Env | undefined {
    return this.modules?.get(name) ?? this.parent?.getModule(name)
  }

  listModules(): Env[] {
    const map = this.modules ?? this.parent?.listModuleMap()
    return map ? [...map.values()] : []
  }

  private listModuleMap(): Map<string, Env> | undefined {
    return this.modules ?? this.parent?.listModuleMap()
  }

  ownStructs(): StructInfo[] {
    return [...this.structMap.values()]
  }

  define(name: string, value: ZeeValue, mutable = false, visibility: Visibility = 'private'): void {
    this.slots.set(name, { value, mutable, visibility })
  }

  defineStruct(name: string, info: StructInfo): void {
    this.structMap.set(name, info)
  }

  getStruct(name: string): StructInfo | undefined {
    return this.structMap.get(name) ?? this.parent?.getStruct(name)
  }

  defineMethod(typeName: string, name: string, fn: Extract<ZeeValue, { type: 'fn' }>): void {
    let bucket = this.methodMap.get(typeName)
    if (!bucket) {
      bucket = new Map()
      this.methodMap.set(typeName, bucket)
    }
    bucket.set(name, fn)
  }

  ownMethod(typeName: string, name: string): Extract<ZeeValue, { type: 'fn' }> | undefined {
    return this.methodMap.get(typeName)?.get(name)
  }

  getMethod(typeName: string, name: string): Extract<ZeeValue, { type: 'fn' }> | undefined {
    return this.ownMethod(typeName, name) ?? this.parent?.getMethod(typeName, name)
  }

  methodsOf(typeName: string): Extract<ZeeValue, { type: 'fn' }>[] {
    const own = [...(this.methodMap.get(typeName)?.values() ?? [])]
    const inherited = this.parent?.methodsOf(typeName) ?? []
    const seen = new Set(own.map((item) => item.name))
    return [...own, ...inherited.filter((item) => !seen.has(item.name))]
  }

  own(name: string): { value: ZeeValue; mutable: boolean; visibility: Visibility } | undefined {
    return this.slots.get(name)
  }

  assign(name: string, value: ZeeValue, loc: { file: string; line: number; column: number }): void {
    const slot = this.slots.get(name)
    if (slot) {
      if (!slot.mutable) {
        throw new ZeeError(`cannot assign to const \`${name}\``, loc.line, loc.column, loc.file)
      }
      slot.value = value
      return
    }
    if (this.parent) {
      this.parent.assign(name, value, loc)
      return
    }
    throw new ZeeError(`undefined name \`${name}\``, loc.line, loc.column, loc.file)
  }

  get(name: string, loc: { file: string; line: number; column: number }): ZeeValue {
    const value = this.slots.get(name)?.value ?? this.parent?.getUnchecked(name)
    if (!value) throw new ZeeError(`undefined name \`${name}\``, loc.line, loc.column, loc.file)
    return value
  }

  lookup(name: string): { value: ZeeValue; mutable: boolean } | undefined {
    return this.slots.get(name) ?? this.parent?.lookup(name)
  }

  private getUnchecked(name: string): ZeeValue | undefined {
    return this.slots.get(name)?.value ?? this.parent?.getUnchecked(name)
  }

  child(): Env {
    const env = new Env(this)
    env.file = this.file
    env.module = this.module
    env.moduleHome = this.moduleHome
    return env
  }

  markFunctionFrame(name: string): void {
    this.defers = []
    this.frameName = name
  }

  debugStack(loc: { file: string; line: number; column: number }): DebugStop['stack'] {
    const frames: DebugStop['stack'] = []
    let env: Env | undefined = this
    while (env) {
      if (env.frameName !== undefined) {
        frames.push({
          name: env.frameName,
          file: loc.file,
          line: loc.line,
          column: loc.column,
          variables: [...env.slots.entries()].map(([name, slot]) => ({
            name,
            value: display(slot.value),
          })),
        })
      }
      env = env.parent
    }
    return frames
  }

  functionFrame(): Env | undefined {
    if (this.defers) return this
    return this.parent?.functionFrame()
  }

  pushDefer(thunk: () => ZeeValue, loc: { file: string; line: number; column: number }): void {
    const frame = this.functionFrame()
    if (!frame?.defers) {
      throw new ZeeError('`defer` outside of a function', loc.line, loc.column, loc.file)
    }
    frame.defers.push(thunk)
  }

  root(): Env {
    return this.parent ? this.parent.root() : this
  }
}

export interface TestReport {
  file: string
  name: string
  ok: boolean
  error?: string
}

export interface RunResult {
  value: ZeeValue
  exitCode: number
}

export function interpret(
  program: Program,
  io: RuntimeIo,
  options: { callMain?: boolean; invoke?: { module: string; name: string } } = {},
): RunResult {
  const units = program.units ?? [{ file: program.file, module: '', stmts: program.stmts }]
  const builtins = new Env(undefined)
  builtins.define('print', { type: 'builtin', name: 'print' })
  builtins.define('println', { type: 'builtin', name: 'println' })
  builtins.define('printf', { type: 'builtin', name: 'printf' })
  builtins.define('sprintf', { type: 'builtin', name: 'sprintf' })
  builtins.define('str', { type: 'builtin', name: 'str' })
  builtins.define('error', { type: 'builtin', name: 'error' })
  builtins.define('panic', { type: 'builtin', name: 'panic' })
  builtins.define('getenv', { type: 'builtin', name: 'getenv' })
  builtins.define('envProfile', { type: 'builtin', name: 'envProfile' })
  builtins.define('envAppMeta', { type: 'builtin', name: 'envAppMeta' })
  builtins.define('testCases', { type: 'builtin', name: 'testCases' })
  builtins.define('testCall', { type: 'builtin', name: 'testCall' })
  builtins.define('expect', { type: 'builtin', name: 'expect' })
  builtins.define('describe', { type: 'builtin', name: 'describe' })
  builtins.define('jsonEncode', { type: 'builtin', name: 'jsonEncode' })
  builtins.define('jsonDecode', { type: 'builtin', name: 'jsonDecode' })
  builtins.define('httpDispatch', { type: 'builtin', name: 'httpDispatch' })
  builtins.define('httpListen', { type: 'builtin', name: 'httpListen' })
  builtins.define('httpI32Param', { type: 'builtin', name: 'httpI32Param' })
  builtins.define('httpRouterController', { type: 'builtin', name: 'httpRouterController' })
  builtins.define('httpApp', { type: 'builtin', name: 'httpApp' })
  builtins.define('httpFail', { type: 'builtin', name: 'httpFail' })
  builtins.define('Some', { type: 'builtin', name: 'Some' })
  builtins.define('None', { type: 'option', tag: 'none' })
  builtins.defineStruct('Fail', {
    name: 'Fail',
    module: '',
    file: '<builtin>',
    data: true,
    readonly: false,
    identity: false,
    fields: [{ name: 'text', mutable: false }],
  })

  const moduleIds = [...new Set(units.map((unit) => unit.module))]
  const moduleEnvs = new Map<string, Env>()
  for (const module of moduleIds) {
    const env = builtins.child()
    env.file = `<module:${module || 'root'}>`
    env.module = module
    env.moduleHome = env
    moduleEnvs.set(module, env)
  }
  builtins.attachModules(moduleEnvs)

  const fileEnvs = new Map<string, Env>()
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
      if (stmt.kind === 'fn') {
        const mutatingReceiver = stmt.params[0]?.name === 'self' && stmt.params[0].mutable
        const fn: ZeeValue = {
          type: 'fn',
          name: stmt.name,
          params: stmt.params.map((param) => param.name),
          body: stmt.body,
          env: fileEnv,
          mutatingReceiver,
          typeParams: stmt.typeParams,
          attributes: stmt.attributes,
          paramMeta: runtimeParamMeta(stmt.params),
        }
        const selfAst = stmt.params[0]?.type
        if (stmt.params[0]?.name === 'self' && selfAst?.kind === 'named') {
          fileEnv.defineMethod(selfAst.name, stmt.name, fn)
          if (stmt.visibility !== 'private') {
            fileEnv.moduleHome.defineMethod(selfAst.name, stmt.name, fn)
          }
        } else {
          fileEnv.define(stmt.name, fn, false, stmt.visibility)
          if (stmt.visibility !== 'private') {
            fileEnv.moduleHome.define(stmt.name, fn, false, stmt.visibility)
          }
        }
      } else if (stmt.kind === 'structDecl') {
        if (stmt.sealed) {
          const ns: ZeeValue = {
            type: 'typeNs',
            tag: 'sealed',
            name: stmt.name,
            module: unit.module,
            identity: stmt.identity,
            variants: stmt.variants.map((variant) => ({
              name: variant.name,
              data: variant.data,
              readonly: variant.readonly,
              fields: variant.fields.map((field) => ({ name: field.name, mutable: field.mutable })),
            })),
          }
          fileEnv.define(stmt.name, ns, false, stmt.visibility)
          if (stmt.visibility !== 'private') {
            fileEnv.moduleHome.define(stmt.name, ns, false, stmt.visibility)
          }
        } else {
          registerRuntimeStruct(stmt, fileEnv, unit.module, undefined, io)
        }
      } else if (stmt.kind === 'enumDecl') {
        const ns: ZeeValue = {
          type: 'typeNs',
          tag: 'enum',
          name: stmt.name,
          module: unit.module,
          variants: stmt.variants.map((variant) => variant.name),
        }
        fileEnv.define(stmt.name, ns, false, stmt.visibility)
        if (stmt.visibility !== 'private') {
          fileEnv.moduleHome.define(stmt.name, ns, false, stmt.visibility)
        }
      } else if (stmt.kind === 'newtypeDecl') {
        const ctor: ZeeValue = { type: 'newtypeCtor', name: stmt.name, module: unit.module }
        fileEnv.define(stmt.name, ctor, false, stmt.visibility)
        if (stmt.visibility !== 'private') {
          fileEnv.moduleHome.define(stmt.name, ctor, false, stmt.visibility)
        }
      }
    }
  }

  for (const unit of units) {
    const fileEnv = fileEnvs.get(unit.file)!
    for (const stmt of unit.stmts) {
      if (stmt.kind === 'import') applyRuntimeImport(stmt, fileEnv, moduleEnvs)
    }
  }

  const runtimeDeps = new Map<string, Set<string>>()
  for (const module of moduleIds) runtimeDeps.set(module, new Set())
  for (const unit of units) {
    for (const stmt of unit.stmts) {
      if (stmt.kind !== 'import') continue
      const joined = stmt.path.join('.')
      if (stmt.names || moduleEnvs.has(joined)) {
        if (joined !== unit.module) runtimeDeps.get(unit.module)!.add(joined)
        continue
      }
      if (stmt.path.length >= 2) {
        const parent = stmt.path.slice(0, -1).join('.')
        if (parent !== unit.module) runtimeDeps.get(unit.module)!.add(parent)
      }
    }
  }

  let last: ZeeValue = UNIT
  attachTestHost(io)
  try {
    const bindOrder = runtimeTopoModules(moduleIds, runtimeDeps)
    for (const module of bindOrder) {
      for (const unit of units) {
        if (unit.module !== module) continue
        const fileEnv = fileEnvs.get(unit.file)!
        for (const stmt of unit.stmts) {
          if (stmt.kind === 'import') applyRuntimeImport(stmt, fileEnv, moduleEnvs)
        }
        const host = testHosts.get(io)
        if (host) host.seqSuite = []
        for (const stmt of unit.stmts) {
          if (stmt.kind === 'fn') {
            registerTopLevelTest(stmt, fileEnv, io)
            continue
          }
          if (
            stmt.kind === 'structDecl' ||
            stmt.kind === 'enumDecl' ||
            stmt.kind === 'typeAliasDecl' ||
            stmt.kind === 'newtypeDecl' ||
            stmt.kind === 'interfaceDecl' ||
            stmt.kind === 'import'
          ) {
            continue
          }
          last = execStmt(stmt, fileEnv, io)
        }
      }
    }
  } catch (signal) {
    if (signal instanceof ReturnSignal) {
      throw new ZeeError('`return` outside of a function', 1, 1, program.file)
    }
    if (signal instanceof BreakSignal) {
      throw new ZeeError('`break` outside of a loop', 1, 1, program.file)
    }
    if (signal instanceof ContinueSignal) {
      throw new ZeeError('`continue` outside of a loop', 1, 1, program.file)
    }
    throw signal
  }

  if (options.invoke) {
    const env = options.invoke.module
      ? moduleEnvs.get(options.invoke.module)
      : (fileEnvs.get(program.file) ?? [...fileEnvs.values()].find((item) => item.module === '') ?? builtins)
    const fn = env ? maybeGet(env, options.invoke.name) : undefined
    if (!fn || fn.type !== 'fn') {
      const qualified = options.invoke.module
        ? `${options.invoke.module}.${options.invoke.name}`
        : options.invoke.name
      throw new ZeeError(`undefined \`${qualified}\``, 1, 1, program.file)
    }
    last = callFn(fn, [], io, { file: program.file, line: 1, column: 1 })
    const exitCode = last.type === 'i32' ? last.value : 0
    return { value: last, exitCode }
  }

  const callMain = options.callMain !== false
  const mainEnv =
    fileEnvs.get(program.file) ?? [...fileEnvs.values()].find((env) => env.module === '') ?? builtins
  const main = maybeGet(mainEnv, 'main')
  if (callMain && main?.type === 'fn') {
    last = callFn(main, [], io, { file: program.file, line: 1, column: 1 })
  }

  const exitCode = last.type === 'i32' ? last.value : 0
  return { value: last, exitCode }
}

function applyRuntimeImport(
  stmt: Extract<Stmt, { kind: 'import' }>,
  fileEnv: Env,
  moduleEnvs: Map<string, Env>,
): void {
  const joined = stmt.path.join('.')
  if (stmt.names) {
    const moduleEnv = moduleEnvs.get(joined)
    if (!moduleEnv) return
    for (const item of stmt.names) {
      bindRuntimeName(fileEnv, moduleEnv, item.name, item.alias ?? item.name)
    }
    return
  }
  if (moduleEnvs.has(joined)) {
    const bindAs = stmt.alias ?? stmt.path[stmt.path.length - 1]!
    fileEnv.define(bindAs, { type: 'module', name: joined, env: moduleEnvs.get(joined)! })
    return
  }
  if (stmt.path.length < 2) return
  const parent = stmt.path.slice(0, -1).join('.')
  const name = stmt.path[stmt.path.length - 1]!
  const moduleEnv = moduleEnvs.get(parent)
  if (!moduleEnv) return
  bindRuntimeName(fileEnv, moduleEnv, name, stmt.alias ?? name)
}

function bindRuntimeName(fileEnv: Env, moduleEnv: Env, name: string, bindAs: string): void {
  const slot = moduleEnv.own(name)
  if (slot) fileEnv.define(bindAs, slot.value, slot.mutable, 'pub')
  const info = moduleEnv.getStruct(name)
  if (info) fileEnv.defineStruct(bindAs, info)
}

function runtimeTopoModules(moduleIds: string[], deps: Map<string, Set<string>>): string[] {
  const indegree = new Map<string, number>()
  const importers = new Map<string, string[]>()
  for (const id of moduleIds) {
    indegree.set(id, 0)
    importers.set(id, [])
  }
  for (const [importer, targets] of deps) {
    for (const target of targets) {
      if (target === importer || !indegree.has(target)) continue
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

function registerRuntimeStruct(
  stmt: Extract<Stmt, { kind: 'structDecl' }>,
  fileEnv: Env,
  unitModule: string,
  owner: string | undefined,
  io: RuntimeIo,
): Extract<ZeeValue, { type: 'typeNs'; tag: 'struct' }> {
  const name = owner ? `${owner}.${stmt.name}` : stmt.name
  const info: StructInfo = {
    name,
    module: unitModule,
    file: fileEnv.file,
    data: stmt.data,
    readonly: stmt.readonly,
    identity: stmt.identity,
    fields: stmt.fields.map((field) => ({
      name: field.name,
      mutable: field.mutable,
      type: field.type,
      attributes: field.attributes,
    })),
    attributes: stmt.attributes,
  }
  fileEnv.defineStruct(name, info)
  if (stmt.visibility !== 'private') {
    fileEnv.moduleHome.defineStruct(name, info)
  }
  const members: Record<string, ZeeValue> = {}
  const ns: Extract<ZeeValue, { type: 'typeNs'; tag: 'struct' }> = {
    type: 'typeNs',
    tag: 'struct',
    name: stmt.name,
    module: unitModule,
    members,
  }
  if (!owner) {
    fileEnv.define(stmt.name, ns, false, stmt.visibility)
    if (stmt.visibility !== 'private') {
      fileEnv.moduleHome.define(stmt.name, ns, false, stmt.visibility)
    }
  }
  for (const nested of stmt.nested) {
    if (nested.kind === 'structDecl' && !nested.sealed) {
      members[nested.name] = registerRuntimeStruct(nested, fileEnv, unitModule, name, io)
    } else if (nested.kind === 'enumDecl') {
      members[nested.name] = {
        type: 'typeNs',
        tag: 'enum',
        name: nested.name,
        module: unitModule,
        variants: nested.variants.map((variant) => variant.name),
      }
    }
  }
  for (const item of stmt.associated) {
    members[item.name] = copyValue(evalExpr(item.init, fileEnv, io))
  }
  for (const method of stmt.methods) {
    const mutatingReceiver = method.params[0]?.name === 'self' && method.params[0].mutable
    const fn: Extract<ZeeValue, { type: 'fn' }> = {
      type: 'fn',
      name: method.name,
      params: method.params.map((param) => param.name),
      body: method.body,
      env: fileEnv,
      mutatingReceiver,
      typeParams: method.typeParams,
      attributes: method.attributes,
      paramMeta: runtimeParamMeta(method.params),
    }
    if (method.params[0]?.name === 'self') {
      fileEnv.defineMethod(name, method.name, fn)
      if (method.visibility !== 'private') {
        fileEnv.moduleHome.defineMethod(name, method.name, fn)
      }
    } else {
      members[method.name] = fn
    }
  }
  return ns
}

function maybeGet(env: Env, name: string): ZeeValue | undefined {
  try {
    return env.get(name, { file: '<runtime>', line: 1, column: 1 })
  } catch {
    return undefined
  }
}

function execStmt(stmt: Stmt, env: Env, io: RuntimeIo): ZeeValue {
  io.debug?.atStmt({
    file: stmt.loc.file,
    line: stmt.loc.line,
    column: stmt.loc.column,
    stack: env.debugStack(stmt.loc),
  })
  switch (stmt.kind) {
    case 'bind': {
      const value = copyValue(evalExpr(stmt.init, env, io))
      env.define(stmt.name, value, stmt.mutable, stmt.visibility)
      if (stmt.visibility !== 'private') {
        env.moduleHome.define(stmt.name, value, stmt.mutable, stmt.visibility)
      }
      return UNIT
    }
    case 'destructure': {
      const value = evalExpr(stmt.init, env, io)
      if (value.type !== 'tuple') {
        throw new ZeeError('cannot destructure this value', stmt.init.loc.line, stmt.init.loc.column, stmt.init.loc.file)
      }
      if (value.items.length !== stmt.names.length) {
        throw new ZeeError(
          `destructure expected ${stmt.names.length} value(s), got ${value.items.length}`,
          stmt.loc.line,
          stmt.loc.column,
          stmt.loc.file,
        )
      }
      stmt.names.forEach((name, index) => {
        if (name === '_') return
        env.define(name, copyValue(value.items[index]!), stmt.mutable)
      })
      return UNIT
    }
    case 'assign':
      return execAssign(stmt, env, io)
    case 'indexAssign':
      return execIndexAssign(stmt, env, io)
    case 'fieldAssign':
      return execFieldAssign(stmt, env, io)
    case 'redim': {
      const current = env.get(stmt.name, stmt.loc)
      const target = intKindFromTypeAst(stmt.type)
      if (!isIntValue(current)) {
        throw new ZeeError('`redim` expects an integer', stmt.loc.line, stmt.loc.column, stmt.loc.file)
      }
      env.assign(stmt.name, intValue(target, intBigInt(current)), stmt.loc)
      return UNIT
    }
    case 'redimArray':
      return execRedimArray(stmt, env, io)
    case 'return':
      throw new ReturnSignal(stmt.expr ? evalExpr(stmt.expr, env, io) : UNIT)
    case 'loop':
      return execLoop(stmt, env, io)
    case 'forC':
      return execForC(stmt, env, io)
    case 'forForever':
      return execForForever(stmt, env, io)
    case 'forRange':
      return execForRange(stmt, env, io)
    case 'forIn':
      return execForIn(stmt, env, io)
    case 'break':
      throw new BreakSignal()
    case 'continue':
      throw new ContinueSignal()
    case 'defer':
      return execDefer(stmt, env, io)
    case 'fn':
      return defineDescribeFn(stmt, env, io)
    case 'structDecl':
      throw new ZeeError('nested structs are not supported yet', stmt.loc.line, stmt.loc.column, stmt.loc.file)
    case 'enumDecl':
      throw new ZeeError('nested enums are not supported yet', stmt.loc.line, stmt.loc.column, stmt.loc.file)
    case 'typeAliasDecl':
      throw new ZeeError('nested type aliases are not supported yet', stmt.loc.line, stmt.loc.column, stmt.loc.file)
    case 'newtypeDecl':
      throw new ZeeError('nested newtypes are not supported yet', stmt.loc.line, stmt.loc.column, stmt.loc.file)
    case 'interfaceDecl':
      throw new ZeeError('nested interfaces are not supported yet', stmt.loc.line, stmt.loc.column, stmt.loc.file)
    case 'import':
      return UNIT
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
  if (
    lastStmt?.kind === 'bind' ||
    lastStmt?.kind === 'assign' ||
    lastStmt?.kind === 'indexAssign' ||
    lastStmt?.kind === 'fieldAssign' ||
    lastStmt?.kind === 'redim' ||
    lastStmt?.kind === 'redimArray' ||
    lastStmt?.kind === 'destructure' ||
    lastStmt?.kind === 'loop' ||
    lastStmt?.kind === 'forC' ||
    lastStmt?.kind === 'forForever' ||
    lastStmt?.kind === 'forRange' ||
    lastStmt?.kind === 'forIn' ||
    lastStmt?.kind === 'break' ||
    lastStmt?.kind === 'continue' ||
    lastStmt?.kind === 'defer'
  ) {
    return UNIT
  }
  return last
}

function runLoopBody(body: Block, env: Env, io: RuntimeIo): 'break' | 'ok' {
  try {
    execBlock(body, env, io)
    return 'ok'
  } catch (signal) {
    if (signal instanceof ContinueSignal) return 'ok'
    if (signal instanceof BreakSignal) return 'break'
    throw signal
  }
}

function execLoop(stmt: Extract<Stmt, { kind: 'loop' }>, env: Env, io: RuntimeIo): ZeeValue {
  const post = stmt.mode === 'do-while' || stmt.mode === 'do-until'
  const invert = stmt.mode === 'until' || stmt.mode === 'do-until'
  const condTrue = (): boolean => {
    const value = evalExpr(stmt.cond, env, io)
    if (value.type !== 'bool') {
      throw new ZeeError('loop condition must be bool', stmt.cond.loc.line, stmt.cond.loc.column, stmt.cond.loc.file)
    }
    return invert ? !value.value : value.value
  }
  if (post) {
    do {
      if (runLoopBody(stmt.body, env, io) === 'break') break
    } while (condTrue())
  } else {
    while (condTrue()) {
      if (runLoopBody(stmt.body, env, io) === 'break') break
    }
  }
  return UNIT
}

function execForC(stmt: Extract<Stmt, { kind: 'forC' }>, env: Env, io: RuntimeIo): ZeeValue {
  const local = env.child()
  if (stmt.init) execStmt(stmt.init, local, io)
  const condTrue = (): boolean => {
    if (!stmt.cond) return true
    const value = evalExpr(stmt.cond, local, io)
    if (value.type !== 'bool') {
      throw new ZeeError('loop condition must be bool', stmt.cond.loc.line, stmt.cond.loc.column, stmt.cond.loc.file)
    }
    return value.value
  }
  while (condTrue()) {
    if (runLoopBody(stmt.body, local, io) === 'break') break
    if (stmt.step) execStmt(stmt.step, local, io)
  }
  return UNIT
}

function execForForever(stmt: Extract<Stmt, { kind: 'forForever' }>, env: Env, io: RuntimeIo): ZeeValue {
  while (true) {
    if (runLoopBody(stmt.body, env, io) === 'break') break
  }
  return UNIT
}

function execForRange(stmt: Extract<Stmt, { kind: 'forRange' }>, env: Env, io: RuntimeIo): ZeeValue {
  const start = evalExpr(stmt.start, env, io)
  const end = evalExpr(stmt.end, env, io)
  if (!isIntValue(start) || !isIntValue(end) || start.type !== end.type) {
    throw new ZeeError('range bounds must be integers of the same type', stmt.loc.line, stmt.loc.column, stmt.loc.file)
  }
  const local = env.child()
  local.define(stmt.name, start, true)
  while (intBigInt(local.get(stmt.name, stmt.loc) as Extract<ZeeValue, { type: IntKind }>) < intBigInt(end)) {
    if (runLoopBody(stmt.body, local, io) === 'break') break
    const current = local.get(stmt.name, stmt.loc)
    if (!isIntValue(current)) {
      throw new ZeeError('range index must stay an integer', stmt.loc.line, stmt.loc.column, stmt.loc.file)
    }
    local.assign(stmt.name, intChecked(current.type, intBigInt(current) + 1n, stmt.loc), stmt.loc)
  }
  return UNIT
}

function execForIn(stmt: Extract<Stmt, { kind: 'forIn' }>, env: Env, io: RuntimeIo): ZeeValue {
  const seq = evalExpr(stmt.seq, env, io)
  if (seq.type === 'map') {
    if (!stmt.indexName) {
      throw new ZeeError('for-in on Map needs `(k, v)`', stmt.seq.loc.line, stmt.seq.loc.column, stmt.seq.loc.file)
    }
    for (const entry of seq.entries.values()) {
      const local = env.child()
      local.define(stmt.indexName, copyValue(entry.key), false)
      local.define(stmt.name, copyValue(entry.value), false)
      if (runLoopBody(stmt.body, local, io) === 'break') break
    }
    return UNIT
  }
  if (seq.type === 'string') {
    let i = 0
    for (const scalar of seq.value) {
      const local = env.child()
      if (stmt.indexName) {
        local.define(stmt.indexName, intValue('usize', BigInt(i)), false)
      }
      local.define(stmt.name, { type: 'char', value: scalar }, false)
      if (runLoopBody(stmt.body, local, io) === 'break') break
      i += 1
    }
    return UNIT
  }
  if (seq.type !== 'array' && seq.type !== 'list') {
    throw new ZeeError('for-in expects an array, List, or String', stmt.seq.loc.line, stmt.seq.loc.column, stmt.seq.loc.file)
  }
  for (let i = 0; i < seq.items.length; i += 1) {
    const local = env.child()
    if (stmt.indexName) {
      local.define(stmt.indexName, intValue('usize', BigInt(i)), false)
    }
    local.define(stmt.name, copyValue(seq.items[i]!), false)
    if (runLoopBody(stmt.body, local, io) === 'break') break
  }
  return UNIT
}

function evalExpr(expr: Expr, env: Env, io: RuntimeIo): ZeeValue {
  switch (expr.kind) {
    case 'int':
      return intValue(expr.suffix ?? 'i32', expr.value)
    case 'float':
      return floatValue(expr.suffix ?? 'f64', expr.value)
    case 'bool':
      return { type: 'bool', value: expr.value }
    case 'string':
      return { type: 'string', value: expr.value }
    case 'char':
      return { type: 'char', value: expr.value }
    case 'interp': {
      let text = ''
      for (const part of expr.parts) {
        if (part.kind === 'text') {
          text += part.value
          continue
        }
        text += interpolateValue(evalExpr(part.expr, env, io), part.expr.loc)
      }
      return { type: 'string', value: text }
    }
    case 'unit':
      return UNIT
    case 'ident':
      return env.get(expr.name, expr.loc)
    case 'unary': {
      const inner = evalExpr(expr.expr, env, io)
      if (expr.op === '-' && isIntValue(inner)) {
        return intChecked(inner.type, -intBigInt(inner), expr.loc)
      }
      if (expr.op === '-' && isFloatValue(inner)) {
        return floatValue(inner.type, -inner.value)
      }
      if (expr.op === '!' && inner.type === 'bool') return { type: 'bool', value: !inner.value }
      if (expr.op === '~' && isIntValue(inner)) {
        return intWrap(inner.type, ~intBigInt(inner))
      }
      throw new ZeeError('invalid unary operand', expr.loc.line, expr.loc.column, expr.loc.file)
    }
    case 'binary':
      return evalBinary(expr, env, io)
    case 'call':
      return evalCall(expr, env, io)
    case 'tuple':
      return { type: 'tuple', items: expr.items.map((item) => copyValue(evalExpr(item, env, io))) }
    case 'tupleIndex': {
      const target = evalExpr(expr.target, env, io)
      if (target.type !== 'tuple') {
        throw new ZeeError('tuple index requires a tuple', expr.loc.line, expr.loc.column, expr.loc.file)
      }
      const item = target.items[expr.index]
      if (item === undefined) {
        throw new ZeeError(
          `tuple index ${expr.index} is out of range`,
          expr.loc.line,
          expr.loc.column,
          expr.loc.file,
        )
      }
      return copyValue(item)
    }
    case 'index':
      return evalIndex(expr, env, io)
    case 'member':
      return evalMember(expr, env, io)
    case 'arrayLit': {
      const items = expr.items.map((item) => copyValue(evalExpr(item, env, io)))
      const elem = expr.elemType ?? (items[0] ? typeOfValue(items[0]) : undefined)
      if (!elem) {
        throw new ZeeError('empty array needs a type', expr.loc.line, expr.loc.column, expr.loc.file)
      }
      if (expr.asList) return { type: 'list', items, elem }
      return { type: 'array', items, elem }
    }
    case 'mapLit':
      return evalMapLit(expr, env, io)
    case 'structLit':
      return evalStructLit(expr, env, io)
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
      if (expr.lambdaParams) {
        return { type: 'closure', params: expr.lambdaParams, body: expr.block, env }
      }
      if (expr.mapType) {
        return {
          type: 'map',
          entries: new Map(),
          key: expr.mapType.key,
          value: expr.mapType.value,
        }
      }
      return execBlock(expr.block, env, io)
    case 'lambda':
      return { type: 'closure', params: expr.params, body: expr.body, env }
    case 'match': {
      const value = evalExpr(expr.scrutinee, env, io)
      for (const arm of expr.arms) {
        for (const pattern of arm.patterns) {
          const local = env.child()
          if (matchPattern(pattern, value, env, io, local)) {
            return evalExpr(arm.body, local, io)
          }
        }
      }
      throw new ZeeError('match is not exhaustive', expr.loc.line, expr.loc.column, expr.loc.file)
    }
    case 'copy':
      return evalCopy(expr, env, io)
    case 'returnExpr':
      throw new ReturnSignal(expr.expr ? evalExpr(expr.expr, env, io) : UNIT)
    case 'isType': {
      const value = evalExpr(expr.expr, env, io)
      const name = expr.type.kind === 'named' ? expr.type.name : undefined
      if (!name) return { type: 'bool', value: false }
      if (value.type === 'error') return { type: 'bool', value: name === 'Fail' }
      if (value.type === 'struct' || value.type === 'enum' || value.type === 'sealed' || value.type === 'newtype') {
        return { type: 'bool', value: value.name === name }
      }
      return { type: 'bool', value: false }
    }
  }
}

function execAssign(
  stmt: Extract<Stmt, { kind: 'assign' }>,
  env: Env,
  io: RuntimeIo,
): ZeeValue {
  if (stmt.op === '=') {
    env.assign(stmt.name, copyValue(evalExpr(stmt.value, env, io)), stmt.loc)
    return UNIT
  }
  const current = env.get(stmt.name, stmt.loc)
  if (stmt.op === '??=') {
    if (current.type === 'option' && current.tag === 'none') {
      env.assign(stmt.name, { type: 'option', tag: 'some', value: evalExpr(stmt.value, env, io) }, stmt.loc)
    }
    return UNIT
  }
  if (stmt.op === '!!=') {
    if (current.type === 'option' && current.tag === 'some') {
      env.assign(stmt.name, { type: 'option', tag: 'some', value: evalExpr(stmt.value, env, io) }, stmt.loc)
    }
    return UNIT
  }
  if (stmt.op === '&&=' || stmt.op === '||=') {
    if (current.type !== 'bool') {
      throw new ZeeError(`\`${stmt.op}\` requires bool`, stmt.loc.line, stmt.loc.column, stmt.loc.file)
    }
    const skip = stmt.op === '&&=' ? !current.value : current.value
    if (!skip) {
      const right = evalExpr(stmt.value, env, io)
      if (right.type !== 'bool') {
        throw new ZeeError(`\`${stmt.op}\` requires bool`, stmt.loc.line, stmt.loc.column, stmt.loc.file)
      }
      env.assign(stmt.name, right, stmt.loc)
    }
    return UNIT
  }
  const right = evalExpr(stmt.value, env, io)
  env.assign(stmt.name, applyCompound(stmt.op, current, right, stmt.loc), stmt.loc)
  return UNIT
}

function applyCompound(
  op: AssignOp,
  left: ZeeValue,
  right: ZeeValue,
  loc: { file: string; line: number; column: number },
): ZeeValue {
  if (op === '+=' && left.type === 'string' && right.type === 'string') {
    return { type: 'string', value: left.value + right.value }
  }
  if ((op === '<<=' || op === '>>=') && isIntValue(left) && isIntValue(right)) {
    const kind = left.type
    const l = intBigInt(left)
    const amount = shiftAmount(kind, right, loc, false)
    if (op === '<<=') return intChecked(kind, l << amount, loc)
    return intValue(kind, l >> amount)
  }
  if (isIntValue(left) && isIntValue(right) && left.type === right.type) {
    const kind = left.type
    const l = intBigInt(left)
    const r = intBigInt(right)
    switch (op) {
      case '+=':
        return intChecked(kind, l + r, loc)
      case '-=':
        return intChecked(kind, l - r, loc)
      case '*=':
        return intChecked(kind, l * r, loc)
      case '/=':
        if (r === 0n) {
          throw new ZeeError('division by zero', loc.line, loc.column, loc.file)
        }
        return intValue(kind, l / r)
      case '%=':
        if (r === 0n) {
          throw new ZeeError('division by zero', loc.line, loc.column, loc.file)
        }
        return intValue(kind, l % r)
      case '&=':
        return intValue(kind, l & r)
      case '|=':
        return intValue(kind, l | r)
      case '^=':
        return intValue(kind, l ^ r)
    }
  }
  if (isFloatValue(left) && isFloatValue(right) && left.type === right.type) {
    const kind = left.type
    const l = left.value
    const r = right.value
    switch (op) {
      case '+=':
        return floatValue(kind, l + r)
      case '-=':
        return floatValue(kind, l - r)
      case '*=':
        return floatValue(kind, l * r)
      case '/=':
        return floatValue(kind, l / r)
      case '%=':
        return floatValue(kind, l % r)
    }
  }
  throw new ZeeError(
    `operator \`${op}\` is not defined for these values`,
    loc.line,
    loc.column,
    loc.file,
  )
}

function execIndexAssign(
  stmt: Extract<Stmt, { kind: 'indexAssign' }>,
  env: Env,
  io: RuntimeIo,
): ZeeValue {
  if (stmt.target.kind === 'ident') {
    const slot = env.lookup(stmt.target.name)
    if (slot && !slot.mutable) {
      throw new ZeeError(
        `cannot assign to const \`${stmt.target.name}\``,
        stmt.loc.line,
        stmt.loc.column,
        stmt.loc.file,
      )
    }
  }
  const target = evalExpr(stmt.target, env, io)
  if (target.type === 'map') {
    const key = evalExpr(stmt.index, env, io)
    const hashed = mapHashKey(key, stmt.loc)
    const right = evalExpr(stmt.value, env, io)
    const current = target.entries.get(hashed)?.value
    const next =
      stmt.op === '=' || !current
        ? copyValue(right)
        : applyCompound(stmt.op, current, right, stmt.loc)
    target.entries.set(hashed, { key: copyValue(key), value: next })
    return UNIT
  }
  if (target.type !== 'array') {
    throw new ZeeError('index assign requires an array', stmt.loc.line, stmt.loc.column, stmt.loc.file)
  }
  const i = indexNumber(evalExpr(stmt.index, env, io), stmt.loc)
  if (i < 0 || i >= target.items.length) {
    throw new ZeeError('index out of bounds', stmt.loc.line, stmt.loc.column, stmt.loc.file)
  }
  const current = target.items[i]!
  const right = evalExpr(stmt.value, env, io)
  target.items[i] = stmt.op === '=' ? copyValue(right) : applyCompound(stmt.op, current, right, stmt.loc)
  return UNIT
}

function execFieldAssign(
  stmt: Extract<Stmt, { kind: 'fieldAssign' }>,
  env: Env,
  io: RuntimeIo,
): ZeeValue {
  if (stmt.target.kind === 'ident') {
    const slot = env.lookup(stmt.target.name)
    if (slot && !slot.mutable) {
      throw new ZeeError(
        `cannot assign to const \`${stmt.target.name}\``,
        stmt.loc.line,
        stmt.loc.column,
        stmt.loc.file,
      )
    }
  }
  const target = evalExpr(stmt.target, env, io)
  if (target.type !== 'struct') {
    throw new ZeeError('field assign requires a struct or class', stmt.loc.line, stmt.loc.column, stmt.loc.file)
  }
  if (target.readonly) {
    throw new ZeeError(
      `cannot assign to field \`${stmt.field}\` on readonly type \`${target.name}\``,
      stmt.loc.line,
      stmt.loc.column,
      stmt.loc.file,
    )
  }
  if (!target.fieldMut[stmt.field]) {
    throw new ZeeError(
      `cannot assign to const field \`${stmt.field}\``,
      stmt.loc.line,
      stmt.loc.column,
      stmt.loc.file,
    )
  }
  target.fields[stmt.field] = stmt.op === '='
    ? copyValue(evalExpr(stmt.value, env, io))
    : applyCompound(stmt.op, target.fields[stmt.field]!, evalExpr(stmt.value, env, io), stmt.loc)
  return UNIT
}

function execRedimArray(
  stmt: Extract<Stmt, { kind: 'redimArray' }>,
  env: Env,
  io: RuntimeIo,
): ZeeValue {
  const slot = env.lookup(stmt.name)
  if (slot && !slot.mutable) {
    throw new ZeeError(`cannot redim const \`${stmt.name}\``, stmt.loc.line, stmt.loc.column, stmt.loc.file)
  }
  const current = env.get(stmt.name, stmt.loc)
  if (current.type === 'list' || current.type === 'map') {
    throw new ZeeError(
      `cannot redim ${current.type === 'list' ? 'List' : 'Map'}`,
      stmt.loc.line,
      stmt.loc.column,
      stmt.loc.file,
    )
  }
  if (current.type !== 'array') {
    throw new ZeeError('array `redim` requires an array', stmt.loc.line, stmt.loc.column, stmt.loc.file)
  }
  const n = indexNumber(evalExpr(stmt.length, env, io), stmt.loc)
  if (n < current.items.length) {
    current.items.length = n
    return UNIT
  }
  if (stmt.preserve) {
    while (current.items.length < n) {
      current.items.push(zeroValue(current.elem, stmt.loc))
    }
    return UNIT
  }
  current.items.length = 0
  for (let i = 0; i < n; i += 1) {
    current.items.push(zeroValue(current.elem, stmt.loc))
  }
  return UNIT
}

function evalIndex(expr: Extract<Expr, { kind: 'index' }>, env: Env, io: RuntimeIo): ZeeValue {
  const target = evalExpr(expr.target, env, io)
  if (target.type === 'map') {
    const hashed = mapHashKey(evalExpr(expr.index, env, io), expr.loc)
    const entry = target.entries.get(hashed)
    if (!entry) return { type: 'option', tag: 'none' }
    return { type: 'option', tag: 'some', value: copyValue(entry.value) }
  }
  const i = indexNumber(evalExpr(expr.index, env, io), expr.loc)
  if (target.type === 'array' || target.type === 'list') {
    const item = target.items[i]
    if (item === undefined) {
      throw new ZeeError('index out of bounds', expr.loc.line, expr.loc.column, expr.loc.file)
    }
    return copyValue(item)
  }
  if (target.type === 'string') {
    const bytes = new TextEncoder().encode(target.value)
    const byte = bytes[i]
    if (byte === undefined) {
      throw new ZeeError('index out of bounds', expr.loc.line, expr.loc.column, expr.loc.file)
    }
    return intValue('u8', BigInt(byte))
  }
  throw new ZeeError('index requires an array, List, Map, or String', expr.loc.line, expr.loc.column, expr.loc.file)
}

function evalMapLit(expr: Extract<Expr, { kind: 'mapLit' }>, env: Env, io: RuntimeIo): ZeeValue {
  const entries = new Map<string, { key: ZeeValue; value: ZeeValue }>()
  for (const entry of expr.entries) {
    const key = evalExpr(entry.key, env, io)
    const hashed = mapHashKey(key, expr.loc)
    entries.set(hashed, {
      key: copyValue(key),
      value: copyValue(evalExpr(entry.value, env, io)),
    })
  }
  const key = expr.keyType
  const value = expr.valueType
  if (!key || !value) {
    throw new ZeeError('empty `{}` needs a type', expr.loc.line, expr.loc.column, expr.loc.file)
  }
  return { type: 'map', entries, key, value }
}

function mapHashKey(
  value: ZeeValue,
  loc: { file: string; line: number; column: number },
): string {
  if (value.type === 'newtype') {
    return `nt:${value.module}:${value.name}:${mapHashKey(value.inner, loc)}`
  }
  if (isIntValue(value)) return `int:${value.type}:${intBigInt(value)}`
  if (value.type === 'bool') return `bool:${value.value}`
  if (value.type === 'string') return `str:${JSON.stringify(value.value)}`
  if (value.type === 'char') return `char:${JSON.stringify(value.value)}`
  if (value.type === 'enum') return `enum:${value.module}:${value.name}:${value.variant}`
  throw new ZeeError('Map key type is not Hash', loc.line, loc.column, loc.file)
}

function callCollectionMethod(
  target: ZeeValue,
  name: string,
  args: ZeeValue[],
  io: RuntimeIo,
  loc: { file: string; line: number; column: number },
  env: Env,
): ZeeValue | undefined {
  if (name === 'fields') {
    if (args.length !== 0) {
      throw new ZeeError('`fields` takes no arguments', loc.line, loc.column, loc.file)
    }
    return reflectFields(target, env)
  }
  if (name === 'isEmpty' || name === 'isNotEmpty') {
    const empty = collectionEmpty(target)
    if (empty !== undefined) {
      if (args.length !== 0) {
        throw new ZeeError(`\`${name}\` takes no arguments`, loc.line, loc.column, loc.file)
      }
      return { type: 'bool', value: name === 'isEmpty' ? empty : !empty }
    }
  }
  if (name === 'isBlank' || name === 'isNotBlank') {
    if (target.type === 'string') {
      if (args.length !== 0) {
        throw new ZeeError(`\`${name}\` takes no arguments`, loc.line, loc.column, loc.file)
      }
      const blank = isBlankString(target.value)
      return { type: 'bool', value: name === 'isBlank' ? blank : !blank }
    }
    if (target.type === 'list' || target.type === 'array' || target.type === 'map') {
      throw new ZeeError(`\`${name}\` is only on String`, loc.line, loc.column, loc.file)
    }
  }
  if (target.type === 'regex' && name === 'isMatch') {
    if (args.length !== 1) {
      throw new ZeeError('`isMatch` takes one argument', loc.line, loc.column, loc.file)
    }
    const text = args[0]!
    if (text.type !== 'string') {
      throw new ZeeError('`isMatch` expects a String', loc.line, loc.column, loc.file)
    }
    if (!target.ok) return { type: 'bool', value: false }
    return { type: 'bool', value: regexIsMatch(compileRegex(target.source), text.value) }
  }
  if (target.type === 'option') {
    if (name === 'isNone' || name === 'isSome') {
      if (args.length !== 0) {
        throw new ZeeError(`\`${name}\` takes no arguments`, loc.line, loc.column, loc.file)
      }
      const none = target.tag === 'none'
      return { type: 'bool', value: name === 'isNone' ? none : !none }
    }
    if (name === 'isNoneOrEmpty') {
      if (args.length !== 0) {
        throw new ZeeError('`isNoneOrEmpty` takes no arguments', loc.line, loc.column, loc.file)
      }
      if (target.tag === 'none') return { type: 'bool', value: true }
      const empty = collectionEmpty(target.value)
      if (empty === undefined) {
        throw new ZeeError(
          '`isNoneOrEmpty` is only on `Option<String>`, `Option<List<T>>`, `Option<T[]>`, or `Option<Map<K, V>>`',
          loc.line,
          loc.column,
          loc.file,
        )
      }
      return { type: 'bool', value: empty }
    }
    if (name === 'isNoneOrBlank') {
      if (args.length !== 0) {
        throw new ZeeError('`isNoneOrBlank` takes no arguments', loc.line, loc.column, loc.file)
      }
      if (target.tag === 'none') return { type: 'bool', value: true }
      if (target.value.type !== 'string') {
        throw new ZeeError('`isNoneOrBlank` is only on `Option<String>`', loc.line, loc.column, loc.file)
      }
      return { type: 'bool', value: isBlankString(target.value.value) }
    }
  }
  if (name === 'toString') {
    if (target.type === 'list' || target.type === 'array' || target.type === 'map') {
      if (args.length !== 0) {
        throw new ZeeError('`toString` takes no arguments', loc.line, loc.column, loc.file)
      }
      return { type: 'string', value: display(target) }
    }
  }
  if (target.type === 'list' || target.type === 'array') {
    const seq = callSeqMethod(target, name, args, io, loc)
    if (seq) return seq
  }
  if (target.type === 'map') {
    const mapped = callMapMethod(target, name, args, io, loc)
    if (mapped) return mapped
  }
  if (target.type === 'list') {
    if (name === 'toArray') {
      return { type: 'array', items: target.items.map(copyValue), elem: target.elem }
    }
    if (name === 'sort') {
      if (args.length !== 0 && args.length !== 1) {
        throw new ZeeError(
          '`sort` takes no arguments or a `(T, T) -> i32` comparator',
          loc.line,
          loc.column,
          loc.file,
        )
      }
      const items = target.items.map(copyValue)
      if (args.length === 0) {
        items.sort((left, right) => compareOrd(left, right, loc))
      } else {
        items.sort((left, right) => {
          const out = applyFnValue(args[0]!, [left, right], io, loc)
          if (out.type !== 'i32') {
            throw new ZeeError('`sort` comparator must return `i32`', loc.line, loc.column, loc.file)
          }
          return Number(out.value)
        })
      }
      return { type: 'list', items, elem: target.elem }
    }
    if (name === 'sortBy' || name === 'sortByDescending') {
      if (args.length !== 1) {
        throw new ZeeError(`\`${name}\` takes one function`, loc.line, loc.column, loc.file)
      }
      const decorated = target.items.map((item) => ({
        item: copyValue(item),
        key: applyFnValue(args[0]!, [item], io, loc),
      }))
      decorated.sort((left, right) =>
        name === 'sortByDescending'
          ? compareOrd(right.key, left.key, loc)
          : compareOrd(left.key, right.key, loc),
      )
      return { type: 'list', items: decorated.map((row) => row.item), elem: target.elem }
    }
    if (name === 'push' || name === 'pop' || name === 'fill') {
      throw new ZeeError(`\`${name}\` is \`T[]\`; List is immutable`, loc.line, loc.column, loc.file)
    }
  }
  if (target.type === 'array') {
    if (name === 'toList') {
      return { type: 'list', items: target.items.map(copyValue), elem: target.elem }
    }
    if (name === 'push') {
      if (args.length !== 1) {
        throw new ZeeError('`push` takes one argument', loc.line, loc.column, loc.file)
      }
      target.items.push(copyValue(args[0]!))
      return UNIT
    }
    if (name === 'pop') {
      if (args.length !== 0) {
        throw new ZeeError('`pop` takes no arguments', loc.line, loc.column, loc.file)
      }
      const item = target.items.pop()
      if (item === undefined) return { type: 'option', tag: 'none' }
      return { type: 'option', tag: 'some', value: item }
    }
    if (name === 'fill') {
      if (args.length !== 1) {
        throw new ZeeError('`fill` takes one argument', loc.line, loc.column, loc.file)
      }
      for (let i = 0; i < target.items.length; i += 1) {
        target.items[i] = copyValue(args[0]!)
      }
      return UNIT
    }
    if (name === 'sort') {
      if (args.length !== 0 && args.length !== 1) {
        throw new ZeeError(
          '`sort` takes no arguments or a `(T, T) -> i32` comparator',
          loc.line,
          loc.column,
          loc.file,
        )
      }
      if (args.length === 0) {
        target.items.sort((left, right) => compareOrd(left, right, loc))
      } else {
        target.items.sort((left, right) => {
          const out = applyFnValue(args[0]!, [left, right], io, loc)
          if (out.type !== 'i32') {
            throw new ZeeError('`sort` comparator must return `i32`', loc.line, loc.column, loc.file)
          }
          return Number(out.value)
        })
      }
      return UNIT
    }
  }
  if (target.type === 'expect' && (name === 'toBe' || name === 'toEqual')) {
    if (args.length !== 1) {
      throw new ZeeError(`\`expect(...).${name}\` takes one argument`, loc.line, loc.column, loc.file)
    }
    const match = valuesEqual(target.value, args[0]!)
    const ok = target.negated ? !match : match
    if (!ok) {
      const actual = formatExpect(target.value)
      const expected = formatExpect(args[0]!)
      const message = target.negated
        ? `expected ${actual} not to be ${expected}`
        : `expected ${actual} to be ${expected}`
      throw new PanicError(message, loc.line, loc.column, loc.file)
    }
    return UNIT
  }
  return undefined
}

function collectionEmpty(target: ZeeValue): boolean | undefined {
  if (target.type === 'list' || target.type === 'array') return target.items.length === 0
  if (target.type === 'map') return target.entries.size === 0
  if (target.type === 'string') return new TextEncoder().encode(target.value).length === 0
  return undefined
}

/** Kotlin `Char.isWhitespace`: Unicode category Z, plus HT/LF/VT/FF/CR and FS–US. Not NEL. */
function isCharWhitespace(ch: string): boolean {
  return /\p{Z}/u.test(ch) || /[\t\n\v\f\r\u001C-\u001F]/.test(ch)
}

function isBlankString(s: string): boolean {
  const chars = [...s]
  return chars.length === 0 || chars.every(isCharWhitespace)
}

function callMapMethod(
  target: Extract<ZeeValue, { type: 'map' }>,
  name: string,
  args: ZeeValue[],
  io: RuntimeIo,
  loc: { file: string; line: number; column: number },
): ZeeValue | undefined {
  if (name === 'keys') {
    if (args.length !== 0) {
      throw new ZeeError('`keys` takes no arguments', loc.line, loc.column, loc.file)
    }
    return {
      type: 'list',
      items: [...target.entries.values()].map((entry) => copyValue(entry.key)),
      elem: target.key,
    }
  }
  if (name === 'values') {
    if (args.length !== 0) {
      throw new ZeeError('`values` takes no arguments', loc.line, loc.column, loc.file)
    }
    return {
      type: 'list',
      items: [...target.entries.values()].map((entry) => copyValue(entry.value)),
      elem: target.value,
    }
  }
  if (name === 'sortByKey' || name === 'sortByValue') {
    if (args.length !== 0) {
      throw new ZeeError(`\`${name}\` takes no arguments`, loc.line, loc.column, loc.file)
    }
    const items = [...target.entries.values()]
    items.sort((left, right) =>
      name === 'sortByKey'
        ? compareOrd(left.key, right.key, loc)
        : compareOrd(left.value, right.value, loc),
    )
    const entries = new Map<string, { key: ZeeValue; value: ZeeValue }>()
    for (const item of items) {
      entries.set(mapHashKey(item.key, loc), {
        key: copyValue(item.key),
        value: copyValue(item.value),
      })
    }
    return { type: 'map', entries, key: target.key, value: target.value }
  }
  if (name === 'mapValues') {
    if (args.length !== 1) {
      throw new ZeeError('`mapValues` takes one function', loc.line, loc.column, loc.file)
    }
    const entries = new Map<string, { key: ZeeValue; value: ZeeValue }>()
    let valueType = target.value
    for (const [hash, entry] of target.entries) {
      const mapped = applyFnValue(args[0]!, [entry.value], io, loc)
      valueType = typeOfValue(mapped)
      entries.set(hash, { key: copyValue(entry.key), value: mapped })
    }
    return { type: 'map', entries, key: target.key, value: valueType }
  }
  if (name === 'filter') {
    if (args.length !== 1) {
      throw new ZeeError('`filter` takes one function', loc.line, loc.column, loc.file)
    }
    const entries = new Map<string, { key: ZeeValue; value: ZeeValue }>()
    for (const [hash, entry] of target.entries) {
      const keep = applyFnValue(args[0]!, [entry.key, entry.value], io, loc)
      if (keep.type !== 'bool') {
        throw new ZeeError('`filter` expects `(K, V) -> bool`', loc.line, loc.column, loc.file)
      }
      if (keep.value) {
        entries.set(hash, { key: copyValue(entry.key), value: copyValue(entry.value) })
      }
    }
    return { type: 'map', entries, key: target.key, value: target.value }
  }
  if (name === 'find' || name === 'any' || name === 'all') {
    if (args.length !== 1) {
      throw new ZeeError(`\`${name}\` takes one function`, loc.line, loc.column, loc.file)
    }
    if (name === 'all') {
      for (const entry of target.entries.values()) {
        const keep = applyFnValue(args[0]!, [entry.key, entry.value], io, loc)
        if (keep.type !== 'bool') {
          throw new ZeeError(`\`${name}\` expects \`(K, V) -> bool\``, loc.line, loc.column, loc.file)
        }
        if (!keep.value) return { type: 'bool', value: false }
      }
      return { type: 'bool', value: true }
    }
    for (const entry of target.entries.values()) {
      const keep = applyFnValue(args[0]!, [entry.key, entry.value], io, loc)
      if (keep.type !== 'bool') {
        throw new ZeeError(`\`${name}\` expects \`(K, V) -> bool\``, loc.line, loc.column, loc.file)
      }
      if (keep.value) {
        if (name === 'find') {
          return {
            type: 'option',
            tag: 'some',
            value: { type: 'tuple', items: [copyValue(entry.key), copyValue(entry.value)] },
          }
        }
        return { type: 'bool', value: true }
      }
    }
    if (name === 'find') return { type: 'option', tag: 'none' }
    return { type: 'bool', value: false }
  }
  if (name === 'forEach') {
    if (args.length !== 1) {
      throw new ZeeError('`forEach` takes one function', loc.line, loc.column, loc.file)
    }
    for (const entry of target.entries.values()) {
      applyFnValue(args[0]!, [entry.key, entry.value], io, loc)
    }
    return UNIT
  }
  if (name === 'containsKey') {
    if (args.length !== 1) {
      throw new ZeeError('`containsKey` takes one argument', loc.line, loc.column, loc.file)
    }
    return { type: 'bool', value: target.entries.has(mapHashKey(args[0]!, loc)) }
  }
  if (name === 'merge') {
    const right = args[0]
    if (args.length !== 1 || !right || right.type !== 'map') {
      throw new ZeeError('`merge` takes one Map', loc.line, loc.column, loc.file)
    }
    const entries = new Map<string, { key: ZeeValue; value: ZeeValue }>()
    for (const [hash, entry] of target.entries) {
      entries.set(hash, { key: copyValue(entry.key), value: copyValue(entry.value) })
    }
    for (const [hash, entry] of right.entries) {
      entries.set(hash, { key: copyValue(entry.key), value: copyValue(entry.value) })
    }
    return { type: 'map', entries, key: target.key, value: target.value }
  }
  if (name === 'map') {
    throw new ZeeError('`map` is List / `T[]`; Map uses `mapValues`', loc.line, loc.column, loc.file)
  }
  if (name === 'contains') {
    throw new ZeeError('`contains` is List; Map uses `containsKey`', loc.line, loc.column, loc.file)
  }
  if (name === 'flat') {
    throw new ZeeError('`flat` is List / `T[]`', loc.line, loc.column, loc.file)
  }
  if (
    name === 'fold' ||
    name === 'count' ||
    name === 'zip' ||
    name === 'groupBy' ||
    name === 'flatMap' ||
    name === 'min' ||
    name === 'max'
  ) {
    throw new ZeeError(`\`${name}\` is List / \`T[]\``, loc.line, loc.column, loc.file)
  }
  return undefined
}

function callSeqMethod(
  target: Extract<ZeeValue, { type: 'list' | 'array' }>,
  name: string,
  args: ZeeValue[],
  io: RuntimeIo,
  loc: { file: string; line: number; column: number },
): ZeeValue | undefined {
  if (name === 'contains') {
    if (args.length !== 1) {
      throw new ZeeError('`contains` takes one argument', loc.line, loc.column, loc.file)
    }
    return { type: 'bool', value: target.items.some((item) => valuesEqual(item, args[0]!)) }
  }
  if (name === 'map') {
    if (args.length !== 1) {
      throw new ZeeError('`map` takes one function', loc.line, loc.column, loc.file)
    }
    const mapped = target.items.map((item) => applyFnValue(args[0]!, [item], io, loc))
    const elem = mapped[0] ? typeOfValue(mapped[0]) : target.elem
    return { type: target.type, items: mapped, elem }
  }
  if (name === 'filter') {
    if (args.length !== 1) {
      throw new ZeeError('`filter` takes one function', loc.line, loc.column, loc.file)
    }
    const items: ZeeValue[] = []
    for (const item of target.items) {
      const keep = applyFnValue(args[0]!, [item], io, loc)
      if (keep.type !== 'bool') {
        throw new ZeeError('`filter` expects `(T) -> bool`', loc.line, loc.column, loc.file)
      }
      if (keep.value) items.push(copyValue(item))
    }
    return { type: target.type, items, elem: target.elem }
  }
  if (name === 'forEach') {
    if (args.length !== 1) {
      throw new ZeeError('`forEach` takes one function', loc.line, loc.column, loc.file)
    }
    for (const item of target.items) {
      applyFnValue(args[0]!, [item], io, loc)
    }
    return UNIT
  }
  if (name === 'find' || name === 'any' || name === 'all') {
    if (args.length !== 1) {
      throw new ZeeError(`\`${name}\` takes one function`, loc.line, loc.column, loc.file)
    }
    if (name === 'all') {
      for (const item of target.items) {
        const keep = applyFnValue(args[0]!, [item], io, loc)
        if (keep.type !== 'bool') {
          throw new ZeeError(`\`${name}\` expects \`(T) -> bool\``, loc.line, loc.column, loc.file)
        }
        if (!keep.value) return { type: 'bool', value: false }
      }
      return { type: 'bool', value: true }
    }
    for (const item of target.items) {
      const keep = applyFnValue(args[0]!, [item], io, loc)
      if (keep.type !== 'bool') {
        throw new ZeeError(`\`${name}\` expects \`(T) -> bool\``, loc.line, loc.column, loc.file)
      }
      if (keep.value) {
        if (name === 'find') return { type: 'option', tag: 'some', value: copyValue(item) }
        return { type: 'bool', value: true }
      }
    }
    if (name === 'find') return { type: 'option', tag: 'none' }
    return { type: 'bool', value: false }
  }
  if (name === 'slice') {
    if (args.length !== 2) {
      throw new ZeeError('`slice` takes start and end (`usize`)', loc.line, loc.column, loc.file)
    }
    const start = usizeIndex(args[0]!, loc, 'slice start')
    const end = usizeIndex(args[1]!, loc, 'slice end')
    if (start > end || end > target.items.length) {
      throw new ZeeError('slice out of bounds', loc.line, loc.column, loc.file)
    }
    const items = target.items.slice(start, end).map(copyValue)
    return { type: target.type, items, elem: target.elem }
  }
  if (name === 'first' || name === 'last') {
    if (args.length !== 0) {
      throw new ZeeError(`\`${name}\` takes no arguments`, loc.line, loc.column, loc.file)
    }
    if (target.items.length === 0) return { type: 'option', tag: 'none' }
    const item = name === 'first' ? target.items[0]! : target.items[target.items.length - 1]!
    return { type: 'option', tag: 'some', value: copyValue(item) }
  }
  if (name === 'reverse') {
    if (args.length !== 0) {
      throw new ZeeError('`reverse` takes no arguments', loc.line, loc.column, loc.file)
    }
    return {
      type: target.type,
      items: [...target.items].reverse().map(copyValue),
      elem: target.elem,
    }
  }
  if (name === 'unique') {
    if (args.length !== 0) {
      throw new ZeeError('`unique` takes no arguments', loc.line, loc.column, loc.file)
    }
    const items: ZeeValue[] = []
    for (const item of target.items) {
      if (items.some((kept) => valuesEqual(kept, item))) continue
      items.push(copyValue(item))
    }
    return { type: target.type, items, elem: target.elem }
  }
  if (name === 'join') {
    const sep = args[0]
    if (args.length !== 1 || !sep || sep.type !== 'string') {
      throw new ZeeError('`join` takes a String separator', loc.line, loc.column, loc.file)
    }
    const parts = target.items.map((item) => {
      if (item.type !== 'string') {
        throw new ZeeError('`join` requires `List<String>` or `String[]`', loc.line, loc.column, loc.file)
      }
      return item.value
    })
    return { type: 'string', value: parts.join(sep.value) }
  }
  if (name === 'flat') {
    if (args.length !== 0) {
      throw new ZeeError('`flat` takes no arguments', loc.line, loc.column, loc.file)
    }
    const nested = target.type === 'list' ? 'list' : 'array'
    if (target.elem.kind !== nested) {
      throw new ZeeError(
        nested === 'list' ? '`flat` requires `List<List<T>>`' : '`flat` requires `T[][]`',
        loc.line,
        loc.column,
        loc.file,
      )
    }
    const items: ZeeValue[] = []
    for (const inner of target.items) {
      if (inner.type !== nested) {
        throw new ZeeError(
          nested === 'list' ? '`flat` requires `List<List<T>>`' : '`flat` requires `T[][]`',
          loc.line,
          loc.column,
          loc.file,
        )
      }
      for (const item of inner.items) {
        items.push(copyValue(item))
      }
    }
    return { type: target.type, items, elem: target.elem.elem }
  }
  if (name === 'fold') {
    if (args.length !== 2) {
      throw new ZeeError(
        '`fold` takes an initial value and `(Acc, T) -> Acc`',
        loc.line,
        loc.column,
        loc.file,
      )
    }
    let acc = copyValue(args[0]!)
    for (const item of target.items) {
      acc = applyFnValue(args[1]!, [acc, item], io, loc)
    }
    return acc
  }
  if (name === 'count') {
    if (args.length !== 1) {
      throw new ZeeError('`count` takes a `(T) -> bool` predicate', loc.line, loc.column, loc.file)
    }
    let n = 0n
    for (const item of target.items) {
      const keep = applyFnValue(args[0]!, [item], io, loc)
      if (keep.type !== 'bool') {
        throw new ZeeError('`count` expects `(T) -> bool`', loc.line, loc.column, loc.file)
      }
      if (keep.value) n += 1n
    }
    return { type: 'usize', value: n }
  }
  if (name === 'zip') {
    const other = args[0]
    if (args.length !== 1 || !other || other.type !== target.type) {
      throw new ZeeError('`zip` requires two Lists or two arrays', loc.line, loc.column, loc.file)
    }
    const n = Math.min(target.items.length, other.items.length)
    const items: ZeeValue[] = []
    for (let i = 0; i < n; i += 1) {
      items.push({
        type: 'tuple',
        items: [copyValue(target.items[i]!), copyValue(other.items[i]!)],
      })
    }
    return {
      type: target.type,
      items,
      elem: { kind: 'tuple', parts: [target.elem, other.elem] },
    }
  }
  if (name === 'groupBy') {
    if (args.length !== 1) {
      throw new ZeeError('`groupBy` takes one function', loc.line, loc.column, loc.file)
    }
    const groups = new Map<string, { key: ZeeValue; items: ZeeValue[] }>()
    let keyType: ZeeType | undefined
    for (const item of target.items) {
      const key = applyFnValue(args[0]!, [item], io, loc)
      if (!keyType) keyType = typeOfValue(key)
      const hash = mapHashKey(key, loc)
      let group = groups.get(hash)
      if (!group) {
        group = { key: copyValue(key), items: [] }
        groups.set(hash, group)
      }
      group.items.push(copyValue(item))
    }
    const entries = new Map<string, { key: ZeeValue; value: ZeeValue }>()
    for (const [hash, group] of groups) {
      entries.set(hash, {
        key: group.key,
        value: { type: target.type, items: group.items, elem: target.elem },
      })
    }
    return {
      type: 'map',
      entries,
      key: keyType ?? target.elem,
      value: { kind: target.type, elem: target.elem },
    }
  }
  if (name === 'flatMap') {
    if (args.length !== 1) {
      throw new ZeeError('`flatMap` takes one function', loc.line, loc.column, loc.file)
    }
    const nested = target.type
    const items: ZeeValue[] = []
    let elem = target.elem
    for (const item of target.items) {
      const inner = applyFnValue(args[0]!, [item], io, loc)
      if (inner.type !== nested) {
        throw new ZeeError(
          nested === 'list' ? '`flatMap` requires `(T) -> List<U>`' : '`flatMap` requires `(T) -> U[]`',
          loc.line,
          loc.column,
          loc.file,
        )
      }
      elem = inner.elem
      for (const value of inner.items) {
        items.push(copyValue(value))
      }
    }
    return { type: target.type, items, elem }
  }
  if (name === 'min' || name === 'max') {
    if (args.length !== 0) {
      throw new ZeeError(`\`${name}\` takes no arguments`, loc.line, loc.column, loc.file)
    }
    if (target.items.length === 0) return { type: 'option', tag: 'none' }
    let best = target.items[0]!
    for (let i = 1; i < target.items.length; i += 1) {
      const item = target.items[i]!
      const cmp = compareOrd(item, best, loc)
      if (name === 'min' ? cmp < 0 : cmp > 0) best = item
    }
    return { type: 'option', tag: 'some', value: copyValue(best) }
  }
  return undefined
}

function usizeIndex(
  value: ZeeValue,
  loc: { file: string; line: number; column: number },
  what: string,
): number {
  if (!isIntValue(value) || value.type !== 'usize') {
    throw new ZeeError(`${what} must be usize`, loc.line, loc.column, loc.file)
  }
  return Number(intBigInt(value))
}

function compareOrd(
  left: ZeeValue,
  right: ZeeValue,
  loc: { file: string; line: number; column: number },
): number {
  let a = left
  let b = right
  if (
    a.type === 'newtype' &&
    b.type === 'newtype' &&
    a.name === b.name &&
    a.module === b.module
  ) {
    a = a.inner
    b = b.inner
  }
  if (isIntValue(a) && isIntValue(b) && a.type === b.type) {
    const l = intBigInt(a)
    const r = intBigInt(b)
    return l < r ? -1 : l > r ? 1 : 0
  }
  if ((a.type === 'string' && b.type === 'string') || (a.type === 'char' && b.type === 'char')) {
    return utf8Compare(a.value, b.value)
  }
  if (a.type === 'enum' && b.type === 'enum' && a.name === b.name && a.module === b.module) {
    return a.ordinal < b.ordinal ? -1 : a.ordinal > b.ordinal ? 1 : 0
  }
  throw new ZeeError('`sort` requires `T: Ord`', loc.line, loc.column, loc.file)
}

function formatExpect(value: ZeeValue): string {
  if (value.type === 'string') return JSON.stringify(value.value)
  return display(value)
}

function applyFnValue(
  fn: ZeeValue,
  args: ZeeValue[],
  io: RuntimeIo,
  loc: { file: string; line: number; column: number },
): ZeeValue {
  if (fn.type === 'fn') return callFn(fn, args, io, loc)
  if (fn.type === 'closure') return callClosure(fn, args, io, loc)
  throw new ZeeError('expected a function', loc.line, loc.column, loc.file)
}

function evalMember(expr: Extract<Expr, { kind: 'member' }>, env: Env, io: RuntimeIo): ZeeValue {
  const target = evalExpr(expr.target, env, io)
  return memberOnValue(target, expr.field, env, expr.loc)
}

function memberOnValue(
  target: ZeeValue,
  field: string,
  env: Env,
  loc: { file: string; line: number; column: number },
): ZeeValue {
  if (field === 'len') {
    if (target.type === 'array' || target.type === 'list') {
      return intValue('usize', BigInt(target.items.length))
    }
    if (target.type === 'map') return intValue('usize', BigInt(target.entries.size))
    if (target.type === 'string') {
      return intValue('usize', BigInt(new TextEncoder().encode(target.value).length))
    }
  }
  if (target.type === 'expect' && field === 'not') {
    return { type: 'expect', value: target.value, negated: !target.negated }
  }
  if (target.type === 'module') {
    const slot = target.env.own(field)
    if (!slot || (env.module !== target.name && slot.visibility !== 'pub')) {
      throw new ZeeError(
        `undefined name \`${field}\` on module \`${target.name}\``,
        loc.line,
        loc.column,
        loc.file,
      )
    }
    return copyValue(slot.value)
  }
  if (target.type === 'typeNs') {
    if (target.tag === 'enum') {
      const ordinal = target.variants.indexOf(field)
      if (ordinal < 0) {
        throw new ZeeError(
          `unknown variant \`${field}\` on ${target.name}`,
          loc.line,
          loc.column,
          loc.file,
        )
      }
      return { type: 'enum', name: target.name, module: target.module, variant: field, ordinal }
    }
    if (target.tag === 'struct') {
      const member = target.members[field]
      if (member === undefined) {
        throw new ZeeError(
          `unknown associated name \`${field}\` on ${target.name}`,
          loc.line,
          loc.column,
          loc.file,
        )
      }
      return copyValue(member)
    }
    throw new ZeeError(
      `sealed variant \`${field}\` needs a struct literal`,
      loc.line,
      loc.column,
      loc.file,
    )
  }
  if (target.type !== 'struct') {
    throw new ZeeError(`no field \`${field}\` on this value`, loc.line, loc.column, loc.file)
  }
  const value = target.fields[field]
  if (value === undefined) {
    throw new ZeeError(`unknown field \`${field}\` on ${target.name}`, loc.line, loc.column, loc.file)
  }
  return copyValue(value)
}

function evalStructLit(expr: Extract<Expr, { kind: 'structLit' }>, env: Env, io: RuntimeIo): ZeeValue {
  const sealed = resolveRuntimeSealed(expr, env)
  if (sealed) {
    const fields: Record<string, ZeeValue> = {}
    const fieldMut: Record<string, boolean> = {}
    const inits = new Map(expr.fields.map((field) => [field.name, field.value]))
    for (const field of sealed.variant.fields) {
      const init = inits.get(field.name)
      if (!init) {
        throw new ZeeError(
          `missing field \`${field.name}\` in ${sealed.ns.name}.${sealed.variant.name}`,
          expr.loc.line,
          expr.loc.column,
          expr.loc.file,
        )
      }
      fields[field.name] = copyValue(evalExpr(init, env, io))
      fieldMut[field.name] = field.mutable
    }
    return {
      type: 'sealed',
      name: sealed.ns.name,
      module: sealed.ns.module,
      variant: sealed.variant.name,
      data: sealed.variant.data,
      readonly: sealed.variant.readonly,
      identity: sealed.ns.identity,
      fields,
      fieldMut,
    }
  }
  const info = resolveRuntimeStruct(expr, env)
  const fields: Record<string, ZeeValue> = {}
  const fieldMut: Record<string, boolean> = {}
  const inits = new Map(expr.fields.map((field) => [field.name, field.value]))
  for (const field of info.fields) {
    const init = inits.get(field.name)
    if (!init) {
      throw new ZeeError(
        `missing field \`${field.name}\` in ${info.name}`,
        expr.loc.line,
        expr.loc.column,
        expr.loc.file,
      )
    }
    fields[field.name] = copyValue(evalExpr(init, env, io))
    fieldMut[field.name] = field.mutable
  }
  return {
    type: 'struct',
    name: info.name,
    module: info.module,
    data: info.data,
    readonly: info.readonly,
    identity: info.identity,
    fields,
    fieldMut,
    fieldMeta: info.fields.map((field) => ({ name: field.name, attributes: field.attributes })),
  }
}

function resolveRuntimeSealed(
  expr: Extract<Expr, { kind: 'structLit' }>,
  env: Env,
): { ns: Extract<ZeeValue, { type: 'typeNs'; tag: 'sealed' }>; variant: RuntimeSealedVariant } | undefined {
  if (!expr.qualifier || expr.qualifier.length === 0) return undefined
  if (expr.qualifier.length === 1) {
    const first = env.get(expr.qualifier[0]!, expr.loc)
    if (first.type === 'typeNs' && first.tag === 'sealed') {
      const variant = first.variants.find((item) => item.name === expr.name)
      if (!variant) {
        throw new ZeeError(
          `unknown variant \`${expr.name}\` on ${first.name}`,
          expr.loc.line,
          expr.loc.column,
          expr.loc.file,
        )
      }
      return { ns: first, variant }
    }
    return undefined
  }
  if (expr.qualifier.length === 2) {
    const first = env.get(expr.qualifier[0]!, expr.loc)
    if (first.type !== 'module') return undefined
    const ns = first.env.own(expr.qualifier[1]!)?.value
    if (!ns || ns.type !== 'typeNs' || ns.tag !== 'sealed') return undefined
    const variant = ns.variants.find((item) => item.name === expr.name)
    if (!variant) {
      throw new ZeeError(
        `unknown variant \`${expr.name}\` on ${ns.name}`,
        expr.loc.line,
        expr.loc.column,
        expr.loc.file,
      )
    }
    return { ns, variant }
  }
  return undefined
}

function resolveRuntimeStruct(expr: Extract<Expr, { kind: 'structLit' }>, env: Env): StructInfo {
  if (expr.qualifier && expr.qualifier.length > 0) {
    const nestedName = `${expr.qualifier.join('.')}.${expr.name}`
    const nested = env.getStruct(nestedName)
    if (nested) return nested
  }
  if (!expr.qualifier || expr.qualifier.length === 0) {
    const info = env.getStruct(expr.name)
    if (!info) {
      throw new ZeeError(`unknown type \`${expr.name}\``, expr.loc.line, expr.loc.column, expr.loc.file)
    }
    return info
  }
  const first = env.get(expr.qualifier[0]!, expr.loc)
  if (first.type !== 'module' || expr.qualifier.length !== 1) {
    throw new ZeeError(
      `unknown type \`${[...expr.qualifier, expr.name].join('.')}\``,
      expr.loc.line,
      expr.loc.column,
      expr.loc.file,
    )
  }
  const info = first.env.getStruct(expr.name)
  if (!info) {
    throw new ZeeError(
      `unknown type \`${first.name}.${expr.name}\``,
      expr.loc.line,
      expr.loc.column,
      expr.loc.file,
    )
  }
  return info
}

function matchPattern(
  pattern: MatchPattern,
  value: ZeeValue,
  env: Env,
  io: RuntimeIo,
  bindEnv: Env,
): boolean {
  if (pattern.kind === 'wildcard') return true
  if (pattern.kind === 'value') {
    return valuesEqual(value, evalExpr(pattern.expr, env, io))
  }
  if (value.type === 'enum') {
    const variant = pattern.path[pattern.path.length - 1]
    return value.variant === variant
  }
  if (value.type === 'struct') {
    const name = pattern.path[pattern.path.length - 1]
    if (value.name !== name) return false
    for (const field of pattern.fields ?? []) {
      if (field.name === '_') continue
      const bound = value.fields[field.name]
      if (bound === undefined) return false
      bindEnv.define(field.name, copyValue(bound))
    }
    return true
  }
  if (value.type !== 'sealed') return false
  const variant = pattern.path[pattern.path.length - 1]
  if (value.variant !== variant) return false
  for (const field of pattern.fields ?? []) {
    if (field.name === '_') continue
    const bound = value.fields[field.name]
    if (bound === undefined) return false
    bindEnv.define(field.name, copyValue(bound))
  }
  return true
}

function evalBinary(expr: Extract<Expr, { kind: 'binary' }>, env: Env, io: RuntimeIo): ZeeValue {
  if (expr.op === '?:') {
    const left = evalExpr(expr.left, env, io)
    if (left.type !== 'option') {
      throw new ZeeError('operator `?:` expects Option', expr.loc.line, expr.loc.column, expr.loc.file)
    }
    if (left.tag === 'some') return left.value
    return evalExpr(expr.right, env, io)
  }
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
  let right = evalExpr(expr.right, env, io)
  if (expr.op === '===' || expr.op === '!==') {
    const same = left === right
    return { type: 'bool', value: expr.op === '===' ? same : !same }
  }
  if (expr.op === '==' || expr.op === '!=') {
    const equal = valuesEqual(left, right)
    return { type: 'bool', value: expr.op === '==' ? equal : !equal }
  }
  const ord =
    expr.op === '<' ||
    expr.op === '<=' ||
    expr.op === '>' ||
    expr.op === '>=' ||
    expr.op === '<===>'
  let leftVal = left
  if (
    ord &&
    leftVal.type === 'newtype' &&
    right.type === 'newtype' &&
    leftVal.name === right.name &&
    leftVal.module === right.module
  ) {
    leftVal = leftVal.inner
    right = right.inner
  }
  if (expr.op === '+' && leftVal.type === 'string' && right.type === 'string') {
    return { type: 'string', value: leftVal.value + right.value }
  }
  if (
    expr.op === '+' &&
    (leftVal.type === 'list' || leftVal.type === 'array') &&
    right.type === leftVal.type
  ) {
    return {
      type: leftVal.type,
      items: [...leftVal.items.map(copyValue), ...right.items.map(copyValue)],
      elem: leftVal.elem,
    }
  }
  if (isFloatValue(leftVal) && isFloatValue(right) && leftVal.type === right.type) {
    const kind = leftVal.type
    const l = leftVal.value
    const r = right.value
    switch (expr.op) {
      case '+':
        return floatValue(kind, l + r)
      case '-':
        return floatValue(kind, l - r)
      case '*':
        return floatValue(kind, l * r)
      case '/':
        return floatValue(kind, l / r)
      case '%':
        return floatValue(kind, l % r)
    }
  }
  if ((expr.op === '<<' || expr.op === '>>') && isIntValue(leftVal) && isIntValue(right)) {
    const kind = leftVal.type
    const amount = shiftAmount(kind, right, expr.loc, false)
    if (expr.op === '<<') return intChecked(kind, intBigInt(leftVal) << amount, expr.loc)
    return intValue(kind, intBigInt(leftVal) >> amount)
  }
  if (
    (leftVal.type === 'string' && right.type === 'string') ||
    (leftVal.type === 'char' && right.type === 'char')
  ) {
    const cmp = utf8Compare(leftVal.value, right.value)
    switch (expr.op) {
      case '<===>':
        return { type: 'i32', value: cmp }
      case '<':
        return { type: 'bool', value: cmp < 0 }
      case '<=':
        return { type: 'bool', value: cmp <= 0 }
      case '>':
        return { type: 'bool', value: cmp > 0 }
      case '>=':
        return { type: 'bool', value: cmp >= 0 }
    }
  }
  if (isIntValue(leftVal) && isIntValue(right) && leftVal.type === right.type) {
    const kind = leftVal.type
    const l = intBigInt(leftVal)
    const r = intBigInt(right)
    switch (expr.op) {
      case '+':
        return intChecked(kind, l + r, expr.loc)
      case '-':
        return intChecked(kind, l - r, expr.loc)
      case '*':
        return intChecked(kind, l * r, expr.loc)
      case '/':
        if (r === 0n) {
          throw new ZeeError('division by zero', expr.loc.line, expr.loc.column, expr.loc.file)
        }
        return intValue(kind, l / r)
      case '%':
        if (r === 0n) {
          throw new ZeeError('division by zero', expr.loc.line, expr.loc.column, expr.loc.file)
        }
        return intValue(kind, l % r)
      case '&':
        return intValue(kind, l & r)
      case '|':
        return intValue(kind, l | r)
      case '^':
        return intValue(kind, l ^ r)
      case '<===>':
        return { type: 'i32', value: l < r ? -1 : l > r ? 1 : 0 }
      case '<':
        return { type: 'bool', value: l < r }
      case '<=':
        return { type: 'bool', value: l <= r }
      case '>':
        return { type: 'bool', value: l > r }
      case '>=':
        return { type: 'bool', value: l >= r }
    }
  }
  if (
    leftVal.type === 'enum' &&
    right.type === 'enum' &&
    leftVal.name === right.name &&
    leftVal.module === right.module
  ) {
    const l = leftVal.ordinal
    const r = right.ordinal
    switch (expr.op) {
      case '<===>':
        return { type: 'i32', value: l < r ? -1 : l > r ? 1 : 0 }
      case '<':
        return { type: 'bool', value: l < r }
      case '<=':
        return { type: 'bool', value: l <= r }
      case '>':
        return { type: 'bool', value: l > r }
      case '>=':
        return { type: 'bool', value: l >= r }
    }
  }
  throw new ZeeError(`operator \`${expr.op}\` is not defined for these values`, expr.loc.line, expr.loc.column, expr.loc.file)
}

function evalCall(expr: Extract<Expr, { kind: 'call' }>, env: Env, io: RuntimeIo): ZeeValue {
  return bindCall(expr, env, io)()
}

function bindCall(expr: Extract<Expr, { kind: 'call' }>, env: Env, io: RuntimeIo): () => ZeeValue {
  if (expr.callee.kind === 'ident' && expr.callee.name === 'describe') {
    const titleExpr = expr.args[0]
    const title = titleExpr?.kind === 'string' ? titleExpr.value : undefined
    const body = expr.args[1]
    return () => {
      if (title === undefined) {
        throw new ZeeError('`describe` needs a string literal', expr.loc.line, expr.loc.column, expr.loc.file)
      }
      applyDescribe(title, body, env, io)
      return UNIT
    }
  }
  if (expr.callee.kind === 'ident') {
    const name = expr.callee.name
    if (name === 'narrow') {
      if (!expr.typeArgs || expr.typeArgs.length !== 1 || expr.args.length !== 1) {
        throw new ZeeError('`narrow` takes one type argument and one value', expr.loc.line, expr.loc.column, expr.loc.file)
      }
      const target = intKindFromTypeAst(expr.typeArgs[0]!)
      const arg = evalExpr(expr.args[0]!, env, io)
      if (isFloatValue(arg)) {
        const n = arg.value
        return () => narrowFloatToInt(n, target)
      }
      if (!isIntValue(arg)) {
        throw new ZeeError('`narrow` expects an integer or float', expr.loc.line, expr.loc.column, expr.loc.file)
      }
      const n = intBigInt(arg)
      return () => {
        if (!intFits(n, target)) return { type: 'option', tag: 'none' }
        return { type: 'option', tag: 'some', value: intValue(target, n) }
      }
    }
    if (name === 'jsonEncode') {
      if (expr.args.length !== 1) {
        throw new ZeeError('`jsonEncode` takes one argument', expr.loc.line, expr.loc.column, expr.loc.file)
      }
      const arg = evalExpr(expr.args[0]!, env, io)
      return () => encodeJsonValue(arg, expr.loc)
    }
    if (name === 'jsonDecode') {
      if (!expr.typeArgs || expr.typeArgs.length !== 1 || expr.args.length !== 1) {
        throw new ZeeError(
          '`jsonDecode` takes one type argument and one String',
          expr.loc.line,
          expr.loc.column,
          expr.loc.file,
        )
      }
      const target = resolveJsonTarget(expr.typeArgs[0]!, env, mergedJsonSubst(), expr.loc)
      const arg = evalExpr(expr.args[0]!, env, io)
      return () => decodeJsonValue(arg, target, expr.loc)
    }
    if (name === 'httpDispatch') {
      if (expr.args.length !== 2) {
        throw new ZeeError('`httpDispatch` takes two arguments', expr.loc.line, expr.loc.column, expr.loc.file)
      }
      const router = evalExpr(expr.args[0]!, env, io)
      const req = evalExpr(expr.args[1]!, env, io)
      return () => runHttpDispatch(router, req, env, io, expr.loc)
    }
    if (name === 'httpRouterController') {
      if (expr.args.length !== 2) {
        throw new ZeeError('`httpRouterController` takes two arguments', expr.loc.line, expr.loc.column, expr.loc.file)
      }
      const router = evalExpr(expr.args[0]!, env, io)
      const instance = evalExpr(expr.args[1]!, env, io)
      return () => mountHttpController(router, instance)
    }
    if (name === 'httpApp') {
      if (expr.args.length !== 0) {
        throw new ZeeError('`httpApp` takes no arguments', expr.loc.line, expr.loc.column, expr.loc.file)
      }
      return () => buildHttpApp(env, io, expr.loc)
    }
    if (name === 'httpFail') {
      if (expr.args.length !== 1) {
        throw new ZeeError('`httpFail` takes one argument', expr.loc.line, expr.loc.column, expr.loc.file)
      }
      const err = evalExpr(expr.args[0]!, env, io)
      return () => runHttpFail(err, env, io, expr.loc)
    }
    if (name === 'httpListen') {
      if (expr.args.length !== 2) {
        throw new ZeeError('`httpListen` takes two arguments', expr.loc.line, expr.loc.column, expr.loc.file)
      }
      const addr = evalExpr(expr.args[0]!, env, io)
      const router = evalExpr(expr.args[1]!, env, io)
      return () => {
        if (addr.type !== 'string') {
          throw new ZeeError('`httpListen` expects a String address', expr.loc.line, expr.loc.column, expr.loc.file)
        }
        startHttpServer(addr.value, (method, path, text, headers) => {
          const incoming = httpRequestValue(method, path, text, {}, headers)
          return readHttpResponse(runHttpDispatch(router, incoming, env, io, expr.loc))
        })
        return UNIT
      }
    }
    if (name === 'httpI32Param') {
      if (expr.args.length !== 2) {
        throw new ZeeError('`httpI32Param` takes two arguments', expr.loc.line, expr.loc.column, expr.loc.file)
      }
      const req = evalExpr(expr.args[0]!, env, io)
      const nameArg = evalExpr(expr.args[1]!, env, io)
      return () => {
        if (nameArg.type !== 'string') {
          throw new ZeeError('`httpI32Param` expects a String name', expr.loc.line, expr.loc.column, expr.loc.file)
        }
        return i32ParamFromRequest(req, nameArg.value)
      }
    }
    if (isFloatKind(name)) {
      if (expr.args.length !== 1) {
        throw new ZeeError(`\`${name}\` takes one argument`, expr.loc.line, expr.loc.column, expr.loc.file)
      }
      const arg = evalExpr(expr.args[0]!, env, io)
      return () => toFloatValue(name, arg, expr.loc)
    }
    if (isIntKind(name)) {
      if (expr.args.length !== 1) {
        throw new ZeeError(`\`${name}\` takes one argument`, expr.loc.line, expr.loc.column, expr.loc.file)
      }
      const arg = evalExpr(expr.args[0]!, env, io)
      return () => {
        if (arg.type === 'newtype') {
          if (!isIntValue(arg.inner) || arg.inner.type !== name) {
            throw new ZeeError(`cannot convert ${arg.name} to ${name}`, expr.loc.line, expr.loc.column, expr.loc.file)
          }
          return arg.inner
        }
        if (!isIntValue(arg)) {
          throw new ZeeError(`cannot convert this value to ${name}`, expr.loc.line, expr.loc.column, expr.loc.file)
        }
        if (arg.type !== name && !canWidenInt(arg.type, name)) {
          throw new ZeeError(`cannot convert ${arg.type} to ${name}`, expr.loc.line, expr.loc.column, expr.loc.file)
        }
        return intValue(name, intBigInt(arg))
      }
    }
    if ((name === 'String' || name === 'bool' || name === 'Unit') && expr.args.length === 1) {
      const arg = evalExpr(expr.args[0]!, env, io)
      return () => {
        if (arg.type === 'newtype') {
          if (name === 'String' && arg.inner.type === 'string') return copyValue(arg.inner)
          if (name === 'bool' && arg.inner.type === 'bool') return copyValue(arg.inner)
          if (name === 'Unit' && arg.inner.type === 'unit') return copyValue(arg.inner)
        }
        throw new ZeeError(`cannot convert this value to ${name}`, expr.loc.line, expr.loc.column, expr.loc.file)
      }
    }
  }
  if (expr.callee.kind === 'member') {
    if (expr.callee.target.kind === 'ident' && expr.callee.target.name === 'wrap') {
      return bindWrapCall(expr, env, io)
    }
    if (
      expr.callee.target.kind === 'ident' &&
      expr.callee.target.name === 'String' &&
      expr.callee.field === 'fromBytes'
    ) {
      if (expr.args.length !== 1) {
        throw new ZeeError('`String.fromBytes` takes one argument', expr.loc.line, expr.loc.column, expr.loc.file)
      }
      const buf = evalExpr(expr.args[0]!, env, io)
      return () => stringFromBytes(buf, expr.loc)
    }
    if (
      expr.callee.target.kind === 'ident' &&
      expr.callee.target.name === 'Regex' &&
      expr.callee.field === 'of'
    ) {
      if (expr.args.length !== 1) {
        throw new ZeeError('`Regex.of` takes one argument', expr.loc.line, expr.loc.column, expr.loc.file)
      }
      const pattern = evalExpr(expr.args[0]!, env, io)
      return () => runRegexOf(pattern, expr.loc)
    }
    const target = evalExpr(expr.callee.target, env, io)
    const args = expr.args.map((arg) => evalExpr(arg, env, io))
    const typeTargets = expr.typeArgs?.map((ast) => resolveJsonTarget(ast, env, mergedJsonSubst(), expr.loc))
    return () => invokeMemberCall(expr, target, args, env, io, typeTargets)
  }
  const callee = evalExpr(expr.callee, env, io)
  const args = expr.args.map((arg) => evalExpr(arg, env, io))
  const typeTargets = expr.typeArgs?.map((ast) => resolveJsonTarget(ast, env, mergedJsonSubst(), expr.loc))
  return () => invokeValue(callee, args, io, expr.loc, typeTargets)
}

function invokeMemberCall(
  expr: Extract<Expr, { kind: 'call' }>,
  target: ZeeValue,
  args: ZeeValue[],
  env: Env,
  io: RuntimeIo,
  typeTargets?: JsonTarget[],
): ZeeValue {
  if (expr.callee.kind !== 'member') {
    throw new ZeeError('cannot call this value', expr.loc.line, expr.loc.column, expr.loc.file)
  }
  if (expr.callee.field === 'message' && args.length === 0) {
    if (target.type === 'error') return { type: 'string', value: target.message }
    if (target.type === 'struct' && target.name === 'Fail') {
      const text = target.fields.text
      if (text?.type === 'string') return text
    }
  }
  const builtin = callCollectionMethod(target, expr.callee.field, args, io, expr.loc, env)
  if (builtin) return builtin
  const method = lookupRuntimeMethod(target, expr.callee.field, env)
  if (method) {
    return callFn(method, [target, ...args], io, expr.loc, typeTargets)
  }
  return invokeValue(memberOnValue(target, expr.callee.field, env, expr.callee.loc), args, io, expr.loc, typeTargets)
}

function invokeValue(
  callee: ZeeValue,
  args: ZeeValue[],
  io: RuntimeIo,
  loc: { file: string; line: number; column: number },
  typeTargets?: JsonTarget[],
): ZeeValue {
  if (callee.type === 'newtypeCtor') {
    if (args.length !== 1) {
      throw new ZeeError(`\`${callee.name}\` takes one argument`, loc.line, loc.column, loc.file)
    }
    return { type: 'newtype', name: callee.name, module: callee.module, inner: copyValue(args[0]!) }
  }
  if (callee.type === 'builtin') {
    if (callee.name === 'jsonEncode') return encodeJsonValue(args[0]!, loc)
    return callBuiltin(callee.name, args, io, loc)
  }
  if (callee.type === 'fn') return callFn(callee, args, io, loc, typeTargets)
  if (callee.type === 'closure') return callClosure(callee, args, io, loc)
  throw new ZeeError('cannot call this value', loc.line, loc.column, loc.file)
}

function lookupRuntimeMethod(
  target: ZeeValue,
  name: string,
  env: Env,
): Extract<ZeeValue, { type: 'fn' }> | undefined {
  const typeName =
    target.type === 'struct' || target.type === 'enum' || target.type === 'sealed' ? target.name : undefined
  if (!typeName) return undefined
  const found = env.getMethod(typeName, name)
  if (found) return found
  const moduleName =
    target.type === 'struct' || target.type === 'enum' || target.type === 'sealed' ? target.module : undefined
  if (moduleName === undefined) return undefined
  return env.getModule(moduleName)?.ownMethod(typeName, name)
}

function execDefer(stmt: Extract<Stmt, { kind: 'defer' }>, env: Env, io: RuntimeIo): ZeeValue {
  if (stmt.body.kind === 'call') {
    const thunk = bindCall(stmt.body, env, io)
    env.pushDefer(thunk, stmt.loc)
    return UNIT
  }
  env.pushDefer(() => evalExpr(stmt.body, env, io), stmt.loc)
  return UNIT
}

function runDefers(env: Env, _io: RuntimeIo): void {
  const frame = env.functionFrame()
  if (!frame?.defers) return
  const stack = frame.defers
  frame.defers = []
  let first: unknown
  while (stack.length > 0) {
    const thunk = stack.pop()!
    try {
      thunk()
    } catch (err) {
      if (!first) first = err
    }
  }
  if (first) throw first
}

function runWithDefers(env: Env, io: RuntimeIo, run: () => ZeeValue): ZeeValue {
  let outcome: { ok: ZeeValue } | { err: unknown }
  try {
    outcome = { ok: run() }
  } catch (err) {
    if (err instanceof ReturnSignal) {
      outcome = { ok: err.value }
    } else if (err instanceof BreakSignal || err instanceof ContinueSignal) {
      throw err
    } else {
      outcome = { err }
    }
  }
  let deferErr: unknown
  try {
    runDefers(env, io)
  } catch (err) {
    deferErr = err
  }
  if ('err' in outcome) throw outcome.err
  if (deferErr) throw deferErr
  return outcome.ok
}

function callFn(
  fn: Extract<ZeeValue, { type: 'fn' }>,
  args: ZeeValue[],
  io: RuntimeIo,
  loc: { file: string; line: number; column: number },
  typeTargets?: JsonTarget[],
): ZeeValue {
  if (args.length !== fn.params.length) {
    throw new ZeeError(
      `\`${fn.name}\` expects ${fn.params.length} argument(s)`,
      loc.line,
      loc.column,
      loc.file,
    )
  }
  const params = fn.typeParams ?? []
  const pushed =
    params.length > 0 && typeTargets !== undefined && typeTargets.length === params.length
  if (pushed) {
    const layer = new Map<string, JsonTarget>()
    params.forEach((name, index) => {
      layer.set(name, typeTargets[index]!)
    })
    jsonTypeSubst.push(layer)
  }
  try {
    const local = fn.env.child()
    local.markFunctionFrame(fn.name)
    fn.params.forEach((name, index) => {
      const arg = args[index]!
      const shareSelf = fn.mutatingReceiver && index === 0
      local.define(name, shareSelf ? arg : copyValue(arg), shareSelf)
    })
    return runWithDefers(local, io, () => execBlock(fn.body, local, io))
  } finally {
    if (pushed) jsonTypeSubst.pop()
  }
}

function callClosure(
  fn: Extract<ZeeValue, { type: 'closure' }>,
  args: ZeeValue[],
  io: RuntimeIo,
  loc: { file: string; line: number; column: number },
): ZeeValue {
  if (args.length !== fn.params.length) {
    throw new ZeeError(
      `lambda expects ${fn.params.length} argument(s)`,
      loc.line,
      loc.column,
      loc.file,
    )
  }
  const local = fn.env.child()
  local.markFunctionFrame('<lambda>')
  fn.params.forEach((name, index) => {
    if (name === '_') return
    local.define(name, copyValue(args[index]!))
  })
  return runWithDefers(local, io, () => execBlock(fn.body, local, io))
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
  if (name === 'printf' || name === 'sprintf') {
    const formatted = formatPrintf(args, loc)
    if (name === 'sprintf') return { type: 'string', value: formatted }
    io.print(formatted)
    return UNIT
  }
  if (name === 'str') {
    return { type: 'string', value: display(args[0] ?? UNIT) }
  }
  if (name === 'error') {
    const message = args[0]
    if (!message || message.type !== 'string') {
      throw new ZeeError('`error` expects a String', loc.line, loc.column, loc.file)
    }
    return {
      type: 'struct',
      name: 'Fail',
      module: '',
      data: true,
      readonly: false,
      identity: false,
      fields: { text: { type: 'string', value: message.value } },
      fieldMut: { text: false },
    }
  }
  if (name === 'panic') {
    const message = args[0]
    if (!message || message.type !== 'string') {
      throw new ZeeError('`panic` expects a String', loc.line, loc.column, loc.file)
    }
    throw new PanicError(message.value, loc.line, loc.column, loc.file)
  }
  if (name === 'Some') {
    if (args.length !== 1) {
      throw new ZeeError('`Some` takes one argument', loc.line, loc.column, loc.file)
    }
    return { type: 'option', tag: 'some', value: args[0]! }
  }
  if (name === 'getenv') {
    const key = args[0]
    if (!key || key.type !== 'string') {
      throw new ZeeError('`getenv` expects a String', loc.line, loc.column, loc.file)
    }
    const loaded = hostEnvFor(io)
    const processEnv = io.processEnv ?? process.env
    const value = lookupEnv(key.value, loaded, processEnv)
    if (value === undefined) return { type: 'option', tag: 'none' }
    return { type: 'option', tag: 'some', value: { type: 'string', value } }
  }
  if (name === 'envProfile') {
    if (args.length !== 0) {
      throw new ZeeError('`envProfile` takes no arguments', loc.line, loc.column, loc.file)
    }
    return { type: 'string', value: hostEnvFor(io).profile }
  }
  if (name === 'envAppMeta') {
    const key = args[0]
    if (!key || key.type !== 'string') {
      throw new ZeeError('`envAppMeta` expects a String', loc.line, loc.column, loc.file)
    }
    const value = hostEnvFor(io).app.get(key.value)
    if (value === undefined) return { type: 'option', tag: 'none' }
    return { type: 'option', tag: 'some', value: { type: 'string', value } }
  }
  if (name === 'testCases') {
    if (args.length !== 0) {
      throw new ZeeError('`testCases` takes no arguments', loc.line, loc.column, loc.file)
    }
    return listTestCases(io)
  }
  if (name === 'testCall') {
    if (args.length !== 2) {
      throw new ZeeError('`testCall` takes two arguments', loc.line, loc.column, loc.file)
    }
    return callTestCase(args[0]!, args[1]!, io, loc)
  }
  if (name === 'expect') {
    if (args.length !== 1) {
      throw new ZeeError('`expect` takes one argument', loc.line, loc.column, loc.file)
    }
    return { type: 'expect', value: args[0]!, negated: false }
  }
  if (name === 'describe') {
    if (args.length !== 1) {
      throw new ZeeError('`describe` takes one argument', loc.line, loc.column, loc.file)
    }
    if (args[0]!.type !== 'string') {
      throw new ZeeError('`describe` needs a string literal', loc.line, loc.column, loc.file)
    }
    return UNIT
  }
  if (name === 'jsonEncode') {
    if (args.length !== 1) {
      throw new ZeeError('`jsonEncode` takes one argument', loc.line, loc.column, loc.file)
    }
    return encodeJsonValue(args[0]!, loc)
  }
  if (name === 'httpI32Param') {
    if (args.length !== 2) {
      throw new ZeeError('`httpI32Param` takes two arguments', loc.line, loc.column, loc.file)
    }
    if (args[1]!.type !== 'string') {
      throw new ZeeError('`httpI32Param` expects a String name', loc.line, loc.column, loc.file)
    }
    return i32ParamFromRequest(args[0]!, args[1]!.value)
  }
  if (name === 'httpRouterController') {
    if (args.length !== 2) {
      throw new ZeeError('`httpRouterController` takes two arguments', loc.line, loc.column, loc.file)
    }
    return mountHttpController(args[0]!, args[1]!)
  }
  throw new ZeeError(`unknown builtin \`${name}\``, loc.line, loc.column, loc.file)
}

function stmtFn(stmt: Extract<Stmt, { kind: 'fn' }>, fileEnv: Env): TestFn {
  return {
    type: 'fn',
    name: stmt.name,
    params: stmt.params.map((param) => param.name),
    body: stmt.body,
    env: fileEnv,
    mutatingReceiver: false,
    typeParams: stmt.typeParams,
    attributes: stmt.attributes,
    paramMeta: runtimeParamMeta(stmt.params),
  }
}

function suiteKey(file: string, suite: string[]): string {
  return `${file}\0${suite.join('\0')}`
}

function suiteLabel(suite: string[], name: string): string {
  return suite.length > 0 ? `${suite.join(' > ')} > ${name}` : name
}

function suitePrefixes(suite: string[]): string[][] {
  const out: string[][] = [[]]
  for (let i = 0; i < suite.length; i += 1) {
    out.push(suite.slice(0, i + 1))
  }
  return out
}

function suitesToClose(prev: string[], next: string[] | undefined): string[][] {
  const keep = new Set((next ? suitePrefixes(next) : []).map((path) => path.join('\0')))
  return suitePrefixes(prev)
    .filter((path) => !keep.has(path.join('\0')))
    .reverse()
}

function attachTestHost(io: RuntimeIo): void {
  const reports: TestReport[] = []
  io.test = { reports }
  testHosts.set(io, {
    reports,
    root: io.root ?? '',
    cases: [],
    hooks: new Map(),
    beforeAllError: new Map(),
    enteredBeforeAll: new Set(),
    describeStack: [],
    seqSuite: [],
  })
}

function applyDescribe(title: string, body: Expr | undefined, env: Env, io: RuntimeIo): void {
  const host = testHosts.get(io)
  if (!host) return
  if (!body) {
    host.seqSuite = [...host.describeStack, title]
    return
  }
  const block = body.kind === 'block' ? body.block : body.kind === 'lambda' ? body.body : undefined
  if (!block) {
    throw new ZeeError('`describe` block must be `{ ... }`', body.loc.line, body.loc.column, body.loc.file)
  }
  host.describeStack.push(title)
  const saved = host.seqSuite
  host.seqSuite = [...host.describeStack]
  try {
    execBlock(block, env, io)
  } finally {
    host.describeStack.pop()
    host.seqSuite = saved
  }
}

function registerTopLevelTest(stmt: Extract<Stmt, { kind: 'fn' }>, fileEnv: Env, io: RuntimeIo): void {
  registerTestItem(stmt, fileEnv, io)
}

function defineDescribeFn(stmt: Extract<Stmt, { kind: 'fn' }>, env: Env, io: RuntimeIo): ZeeValue {
  const host = testHosts.get(io)
  if (!host || host.describeStack.length === 0) {
    throw new ZeeError('nested functions are not supported yet', stmt.loc.line, stmt.loc.column, stmt.loc.file)
  }
  if (env.own(stmt.name)) {
    throw new ZeeError(`duplicate definition of \`${stmt.name}\``, stmt.loc.line, stmt.loc.column, stmt.loc.file)
  }
  const fn = stmtFn(stmt, env)
  env.define(stmt.name, fn, false, stmt.visibility)
  registerTestItem(stmt, env, io)
  return UNIT
}

function registerTestItem(stmt: Extract<Stmt, { kind: 'fn' }>, fnEnv: Env, io: RuntimeIo): void {
  const host = testHosts.get(io)
  if (!host || !isZeeTestFile(fnEnv.file)) return
  const hook = (TEST_HOOKS as readonly string[]).includes(stmt.name)
  const test = stmt.name.startsWith('test')
  if (!hook && !test) return
  if (stmt.params.length > 0) {
    throw new ZeeError(
      hook ? `hook \`${stmt.name}\` takes no parameters` : `test function \`${stmt.name}\` takes no parameters`,
      stmt.loc.line,
      stmt.loc.column,
      stmt.loc.file,
    )
  }
  const suite = [...host.seqSuite]
  const file = fnEnv.file
  const rel = host.root ? relative(host.root, file) : file
  const fn = stmtFn(stmt, fnEnv)
  if (hook) {
    const key = suiteKey(file, suite)
    const set = host.hooks.get(key) ?? {}
    const name = stmt.name as TestHookName
    if (set[name]) {
      throw new ZeeError(
        `duplicate hook \`${stmt.name}\` in this describe`,
        stmt.loc.line,
        stmt.loc.column,
        stmt.loc.file,
      )
    }
    set[name] = fn
    host.hooks.set(key, set)
    return
  }
  if (
    host.cases.some(
      (item) => item.file === file && item.name === stmt.name && item.suite.join('\0') === suite.join('\0'),
    )
  ) {
    throw new ZeeError(
      `duplicate test \`${stmt.name}\` in this describe`,
      stmt.loc.line,
      stmt.loc.column,
      stmt.loc.file,
    )
  }
  host.cases.push({
    file,
    rel,
    name: stmt.name,
    label: suiteLabel(suite, stmt.name),
    suite,
    fn,
    loc: stmt.loc,
  })
}

function listTestCases(io: RuntimeIo): ZeeValue {
  const host = testHosts.get(io)
  const items: ZeeValue[] = (host?.cases ?? []).map((item) => ({
    type: 'tuple',
    items: [
      { type: 'string', value: item.rel },
      { type: 'string', value: item.label },
    ],
  }))
  return {
    type: 'list',
    items,
    elem: { kind: 'tuple', parts: [{ kind: 'string' }, { kind: 'string' }] },
  }
}

function callTestCase(
  fileArg: ZeeValue,
  nameArg: ZeeValue,
  io: RuntimeIo,
  loc: { file: string; line: number; column: number },
): ZeeValue {
  if (fileArg.type !== 'string' || nameArg.type !== 'string') {
    throw new ZeeError('`testCall` expects two Strings', loc.line, loc.column, loc.file)
  }
  const host = testHosts.get(io)
  if (!host) {
    return { type: 'option', tag: 'some', value: { type: 'string', value: `undefined test \`${nameArg.value}\`` } }
  }
  const abs = host.root && !isAbsolute(fileArg.value) ? resolve(host.root, fileArg.value) : fileArg.value
  const item = host.cases.find(
    (entry) =>
      (entry.label === nameArg.value || entry.name === nameArg.value) &&
      (entry.file === abs || entry.rel === fileArg.value || entry.file === fileArg.value),
  )
  if (!item) {
    const error = `undefined test \`${nameArg.value}\``
    host.reports.push({ file: fileArg.value, name: nameArg.value, ok: false, error })
    return { type: 'option', tag: 'some', value: { type: 'string', value: error } }
  }
  const index = host.cases.indexOf(item)
  const next = host.cases[index + 1]
  const nextSuite = next && next.file === item.file ? next.suite : undefined
  let error: string | undefined
  for (const path of suitePrefixes(item.suite)) {
    const inherited = host.beforeAllError.get(suiteKey(item.file, path))
    if (inherited) {
      error = inherited
      break
    }
  }
  if (!error) {
    for (const path of suitePrefixes(item.suite)) {
      const key = suiteKey(item.file, path)
      if (host.enteredBeforeAll.has(key)) continue
      host.enteredBeforeAll.add(key)
      const hookErr = runStoredHook(host.hooks.get(key)?.beforeAll, 'beforeAll', io, item.loc)
      if (hookErr) {
        host.beforeAllError.set(key, hookErr)
        error = hookErr
        break
      }
    }
  }
  if (!error) {
    for (const path of suitePrefixes(item.suite)) {
      error = runStoredHook(
        host.hooks.get(suiteKey(item.file, path))?.beforeEach,
        'beforeEach',
        io,
        item.loc,
      )
      if (error) break
    }
    if (!error) error = runTestBody(item.fn, io, item.loc)
    for (const path of [...suitePrefixes(item.suite)].reverse()) {
      const afterEach = runStoredHook(
        host.hooks.get(suiteKey(item.file, path))?.afterEach,
        'afterEach',
        io,
        item.loc,
      )
      if (afterEach) error = error ?? afterEach
    }
  }
  for (const path of suitesToClose(item.suite, nextSuite)) {
    const key = suiteKey(item.file, path)
    if (!host.enteredBeforeAll.has(key)) continue
    const afterAll = runStoredHook(host.hooks.get(key)?.afterAll, 'afterAll', io, item.loc)
    if (afterAll) error = error ?? afterAll
  }
  if (error) {
    host.reports.push({ file: item.file, name: item.name, ok: false, error })
    return { type: 'option', tag: 'some', value: { type: 'string', value: error } }
  }
  host.reports.push({ file: item.file, name: item.name, ok: true })
  return { type: 'option', tag: 'none' }
}

function runStoredHook(
  fn: TestFn | undefined,
  name: TestHookName,
  io: RuntimeIo,
  loc: { file: string; line: number; column: number },
): string | undefined {
  if (!fn) return undefined
  const error = runTestBody(fn, io, loc)
  return error ? `${name}: ${error}` : undefined
}

function runTestBody(
  fn: Extract<ZeeValue, { type: 'fn' }>,
  io: RuntimeIo,
  loc: { file: string; line: number; column: number },
): string | undefined {
  try {
    const value = callFn(fn, [], io, loc)
    const err = visibleTestErr(value)
    return err ? `err: ${err}` : undefined
  } catch (error) {
    if (error instanceof PanicError) return `panic: ${error.message}`
    throw error
  }
}

function interpolateValue(
  value: ZeeValue,
  loc: { file: string; line: number; column: number },
): string {
  if (value.type === 'string' || value.type === 'char') return value.value
  if (value.type === 'bool' || isIntValue(value)) return display(value)
  throw new ZeeError(`cannot interpolate ${value.type}`, loc.line, loc.column, loc.file)
}

function utf8Compare(left: string, right: string): number {
  const a = new TextEncoder().encode(left)
  const b = new TextEncoder().encode(right)
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i += 1) {
    if (a[i] !== b[i]) return a[i]! < b[i]! ? -1 : 1
  }
  return a.length < b.length ? -1 : a.length > b.length ? 1 : 0
}

function failError(message: string): ZeeValue {
  return {
    type: 'struct',
    name: 'Fail',
    module: '',
    data: true,
    readonly: false,
    identity: false,
    fields: { text: { type: 'string', value: message } },
    fieldMut: { text: false },
  }
}

function stringFromBytes(
  buf: ZeeValue,
  loc: { file: string; line: number; column: number },
): ZeeValue {
  if (buf.type !== 'array' || buf.elem.kind !== 'u8') {
    throw new ZeeError('`String.fromBytes` expects `u8[]`', loc.line, loc.column, loc.file)
  }
  const bytes = new Uint8Array(buf.items.length)
  for (let i = 0; i < buf.items.length; i += 1) {
    const item = buf.items[i]!
    if (item.type !== 'u8') {
      throw new ZeeError('`String.fromBytes` expects `u8[]`', loc.line, loc.column, loc.file)
    }
    bytes[i] = item.value
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return {
      type: 'tuple',
      items: [
        { type: 'string', value: text },
        { type: 'option', tag: 'none' },
      ],
    }
  } catch {
    return {
      type: 'tuple',
      items: [
        { type: 'string', value: '' },
        { type: 'option', tag: 'some', value: failError('invalid UTF-8') },
      ],
    }
  }
}

function visibleTestErr(value: ZeeValue): string | undefined {
  if (value.type === 'error') return value.message
  if (value.type === 'struct' && value.name === 'Fail') {
    const text = value.fields.text
    if (text?.type === 'string') return text.value
  }
  if (value.type === 'option' && value.tag === 'some') {
    return visibleTestErr(value.value) ?? display(value.value)
  }
  if (value.type === 'tuple' && value.items.length > 0) {
    return visibleTestErr(value.items[value.items.length - 1]!)
  }
  return undefined
}

function formatPrintf(
  args: ZeeValue[],
  loc: { file: string; line: number; column: number },
): string {
  const fmt = args[0]
  if (!fmt || fmt.type !== 'string') {
    throw new ZeeError('`printf` needs a format String', loc.line, loc.column, loc.file)
  }
  const values = args.slice(1)
  let out = ''
  let i = 0
  let vi = 0
  while (i < fmt.value.length) {
    const ch = fmt.value[i]!
    if (ch !== '%') {
      out += ch
      i += 1
      continue
    }
    const spec = fmt.value[i + 1]
    if (spec === undefined) {
      throw new ZeeError('truncated `%` in format', loc.line, loc.column, loc.file)
    }
    if (spec === '%') {
      out += '%'
      i += 2
      continue
    }
    const arg = values[vi]
    vi += 1
    if (arg === undefined) {
      throw new ZeeError('missing `printf` argument', loc.line, loc.column, loc.file)
    }
    if (spec === 's') {
      out += display(arg)
    } else if (spec === 'd') {
      if (!isIntValue(arg)) {
        throw new ZeeError('`%d` expects an integer', loc.line, loc.column, loc.file)
      }
      out += String(arg.value)
    } else if (spec === 'f') {
      if (!isFloatValue(arg)) {
        throw new ZeeError('`%f` expects a float', loc.line, loc.column, loc.file)
      }
      out += String(arg.value)
    } else if (spec === 'b') {
      if (arg.type !== 'bool') {
        throw new ZeeError('`%b` expects a bool', loc.line, loc.column, loc.file)
      }
      out += arg.value ? 'true' : 'false'
    } else {
      throw new ZeeError(`unknown format \`%${spec}\``, loc.line, loc.column, loc.file)
    }
    i += 2
  }
  if (vi !== values.length) {
    throw new ZeeError('extra `printf` argument', loc.line, loc.column, loc.file)
  }
  return out
}

export function display(value: ZeeValue): string {
  if (isIntValue(value)) return String(value.value)
  switch (value.type) {
    case 'bool':
      return value.value ? 'true' : 'false'
    case 'f32':
    case 'f64':
      return String(value.value)
    case 'string':
    case 'char':
      return value.value
    case 'regex':
      return `Regex(${value.source})`
    case 'unit':
      return '()'
    case 'error':
      return value.message
    case 'newtype':
      return `${value.name}(${display(value.inner)})`
    case 'newtypeCtor':
      return `fn ${value.name}`
    case 'option':
      return value.tag === 'none' ? 'None' : `Some(${display(value.value)})`
    case 'tuple':
      return `(${value.items.map(display).join(', ')})`
    case 'array':
    case 'list':
      return `[${value.items.map(display).join(', ')}]`
    case 'map': {
      const body = [...value.entries.values()]
        .map((entry) => `${display(entry.key)}: ${display(entry.value)}`)
        .join(', ')
      return `{ ${body} }`
    }
    case 'struct': {
      const body = Object.entries(value.fields)
        .map(([name, field]) => `${name}: ${display(field)}`)
        .join(', ')
      return `${value.name} { ${body} }`
    }
    case 'enum':
      return `${value.name}.${value.variant}`
    case 'sealed': {
      const body = Object.entries(value.fields)
        .map(([name, field]) => `${name}: ${display(field)}`)
        .join(', ')
      return `${value.name}.${value.variant} { ${body} }`
    }
    case 'typeNs':
      return value.name
    case 'fn':
      return `fn ${value.name}`
    case 'closure':
      return 'fn'
    case 'builtin':
      return `fn ${value.name}`
    case 'module':
      return `module ${value.name}`
    case 'expect':
      return `expect(${display(value.value)})`
  }
}

function valuesEqual(left: ZeeValue, right: ZeeValue): boolean {
  if (isIntValue(left) && isIntValue(right)) {
    return left.type === right.type && intBigInt(left) === intBigInt(right)
  }
  if (left.type !== right.type) return false
  switch (left.type) {
    case 'bool':
    case 'string':
    case 'char':
      return right.type === left.type && left.value === right.value
    case 'f32':
    case 'f64':
      return right.type === left.type && left.value === right.value
    case 'unit':
      return true
    case 'error':
      return right.type === 'error' && left.message === right.message
    case 'newtype':
      return (
        right.type === 'newtype' &&
        left.name === right.name &&
        left.module === right.module &&
        valuesEqual(left.inner, right.inner)
      )
    case 'newtypeCtor':
      return right.type === 'newtypeCtor' && left.name === right.name && left.module === right.module
    case 'option':
      if (right.type !== 'option') return false
      if (left.tag === 'none') return right.tag === 'none'
      return right.tag === 'some' && valuesEqual(left.value, right.value)
    case 'tuple':
      return (
        right.type === 'tuple' &&
        left.items.length === right.items.length &&
        left.items.every((item, index) => valuesEqual(item, right.items[index]!))
      )
    case 'array':
      return false
    case 'list':
      return (
        right.type === 'list' &&
        left.items.length === right.items.length &&
        left.items.every((item, index) => valuesEqual(item, right.items[index]!))
      )
    case 'map': {
      if (right.type !== 'map' || left.entries.size !== right.entries.size) return false
      for (const [hashed, entry] of left.entries) {
        const other = right.entries.get(hashed)
        if (!other || !valuesEqual(entry.value, other.value)) return false
      }
      return true
    }
    case 'struct':
      if (right.type !== 'struct' || left.name !== right.name || !left.data) return false
      return Object.keys(left.fields).every((name) =>
        valuesEqual(left.fields[name]!, right.fields[name]!),
      )
    case 'enum':
      return (
        right.type === 'enum' &&
        left.name === right.name &&
        left.module === right.module &&
        left.variant === right.variant
      )
    case 'sealed':
      if (right.type !== 'sealed' || left.name !== right.name || left.module !== right.module) {
        return false
      }
      if (!left.data || !right.data || left.variant !== right.variant) return false
      return Object.keys(left.fields).every((name) =>
        valuesEqual(left.fields[name]!, right.fields[name]!),
      )
    case 'fn':
    case 'closure':
    case 'builtin':
    case 'module':
    case 'typeNs':
    case 'expect':
      return false
    default:
      return false
  }
}

function evalCopy(
  expr: Extract<Expr, { kind: 'copy' }>,
  env: Env,
  io: RuntimeIo,
): ZeeValue {
  const target = evalExpr(expr.target, env, io)
  if (target.type !== 'struct' || !target.data) {
    throw new ZeeError(
      '`copy` is only defined on `data` struct and `data` class',
      expr.loc.line,
      expr.loc.column,
      expr.loc.file,
    )
  }
  const fields: Record<string, ZeeValue> = {}
  for (const [name, field] of Object.entries(target.fields)) {
    fields[name] = copyValue(field)
  }
  for (const field of expr.fields) {
    fields[field.name] = copyValue(evalExpr(field.value, env, io))
  }
  return { ...target, fields }
}

function copyValue(value: ZeeValue): ZeeValue {
  if ((value.type === 'struct' || value.type === 'sealed') && value.identity) {
    return value
  }
  if (value.type === 'struct' || value.type === 'sealed') {
    const fields: Record<string, ZeeValue> = {}
    for (const [name, field] of Object.entries(value.fields)) {
      fields[name] = copyValue(field)
    }
    return { ...value, fields }
  }
  if (value.type === 'tuple') {
    return { type: 'tuple', items: value.items.map(copyValue) }
  }
  if (value.type === 'option' && value.tag === 'some') {
    return { type: 'option', tag: 'some', value: copyValue(value.value) }
  }
  if (value.type === 'newtype') {
    return { ...value, inner: copyValue(value.inner) }
  }
  if (value.type === 'expect') {
    return { type: 'expect', value: copyValue(value.value), negated: value.negated }
  }
  return value
}

function typeOfValue(value: ZeeValue): ZeeType {
  if (isIntValue(value)) return { kind: value.type }
  switch (value.type) {
    case 'bool':
      return { kind: 'bool' }
    case 'string':
      return { kind: 'string' }
    case 'regex':
      return { kind: 'regex' }
    case 'char':
      return { kind: 'char' }
    case 'f32':
    case 'f64':
      return { kind: value.type }
    case 'unit':
      return { kind: 'unit' }
    case 'error':
      return {
        kind: 'struct',
        name: 'Fail',
        module: '',
        data: true,
        readonly: false,
        identity: false,
        fields: [{ name: 'text', type: { kind: 'string' }, mutable: false, visibility: 'pub', file: '<builtin>' }],
        implements: [],
      }
    case 'newtype':
      return {
        kind: 'newtype',
        name: value.name,
        module: value.module,
        inner: typeOfValue(value.inner),
        implements: [],
      }
    case 'newtypeCtor':
      return { kind: 'fn', params: [], ret: { kind: 'unit' } }
    case 'option':
      return {
        kind: 'option',
        inner: value.tag === 'some' ? typeOfValue(value.value) : { kind: 'unit' },
      }
    case 'tuple':
      return { kind: 'tuple', parts: value.items.map(typeOfValue) }
    case 'array':
      return { kind: 'array', elem: value.elem }
    case 'list':
      return { kind: 'list', elem: value.elem }
    case 'map':
      return { kind: 'map', key: value.key, value: value.value }
    case 'struct': {
      const info = value
      return {
        kind: 'struct',
        name: info.name,
        module: info.module,
        data: info.data,
        readonly: info.readonly,
        identity: info.identity,
        fields: Object.keys(info.fields).map((name) => ({
          name,
          type: typeOfValue(info.fields[name]!),
          mutable: info.fieldMut[name] ?? false,
          visibility: 'private' as const,
          file: '',
        })),
        implements: [],
      }
    }
    case 'enum':
      return { kind: 'enum', name: value.name, module: value.module, variants: [], implements: [] }
    case 'sealed':
      return {
        kind: 'sealed',
        name: value.name,
        module: value.module,
        identity: value.identity,
        variants: [],
        implements: [],
      }
    case 'typeNs':
      if (value.tag === 'enum') {
        return { kind: 'enum', name: value.name, module: value.module, variants: value.variants, implements: [] }
      }
      if (value.tag === 'struct') {
        return {
          kind: 'struct',
          name: value.name,
          module: value.module,
          data: false,
          readonly: false,
          identity: false,
          fields: [],
          implements: [],
        }
      }
      return {
        kind: 'sealed',
        name: value.name,
        module: value.module,
        identity: value.identity,
        variants: [],
        implements: [],
      }
    case 'fn':
    case 'closure':
    case 'builtin':
      return { kind: 'fn', params: [], ret: { kind: 'unit' } }
    case 'module':
      return { kind: 'module', name: value.name }
    case 'expect':
      return { kind: 'expect', inner: typeOfValue(value.value) }
  }
}

function zeroValue(type: ZeeType, loc: { file: string; line: number; column: number }): ZeeValue {
  if (isIntKind(type.kind)) return intValue(type.kind, 0n)
  switch (type.kind) {
    case 'bool':
      return { type: 'bool', value: false }
    case 'string':
      return { type: 'string', value: '' }
    case 'char':
      return { type: 'char', value: '\0' }
    case 'f32':
    case 'f64':
      return floatValue(type.kind, 0)
    case 'option':
      return { type: 'option', tag: 'none' }
    case 'unit':
      return UNIT
    default:
      throw new ZeeError(
        `cannot grow array of ${typeName(type)}; no dummy value`,
        loc.line,
        loc.column,
        loc.file,
      )
  }
}

function indexNumber(
  value: ZeeValue,
  loc: { file: string; line: number; column: number },
): number {
  if (!isIntValue(value) || value.type !== 'usize') {
    throw new ZeeError('index requires usize', loc.line, loc.column, loc.file)
  }
  return Number(intBigInt(value))
}

function isIntValue(
  value: ZeeValue,
): value is Extract<ZeeValue, { type: IntKind }> {
  return (INT_KINDS as readonly string[]).includes(value.type)
}

function isFloatValue(value: ZeeValue): value is Extract<ZeeValue, { type: FloatKind }> {
  return value.type === 'f32' || value.type === 'f64'
}

function floatValue(kind: FloatKind, n: number): ZeeValue {
  return { type: kind, value: kind === 'f32' ? Math.fround(n) : n }
}

function toFloatValue(
  kind: FloatKind,
  value: ZeeValue,
  loc: { file: string; line: number; column: number },
): ZeeValue {
  if (value.type === 'newtype') return toFloatValue(kind, value.inner, loc)
  if (isIntValue(value)) return floatValue(kind, Number(intBigInt(value)))
  if (isFloatValue(value)) return floatValue(kind, value.value)
  throw new ZeeError(`cannot convert this value to ${kind}`, loc.line, loc.column, loc.file)
}

function narrowFloatToInt(n: number, target: IntKind): ZeeValue {
  if (!Number.isFinite(n)) return { type: 'option', tag: 'none' }
  let bits: bigint
  try {
    bits = BigInt(Math.trunc(n))
  } catch {
    return { type: 'option', tag: 'none' }
  }
  if (!intFits(bits, target)) return { type: 'option', tag: 'none' }
  return { type: 'option', tag: 'some', value: intValue(target, bits) }
}

function intBigInt(value: Extract<ZeeValue, { type: IntKind }>): bigint {
  return typeof value.value === 'bigint' ? value.value : BigInt(value.value)
}

function intValue(kind: IntKind, n: bigint): ZeeValue {
  if (kind === 'i64' || kind === 'u64' || kind === 'isize' || kind === 'usize') {
    return { type: kind, value: n }
  }
  return { type: kind, value: Number(n) }
}

function intChecked(
  kind: IntKind,
  n: bigint,
  loc: { file: string; line: number; column: number },
): ZeeValue {
  if (!intFits(n, kind)) {
    throw new ZeeError('integer overflow', loc.line, loc.column, loc.file)
  }
  return intValue(kind, n)
}

function intWrap(kind: IntKind, n: bigint): ZeeValue {
  const bits = BigInt(intBits(kind))
  const mask = (1n << bits) - 1n
  let wrapped = n & mask
  if (intSigned(kind)) {
    const sign = 1n << (bits - 1n)
    wrapped = (wrapped ^ sign) - sign
  }
  return intValue(kind, wrapped)
}

function shiftAmount(
  kind: IntKind,
  count: ZeeValue,
  loc: { file: string; line: number; column: number },
  wrapping: boolean,
): bigint {
  if (!isIntValue(count)) {
    throw new ZeeError('shift count must be an integer', loc.line, loc.column, loc.file)
  }
  const bits = BigInt(intBits(kind))
  const n = intBigInt(count)
  if (wrapping) {
    const widthMask = (1n << bits) - 1n
    return (n & widthMask) & (bits - 1n)
  }
  if (n < 0n || n >= bits) {
    throw new ZeeError('shift count is out of range', loc.line, loc.column, loc.file)
  }
  return n
}

function bindWrapCall(
  expr: Extract<Expr, { kind: 'call' }>,
  env: Env,
  io: RuntimeIo,
): () => ZeeValue {
  const name = expr.callee.kind === 'member' ? expr.callee.field : ''
  if (name !== 'add' && name !== 'sub' && name !== 'mul' && name !== 'shl') {
    throw new ZeeError(
      `undefined name \`${name}\` on module \`wrap\``,
      expr.loc.line,
      expr.loc.column,
      expr.loc.file,
    )
  }
  if (expr.args.length !== 2) {
    throw new ZeeError(
      `\`wrap.${name}\` takes two arguments`,
      expr.loc.line,
      expr.loc.column,
      expr.loc.file,
    )
  }
  const left = evalExpr(expr.args[0]!, env, io)
  const right = evalExpr(expr.args[1]!, env, io)
  return () => {
    if (!isIntValue(left) || !isIntValue(right) || left.type !== right.type) {
      throw new ZeeError(
        `\`wrap.${name}\` expects integers`,
        expr.loc.line,
        expr.loc.column,
        expr.loc.file,
      )
    }
    const kind = left.type
    const l = intBigInt(left)
    const r = intBigInt(right)
    if (name === 'add') return intWrap(kind, l + r)
    if (name === 'sub') return intWrap(kind, l - r)
    if (name === 'mul') return intWrap(kind, l * r)
    return intWrap(kind, l << shiftAmount(kind, right, expr.loc, true))
  }
}

function intKindFromTypeAst(ast: TypeAst): IntKind {
  if (ast.kind !== 'named' || !isIntKind(ast.name)) {
    throw new ZeeError(`expected integer type, got \`${ast.kind}\``, ast.loc.line, ast.loc.column, ast.loc.file)
  }
  return ast.name
}

function mergedJsonSubst(): Map<string, JsonTarget> {
  const merged = new Map<string, JsonTarget>()
  for (const layer of jsonTypeSubst) {
    for (const [name, target] of layer) merged.set(name, target)
  }
  return merged
}

function reflectFields(value: ZeeValue, env: Env): ZeeValue {
  if (value.type !== 'struct') return { type: 'list', items: [], elem: T_STORED_FIELD }
  const info = structInfoFor(value, env)
  const specs =
    value.fieldMeta ??
    info?.fields ??
    Object.keys(value.fields).map((name) => ({ name, attributes: [] }))
  const items: ZeeValue[] = specs.map((spec) => {
    const current = value.fields[spec.name]
    const attrs: ZeeValue[] = (spec.attributes ?? []).map((attr) => ({
      type: 'tuple',
      items: [
        { type: 'string', value: attr.name },
        {
          type: 'list',
          items: attr.args.map((arg) => ({ type: 'string' as const, value: arg })),
          elem: T_STRING,
        },
      ],
    }))
    let text: ZeeValue = { type: 'option', tag: 'none' }
    let intSlot: ZeeValue = { type: 'option', tag: 'none' }
    if (current?.type === 'string') {
      text = { type: 'option', tag: 'some', value: current }
    } else if (current && isIntKind(current.type)) {
      const n = typeof current.value === 'bigint' ? current.value : BigInt(current.value)
      if (n >= -2147483648n && n <= 2147483647n) {
        intSlot = { type: 'option', tag: 'some', value: intValue('i32', n) }
      }
    }
    return {
      type: 'tuple',
      items: [
        { type: 'string', value: spec.name },
        text,
        intSlot,
        { type: 'list', items: attrs, elem: T_STORED_ATTR },
      ],
    }
  })
  return { type: 'list', items, elem: T_STORED_FIELD }
}

function runRegexOf(
  pattern: ZeeValue,
  loc: { file: string; line: number; column: number },
): ZeeValue {
  if (pattern.type !== 'string') {
    throw new ZeeError('`Regex.of` expects a String', loc.line, loc.column, loc.file)
  }
  const compiled = compileRegex(pattern.value)
  const regex: ZeeValue = { type: 'regex', source: compiled.source, ok: compiled.ok }
  if (compiled.ok) {
    return { type: 'tuple', items: [regex, { type: 'option', tag: 'none' }] }
  }
  return {
    type: 'tuple',
    items: [
      regex,
      {
        type: 'option',
        tag: 'some',
        value: {
          type: 'struct',
          name: 'Fail',
          module: '',
          data: true,
          readonly: false,
          identity: false,
          fields: { text: { type: 'string', value: 'invalid regex' } },
          fieldMut: { text: false },
        },
      },
    ],
  }
}

function structInfoFor(value: ZeeValue, env: Env): StructInfo | undefined {
  if (value.type !== 'struct') return undefined
  const home = env.getModule(value.module)
  if (home) {
    const info = home.getStruct(value.name)
    if (info) return info
  }
  return env.getStruct(value.name)
}

function encodeJsonValue(value: ZeeValue, loc: { file: string; line: number; column: number }): ZeeValue {
  try {
    return { type: 'string', value: JSON.stringify(encodeZeeToJson(value)) }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'cannot encode JSON'
    throw new ZeeError(message, loc.line, loc.column, loc.file)
  }
}

function decodeJsonValue(
  text: ZeeValue,
  target: JsonTarget,
  loc: { file: string; line: number; column: number },
): ZeeValue {
  if (text.type !== 'string') {
    throw new ZeeError('`jsonDecode` expects a String', loc.line, loc.column, loc.file)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text.value)
  } catch {
    return {
      type: 'tuple',
      items: [dummyZeeValue(target), { type: 'option', tag: 'some', value: { type: 'error', message: 'invalid JSON' } }],
    }
  }
  const decoded = decodeJsonToZee(parsed, target)
  if (decoded.error) {
    return {
      type: 'tuple',
      items: [
        decoded.value,
        { type: 'option', tag: 'some', value: { type: 'error', message: decoded.error } },
      ],
    }
  }
  return { type: 'tuple', items: [decoded.value, { type: 'option', tag: 'none' }] }
}

function runHttpDispatch(
  router: ZeeValue,
  req: ZeeValue,
  env: Env,
  io: RuntimeIo,
  loc: { file: string; line: number; column: number },
): ZeeValue {
  const incoming = readHttpRequest(req)
  const requestBag = httpRequestValue(
    incoming.method,
    incoming.path,
    incoming.text,
    {},
    incoming.headers,
  )
  httpDispatchRequests.set(io, requestBag)
  try {
    return dispatchHttp(router, incoming, requestBag, env, io, loc)
  } finally {
    httpDispatchRequests.delete(io)
  }
}

function dispatchHttp(
  router: ZeeValue,
  incoming: ReturnType<typeof readHttpRequest>,
  requestBag: ZeeValue,
  env: Env,
  io: RuntimeIo,
  loc: { file: string; line: number; column: number },
): ZeeValue {
  const cors = httpCorsConfig(env, io, loc)
  const origin = headerGet(incoming.headers, 'Origin')
  if (cors && incoming.method.toUpperCase() === 'OPTIONS') {
    if (resolveCorsAllowOrigin(origin, cors)) {
      return applyCorsHeaders(httpResponseValue(200, ''), origin, cors)
    }
  }
  const matched = matchHttpRoute(router, incoming.method, incoming.path)
  if (matched.kind === 'static') {
    return withCors(httpResponseValue(200, matched.body), origin, cors)
  }
  if (matched.kind === 'resource') {
    const request = httpRequestValue(
      incoming.method,
      incoming.path,
      incoming.text,
      matched.params,
      incoming.headers,
    )
    httpDispatchRequests.set(io, request)
    const method = lookupRuntimeMethod(matched.controller, matched.verb, env)
    if (!method) {
      throw new ZeeError(
        `http resource is missing \`${matched.verb}\``,
        loc.line,
        loc.column,
        loc.file,
      )
    }
    const bound = bindHttpHandlerArgs(method, matched.controller, request, loc)
    if (bound.kind === 'bad') return withCors(bound.response, origin, cors)
    const invalid = validateHttpBoundArgs(method, bound.args, io, loc)
    if (invalid) return withCors(invalid, origin, cors)
    return withCors(callFn(method, bound.args, io, loc), origin, cors)
  }
  const decorated = matchDecoratedControllers(router, incoming.method, incoming.path, env, loc)
  if (!decorated) return withCors(httpResponseValue(404, 'not found'), origin, cors)
  const request = httpRequestValue(
    incoming.method,
    incoming.path,
    incoming.text,
    decorated.params,
    incoming.headers,
  )
  httpDispatchRequests.set(io, request)
  const method = lookupRuntimeMethod(decorated.controller, decorated.name, env)
  if (!method) {
    throw new ZeeError(`http controller is missing \`${decorated.name}\``, loc.line, loc.column, loc.file)
  }
  const bound = bindHttpHandlerArgs(method, decorated.controller, request, loc)
  if (bound.kind === 'bad') return withCors(bound.response, origin, cors)
  const invalid = validateHttpBoundArgs(method, bound.args, io, loc)
  if (invalid) return withCors(invalid, origin, cors)
  return withCors(callFn(method, bound.args, io, loc), origin, cors)
}

function runHttpFail(
  err: ZeeValue,
  env: Env,
  io: RuntimeIo,
  loc: { file: string; line: number; column: number },
): ZeeValue {
  const request = httpDispatchRequests.get(io) ?? httpRequestValue('GET', '/', '', {})
  const handle = findErrorHandler(env, loc)
  if (handle) return callFn(handle, [err, request], io, loc)
  const status = httpErrorStatus(err, env, io, loc)
  if (status !== undefined) {
    const text = err.type === 'struct' && err.fields.text?.type === 'string' ? err.fields.text.value : ''
    return httpResponseValue(status, text)
  }
  return httpResponseValue(500, errorMessage(err, env, io, loc))
}

function findErrorHandler(
  env: Env,
  loc: { file: string; line: number; column: number },
): Extract<ZeeValue, { type: 'fn' }> | undefined {
  let found: Extract<ZeeValue, { type: 'fn' }> | undefined
  for (const home of env.listModules()) {
    for (const info of home.ownStructs()) {
      if (info.attributes?.some((attr) => attr.name === 'Controller')) continue
      if (!info.attributes?.some((attr) => attr.name === 'ErrorHandler')) continue
      const ns = home.own(info.name)?.value
      if (!ns || ns.type !== 'typeNs') {
        throw new ZeeError('`@ErrorHandler` needs associated `handle`', loc.line, loc.column, loc.file)
      }
      const handle = ns.members.handle
      if (!handle || handle.type !== 'fn') {
        throw new ZeeError('`@ErrorHandler` needs associated `handle`', loc.line, loc.column, loc.file)
      }
      if (found) {
        throw new ZeeError('conflicting `@ErrorHandler`', loc.line, loc.column, loc.file)
      }
      found = handle
    }
  }
  return found
}

function httpErrorStatus(
  err: ZeeValue,
  env: Env,
  io: RuntimeIo,
  loc: { file: string; line: number; column: number },
): number | undefined {
  if (err.type !== 'struct' || err.name !== 'HttpError' || err.module !== 'http') return undefined
  const code = err.fields.code
  if (!code) return undefined
  const fn = lookupRuntimeMethod(code, 'code', env)
  if (!fn) return undefined
  const status = callFn(fn, [code], io, loc)
  return status.type === 'i32' ? status.value : undefined
}

function errorMessage(
  err: ZeeValue,
  env: Env,
  io: RuntimeIo,
  loc: { file: string; line: number; column: number },
): string {
  if (err.type === 'error') return err.message
  if (err.type === 'struct' && err.name === 'Fail' && err.fields.text?.type === 'string') {
    return err.fields.text.value
  }
  const method = lookupRuntimeMethod(err, 'message', env)
  if (method) {
    const text = callFn(method, [err], io, loc)
    if (text.type === 'string') return text.value
  }
  return 'error'
}

function httpCorsConfig(
  env: Env,
  io: RuntimeIo,
  loc: { file: string; line: number; column: number },
): CorsConfig | undefined {
  let found = false
  const allowedOrigins: string[] = []
  const allowedOriginPatterns: string[] = []
  for (const home of env.listModules()) {
    for (const info of home.ownStructs()) {
      if (info.attributes?.some((attr) => attr.name === 'Controller')) continue
      if (!info.attributes?.some((attr) => attr.name === 'Cors')) continue
      found = true
      const ns = home.own(info.name)?.value
      if (!ns || ns.type !== 'typeNs' || ns.tag !== 'struct') continue
      const propsFn = ns.members.properties
      if (!propsFn || propsFn.type !== 'fn') continue
      const props = callFn(propsFn, [], io, loc)
      if (props.type !== 'struct') continue
      allowedOrigins.push(...listStrings(props.fields.allowedOrigins))
      allowedOriginPatterns.push(...listStrings(props.fields.allowedOriginPatterns))
    }
  }
  return found ? { allowedOrigins, allowedOriginPatterns } : undefined
}

function listStrings(value: ZeeValue | undefined): string[] {
  if (value?.type !== 'list') return []
  const out: string[] = []
  for (const item of value.items) {
    if (item.type === 'string') out.push(item.value)
  }
  return out
}

function withCors(res: ZeeValue, origin: string | undefined, cors: CorsConfig | undefined): ZeeValue {
  if (!cors) return res
  return applyCorsHeaders(res, origin, cors)
}

function matchDecoratedControllers(
  router: ZeeValue,
  method: string,
  path: string,
  env: Env,
  loc: { file: string; line: number; column: number },
): { controller: ZeeValue; name: string; params: Record<string, string> } | undefined {
  if (router.type !== 'struct') return undefined
  const controllers = router.fields.controllers
  if (controllers?.type !== 'list') return undefined
  const verb = method.toUpperCase()
  const modulesPrefix = httpModulesPathPrefix(env, loc)
  for (const controller of controllers.items) {
    if (controller.type !== 'struct' && controller.type !== 'sealed') continue
    const home = env.getModule(controller.module) ?? env
    const info = home.getStruct(controller.name)
    const typePrefix = info?.attributes?.find((attr) => attr.name === 'Controller')?.args[0]
    const prefix =
      modulesPrefix && isUnderModulesContainer(info?.file ?? '')
        ? joinHttpPath(modulesPrefix, typePrefix ?? '/')
        : typePrefix
    for (const fn of home.methodsOf(controller.name)) {
      const route = httpRouteFromAttributes(fn.attributes, prefix)
      if (!route || route.verb !== verb) continue
      const params = matchHttpPattern(route.path, path)
      if (params) return { controller, name: fn.name, params }
    }
  }
  return undefined
}

function httpModulesPathPrefix(
  env: Env,
  loc: { file: string; line: number; column: number },
): string | undefined {
  let prefix: string | undefined
  for (const home of env.listModules()) {
    for (const info of home.ownStructs()) {
      if (info.attributes?.some((attr) => attr.name === 'Controller')) continue
      const attr = info.attributes?.find((item) => item.name === 'PathPrefix')
      if (!attr) continue
      const value = attr.args[0]
      if (!value) {
        throw new ZeeError('`@PathPrefix` needs a path', loc.line, loc.column, loc.file)
      }
      if (prefix !== undefined && prefix !== value) {
        throw new ZeeError(
          `conflicting \`@PathPrefix\` (\`${prefix}\` vs \`${value}\`)`,
          loc.line,
          loc.column,
          loc.file,
        )
      }
      prefix = value
    }
  }
  return prefix
}

function isUnderModulesContainer(file: string): boolean {
  const parts = file.split(/[/\\]/)
  for (let i = 0; i < parts.length - 1; i++) {
    if ((parts[i] === 'src' || parts[i] === TEST_CONTAINER) && parts[i + 1] === MODULES_CONTAINER) {
      return true
    }
  }
  return false
}

function buildHttpApp(
  env: Env,
  io: RuntimeIo,
  loc: { file: string; line: number; column: number },
): ZeeValue {
  const routerFn = env.getModule('http')?.own('router')?.value
  if (!routerFn || routerFn.type !== 'fn') {
    throw new ZeeError('`http.app` needs `http.router`', loc.line, loc.column, loc.file)
  }
  let router = callFn(routerFn, [], io, loc)
  httpModulesPathPrefix(env, loc)
  const beans = new Map<string, ZeeValue>()
  const visiting = new Set<string>()
  for (const home of env.listModules()) {
    for (const info of home.ownStructs()) {
      if (!info.attributes?.some((attr) => attr.name === 'Controller')) continue
      const instance = constructHttpBean(info.name, info.module, env, io, loc, beans, visiting)
      router = mountHttpController(router, instance)
    }
  }
  return router
}

function beanKey(module: string, name: string): string {
  return `${module}\0${name}`
}

function constructHttpBean(
  name: string,
  module: string,
  env: Env,
  io: RuntimeIo,
  loc: { file: string; line: number; column: number },
  beans: Map<string, ZeeValue>,
  visiting: Set<string>,
): ZeeValue {
  const key = beanKey(module, name)
  const cached = beans.get(key)
  if (cached) return cached
  if (visiting.has(key)) {
    throw new ZeeError(`http bean cycle involving \`${name}\``, loc.line, loc.column, loc.file)
  }
  visiting.add(key)
  const home = env.getModule(module)
  const ns = home?.own(name)?.value
  if (!ns || ns.type !== 'typeNs' || ns.tag !== 'struct') {
    throw new ZeeError(`cannot construct http bean \`${name}\``, loc.line, loc.column, loc.file)
  }
  const ofFn = ns.members.of
  const emptyFn = ns.members.empty
  let instance: ZeeValue
  if (ofFn?.type === 'fn') {
    const args: ZeeValue[] = []
    for (const param of ofFn.paramMeta ?? []) {
      if (param.type.kind !== 'named') {
        throw new ZeeError(
          `http bean \`${name}.of\` needs a named type for \`${param.name}\``,
          loc.line,
          loc.column,
          loc.file,
        )
      }
      const dep = ofFn.env.getStruct(param.type.name)
      if (!dep) {
        throw new ZeeError(
          `unknown http bean type \`${param.type.name}\` for \`${name}.of\``,
          loc.line,
          loc.column,
          loc.file,
        )
      }
      args.push(constructHttpBean(dep.name, dep.module, env, io, loc, beans, visiting))
    }
    instance = callFn(ofFn, args, io, loc)
  } else if (emptyFn?.type === 'fn') {
    instance = callFn(emptyFn, [], io, loc)
  } else {
    throw new ZeeError(
      `http bean \`${name}\` needs associated \`of\` or \`empty\``,
      loc.line,
      loc.column,
      loc.file,
    )
  }
  beans.set(key, instance)
  visiting.delete(key)
  return instance
}

function mountHttpController(router: ZeeValue, instance: ZeeValue): ZeeValue {
  if (router.type !== 'struct') return router
  const existing = router.fields.controllers
  const items = existing?.type === 'list' ? [...existing.items, instance] : [instance]
  const elem = existing?.type === 'list' ? existing.elem : { kind: 'named' as const, name: 'Handler' }
  return {
    ...router,
    fields: {
      ...router.fields,
      controllers: { type: 'list', items, elem },
    },
  }
}

const HTTP_VERBS = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete'])

function runtimeParamMeta(
  params: { name: string; type: TypeAst; attributes?: { name: string; args: string[] }[] }[],
): { name: string; type: TypeAst; attributes?: { name: string; args: string[] }[] }[] {
  return params.map((param) => ({ name: param.name, type: param.type, attributes: param.attributes }))
}

function bindHttpHandlerArgs(
  fn: Extract<ZeeValue, { type: 'fn' }>,
  controller: ZeeValue,
  request: ZeeValue,
  loc: { file: string; line: number; column: number },
): { kind: 'ok'; args: ZeeValue[] } | { kind: 'bad'; response: ZeeValue } {
  const meta = fn.paramMeta
  if (!meta) return { kind: 'ok', args: [controller, request] }
  const args: ZeeValue[] = []
  for (const param of meta) {
    if (param.name === 'self') {
      args.push(controller)
      continue
    }
    const bound = bindHttpParam(param, request, fn.env, loc)
    if (bound.kind === 'bad') return bound
    args.push(bound.value)
  }
  return { kind: 'ok', args }
}

function validateHttpBoundArgs(
  fn: Extract<ZeeValue, { type: 'fn' }>,
  args: ZeeValue[],
  io: RuntimeIo,
  loc: { file: string; line: number; column: number },
): ZeeValue | undefined {
  if (!fn.attributes?.some((attr) => attr.name === 'Valid')) return undefined
  const validateFn = lookupClassValidatorValidate(fn.env)
  if (!validateFn) {
    throw new ZeeError('`@Valid` needs the classValidator package', loc.line, loc.column, loc.file)
  }
  const meta = fn.paramMeta ?? []
  const hits: ZeeValue[] = []
  for (let i = 0; i < args.length; i++) {
    if (meta[i]?.name === 'self') continue
    const value = args[i]!
    if (value.type !== 'struct' || value.identity) continue
    const result = callFn(validateFn, [value], io, loc)
    if (result.type === 'list') hits.push(...result.items)
  }
  if (hits.length === 0) return undefined
  return httpResponseValue(422, JSON.stringify({ issues: hits.map(encodeZeeToJson) }))
}

function lookupClassValidatorValidate(env: Env): Extract<ZeeValue, { type: 'fn' }> | undefined {
  const slot = env.getModule('classValidator')?.own('validate')?.value
  if (slot?.type === 'fn') return slot
  return undefined
}

function bindHttpParam(
  param: { name: string; type: TypeAst; attributes?: { name: string; args: string[] }[] },
  request: ZeeValue,
  env: Env,
  loc: { file: string; line: number; column: number },
): { kind: 'ok'; value: ZeeValue } | { kind: 'bad'; response: ZeeValue } {
  const attr = param.attributes?.find((item) =>
    item.name === 'Param' ||
    item.name === 'Params' ||
    item.name === 'Query' ||
    item.name === 'Body' ||
    item.name === 'Request',
  )
  const name = attr?.name ?? (isRequestType(param.type) ? 'Request' : undefined)
  if (name === 'Request') return { kind: 'ok', value: request }
  if (name === 'Params') return { kind: 'ok', value: requestMapField(request, 'params') }
  if (name === 'Query' && (attr?.args.length ?? 0) === 0) {
    return { kind: 'ok', value: requestMapField(request, 'query') }
  }
  if (name === 'Param') {
    const key = attr?.args[0]
    if (!key) return { kind: 'bad', response: httpResponseValue(400, 'bad id') }
    const raw = stringFromMap(requestMapField(request, 'params'), key)
    if (raw === undefined) return { kind: 'bad', response: httpResponseValue(400, 'bad id') }
    return coerceHttpScalar(raw, param.type, 'bad id')
  }
  if (name === 'Query') {
    const key = attr?.args[0]
    if (!key) return { kind: 'ok', value: requestMapField(request, 'query') }
    const raw = stringFromMap(requestMapField(request, 'query'), key)
    if (raw === undefined) return { kind: 'bad', response: httpResponseValue(400, 'missing query') }
    return coerceHttpScalar(raw, param.type, 'missing query')
  }
  if (name === 'Body') {
    const text = request.type === 'struct' && request.fields.text?.type === 'string'
      ? request.fields.text
      : { type: 'string' as const, value: '' }
    const decoded = decodeJsonValue(text, resolveJsonTarget(param.type, env, mergedJsonSubst(), loc), loc)
    if (decoded.type !== 'tuple' || decoded.items.length < 2) {
      return { kind: 'bad', response: httpResponseValue(400, 'invalid json') }
    }
    const err = decoded.items[1]!
    if (err.type === 'option' && err.tag === 'some') {
      return { kind: 'bad', response: httpResponseValue(400, 'invalid json') }
    }
    return { kind: 'ok', value: decoded.items[0]! }
  }
  return { kind: 'ok', value: request }
}

function isRequestType(type: TypeAst): boolean {
  return type.kind === 'named' && type.name === 'Request'
}

function requestMapField(request: ZeeValue, field: 'params' | 'query'): ZeeValue {
  if (request.type !== 'struct') {
    return { type: 'map', entries: new Map(), key: { kind: 'string' }, value: { kind: 'string' } }
  }
  const value = request.fields[field]
  if (value?.type === 'map') return value
  return { type: 'map', entries: new Map(), key: { kind: 'string' }, value: { kind: 'string' } }
}

function stringFromMap(map: ZeeValue, key: string): string | undefined {
  if (map.type !== 'map') return undefined
  const entry = map.entries.get(`str:${JSON.stringify(key)}`)
  return entry?.value.type === 'string' ? entry.value.value : undefined
}

function coerceHttpScalar(
  raw: string,
  type: TypeAst,
  bad: string,
): { kind: 'ok'; value: ZeeValue } | { kind: 'bad'; response: ZeeValue } {
  if (type.kind === 'named' && type.name === 'String') {
    return { kind: 'ok', value: { type: 'string', value: raw } }
  }
  if (type.kind === 'named' && type.name === 'i32') {
    const n = Number(raw)
    if (!Number.isInteger(n)) return { kind: 'bad', response: httpResponseValue(400, bad) }
    return { kind: 'ok', value: { type: 'i32', value: n } }
  }
  return { kind: 'ok', value: { type: 'string', value: raw } }
}

function httpRouteFromAttributes(
  attributes: { name: string; args: string[] }[] | undefined,
  prefix?: string,
): { verb: string; path: string } | undefined {
  const attr = attributes?.find((item) => HTTP_VERBS.has(item.name))
  if (!attr) return undefined
  return { verb: attr.name.toUpperCase(), path: joinHttpPath(prefix, attr.args[0] ?? '/') }
}

function joinHttpPath(prefix: string | undefined, path: string): string {
  const base = normalizeHttpPath(prefix ?? '/')
  const rest = path.length === 0 || path === '/' ? '' : path.startsWith('/') ? path : `/${path}`
  if (rest.length === 0) return base
  if (base === '/') return normalizeHttpPath(rest)
  return normalizeHttpPath(base + rest)
}

function normalizeHttpPath(path: string): string {
  if (path.length === 0) return '/'
  const withSlash = path.startsWith('/') ? path : `/${path}`
  if (withSlash.length > 1 && withSlash.endsWith('/')) return withSlash.slice(0, -1)
  return withSlash
}

function matchHttpPattern(pattern: string, pathname: string): Record<string, string> | undefined {
  const path = pathname.includes('?') ? pathname.slice(0, pathname.indexOf('?')) : pathname
  const patternParts = normalizeHttpPath(pattern).split('/').filter((part) => part.length > 0)
  const pathParts = normalizeHttpPath(path).split('/').filter((part) => part.length > 0)
  if (patternParts.length !== pathParts.length) return undefined
  const params: Record<string, string> = {}
  for (let i = 0; i < patternParts.length; i++) {
    const expected = patternParts[i]!
    const got = pathParts[i]!
    if (expected.startsWith(':')) {
      params[expected.slice(1)] = got
      continue
    }
    if (expected !== got) return undefined
  }
  return params
}

function resolveJsonTarget(
  ast: TypeAst,
  env: Env,
  subst: Map<string, JsonTarget>,
  loc: { file: string; line: number; column: number },
): JsonTarget {
  if (ast.kind === 'named') {
    const mapped = subst.get(ast.name)
    if (mapped) return mapped
    if (isIntKind(ast.name)) return { tag: 'int', kind: ast.name }
    if (isFloatKind(ast.name)) return { tag: 'float', kind: ast.name }
    if (ast.name === 'String') return { tag: 'string' }
    if (ast.name === 'bool') return { tag: 'bool' }
    if (ast.name === 'Char') return { tag: 'char' }
    const info = env.getStruct(ast.name)
    if (info) {
      return {
        tag: 'struct',
        name: info.name,
        module: info.module,
        data: info.data,
        readonly: info.readonly,
        identity: info.identity,
        fields: info.fields.map((field) => {
          if (!field.type) {
            throw new ZeeError(
              `cannot decode JSON as \`${info.name}\``,
              loc.line,
              loc.column,
              loc.file,
            )
          }
          return {
            name: field.name,
            mutable: field.mutable,
            type: resolveJsonTarget(field.type, env, subst, loc),
          }
        }),
      }
    }
    throw new ZeeError(`cannot decode JSON as \`${ast.name}\``, ast.loc.line, ast.loc.column, ast.loc.file)
  }
  if (ast.kind === 'generic') {
    if (ast.name === 'Option' && ast.args.length === 1) {
      return { tag: 'option', inner: resolveJsonTarget(ast.args[0]!, env, subst, loc) }
    }
    if (ast.name === 'List' && ast.args.length === 1) {
      return { tag: 'list', elem: resolveJsonTarget(ast.args[0]!, env, subst, loc) }
    }
    if (ast.name === 'Map' && ast.args.length === 2) {
      const key = ast.args[0]!
      if (key.kind !== 'named' || key.name !== 'String') {
        throw new ZeeError('JSON object Map keys must be String', loc.line, loc.column, loc.file)
      }
      return { tag: 'map', value: resolveJsonTarget(ast.args[1]!, env, subst, loc) }
    }
  }
  if (ast.kind === 'array') {
    return { tag: 'array', elem: resolveJsonTarget(ast.elem, env, subst, loc) }
  }
  throw new ZeeError('cannot decode JSON as this type', ast.loc.line, ast.loc.column, ast.loc.file)
}
