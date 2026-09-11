import { isAbsolute, relative, resolve } from 'node:path'
import type { AssignOp, Block, Expr, MatchPattern, Program, Stmt, TypeAst, Visibility } from './ast.ts'
import { PanicError, ZeeError } from './error.ts'
import { hostEnvFor, lookupEnv } from './host-env.ts'
import { isZeeTestFile } from './project.ts'
import type { DebugStop } from './debug.ts'
import {
  INT_KINDS,
  canWidenInt,
  intBits,
  intFits,
  intSigned,
  isFloatKind,
  isIntKind,
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
  | { type: 'fn'; name: string; params: string[]; body: Block; env: Env; mutatingReceiver: boolean }
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
  data: boolean
  readonly: boolean
  identity: boolean
  fields: { name: string; mutable: boolean }[]
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
  builtins.define('Some', { type: 'builtin', name: 'Some' })
  builtins.define('None', { type: 'option', tag: 'none' })
  builtins.defineStruct('Fail', {
    name: 'Fail',
    module: '',
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
    data: stmt.data,
    readonly: stmt.readonly,
    identity: stmt.identity,
    fields: stmt.fields.map((field) => ({ name: field.name, mutable: field.mutable })),
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
): ZeeValue | undefined {
  if (name === 'isEmpty' || name === 'isNotEmpty') {
    const empty = collectionEmpty(target)
    if (empty !== undefined) {
      if (args.length !== 0) {
        throw new ZeeError(`\`${name}\` takes no arguments`, loc.line, loc.column, loc.file)
      }
      return { type: 'bool', value: name === 'isEmpty' ? empty : !empty }
    }
  }
  if (target.type === 'list' || target.type === 'array') {
    const seq = callSeqMethod(target, name, args, io, loc)
    if (seq) return seq
  }
  if (target.type === 'list') {
    if (name === 'toArray') {
      return { type: 'array', items: target.items.map(copyValue), elem: target.elem }
    }
    if (name === 'map') {
      const mapped = target.items.map((item) => applyFnValue(args[0]!, [item], io, loc))
      const elem = mapped[0] ? typeOfValue(mapped[0]) : target.elem
      return { type: 'list', items: mapped, elem }
    }
    if (name === 'filter') {
      const items: ZeeValue[] = []
      for (const item of target.items) {
        const keep = applyFnValue(args[0]!, [item], io, loc)
        if (keep.type !== 'bool') {
          throw new ZeeError('`filter` expects `(T) -> bool`', loc.line, loc.column, loc.file)
        }
        if (keep.value) items.push(copyValue(item))
      }
      return { type: 'list', items, elem: target.elem }
    }
    if (name === 'forEach') {
      for (const item of target.items) {
        applyFnValue(args[0]!, [item], io, loc)
      }
      return UNIT
    }
    if (name === 'sort') {
      if (args.length !== 0) {
        throw new ZeeError('`sort` takes no arguments', loc.line, loc.column, loc.file)
      }
      const items = target.items.map(copyValue)
      items.sort((left, right) => compareOrd(left, right, loc))
      return { type: 'list', items, elem: target.elem }
    }
  }
  if (target.type === 'array' && name === 'toList') {
    return { type: 'list', items: target.items.map(copyValue), elem: target.elem }
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
    const target = evalExpr(expr.callee.target, env, io)
    const args = expr.args.map((arg) => evalExpr(arg, env, io))
    return () => invokeMemberCall(expr, target, args, env, io)
  }
  const callee = evalExpr(expr.callee, env, io)
  const args = expr.args.map((arg) => evalExpr(arg, env, io))
  return () => invokeValue(callee, args, io, expr.loc)
}

function invokeMemberCall(
  expr: Extract<Expr, { kind: 'call' }>,
  target: ZeeValue,
  args: ZeeValue[],
  env: Env,
  io: RuntimeIo,
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
  const builtin = callCollectionMethod(target, expr.callee.field, args, io, expr.loc)
  if (builtin) return builtin
  const method = lookupRuntimeMethod(target, expr.callee.field, env)
  if (method) {
    return callFn(method, [target, ...args], io, expr.loc)
  }
  return invokeValue(memberOnValue(target, expr.callee.field, env, expr.callee.loc), args, io, expr.loc)
}

function invokeValue(
  callee: ZeeValue,
  args: ZeeValue[],
  io: RuntimeIo,
  loc: { file: string; line: number; column: number },
): ZeeValue {
  if (callee.type === 'newtypeCtor') {
    if (args.length !== 1) {
      throw new ZeeError(`\`${callee.name}\` takes one argument`, loc.line, loc.column, loc.file)
    }
    return { type: 'newtype', name: callee.name, module: callee.module, inner: copyValue(args[0]!) }
  }
  if (callee.type === 'builtin') return callBuiltin(callee.name, args, io, loc)
  if (callee.type === 'fn') return callFn(callee, args, io, loc)
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
): ZeeValue {
  if (args.length !== fn.params.length) {
    throw new ZeeError(
      `\`${fn.name}\` expects ${fn.params.length} argument(s)`,
      loc.line,
      loc.column,
      loc.file,
    )
  }
  const local = fn.env.child()
  local.markFunctionFrame(fn.name)
  fn.params.forEach((name, index) => {
    const arg = args[index]!
    const shareSelf = fn.mutatingReceiver && index === 0
    local.define(name, shareSelf ? arg : copyValue(arg), shareSelf)
  })
  return runWithDefers(local, io, () => execBlock(fn.body, local, io))
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
