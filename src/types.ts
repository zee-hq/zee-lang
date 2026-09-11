export const INT_KINDS = [
  'i8',
  'i16',
  'i32',
  'i64',
  'u8',
  'u16',
  'u32',
  'u64',
  'isize',
  'usize',
] as const

export type IntKind = (typeof INT_KINDS)[number]

export const FLOAT_KINDS = ['f32', 'f64'] as const

export type FloatKind = (typeof FLOAT_KINDS)[number]

export type StructFieldType = {
  name: string
  type: ZeeType
  mutable: boolean
  visibility: 'private' | 'internal' | 'pub'
  file: string
}

export type SealedVariantType = {
  name: string
  visibility: 'private' | 'internal' | 'pub'
  file: string
  data: boolean
  readonly: boolean
  fields: StructFieldType[]
}

export type EnumType = {
  kind: 'enum'
  name: string
  module: string
  variants: string[]
  implements: InterfaceType[]
}

export type NewtypeType = {
  kind: 'newtype'
  name: string
  module: string
  inner: ZeeType
  implements: InterfaceType[]
}

export type InterfaceMethodType = {
  name: string
  mutating: boolean
  params: ZeeType[]
  ret: ZeeType
}

export type InterfaceType = {
  kind: 'interface'
  name: string
  module: string
  sealed: boolean
  methods: InterfaceMethodType[]
  implementors: { name: string; module: string }[]
}

export type SealedType = {
  kind: 'sealed'
  name: string
  module: string
  identity: boolean
  variants: SealedVariantType[]
  implements: InterfaceType[]
}

export type ZeeType =
  | { kind: IntKind }
  | { kind: FloatKind }
  | { kind: 'bool' }
  | { kind: 'string' }
  | { kind: 'char' }
  | { kind: 'unit' }
  | { kind: 'option'; inner: ZeeType }
  | { kind: 'tuple'; parts: ZeeType[] }
  | { kind: 'fn'; params: ZeeType[]; ret: ZeeType; typeParams?: string[] }
  | { kind: 'never' }
  | { kind: 'array'; elem: ZeeType }
  | { kind: 'list'; elem: ZeeType }
  | { kind: 'map'; key: ZeeType; value: ZeeType }
  | {
      kind: 'struct'
      name: string
      module: string
      data: boolean
      readonly: boolean
      identity: boolean
      fields: StructFieldType[]
      implements: InterfaceType[]
    }
  | EnumType
  | SealedType
  | NewtypeType
  | InterfaceType
  | { kind: 'typeNs'; of: EnumType | SealedType | Extract<ZeeType, { kind: 'struct' }> }
  | { kind: 'module'; name: string }
  | { kind: 'typeParam'; name: string }
  | { kind: 'expect'; inner: ZeeType }

export const T_I32: ZeeType = { kind: 'i32' }
export const T_U8: ZeeType = { kind: 'u8' }
export const T_U32: ZeeType = { kind: 'u32' }
export const T_USIZE: ZeeType = { kind: 'usize' }
export const T_BOOL: ZeeType = { kind: 'bool' }
export const T_F32: ZeeType = { kind: 'f32' }
export const T_F64: ZeeType = { kind: 'f64' }
export const T_STRING: ZeeType = { kind: 'string' }
export const T_CHAR: ZeeType = { kind: 'char' }
export const T_UNIT: ZeeType = { kind: 'unit' }
export const T_ERROR: InterfaceType = {
  kind: 'interface',
  name: 'Error',
  module: '',
  sealed: false,
  methods: [{ name: 'message', mutating: false, params: [], ret: T_STRING }],
  implementors: [{ name: 'Fail', module: '' }],
}
export const T_FAIL: Extract<ZeeType, { kind: 'struct' }> = {
  kind: 'struct',
  name: 'Fail',
  module: '',
  data: true,
  readonly: false,
  identity: false,
  fields: [{ name: 'text', type: T_STRING, mutable: false, visibility: 'pub', file: '<builtin>' }],
  implements: [T_ERROR],
}
export const T_NEVER: ZeeType = { kind: 'never' }

const INT_KIND_SET = new Set<string>(INT_KINDS)

export function isIntKind(name: string): name is IntKind {
  return INT_KIND_SET.has(name)
}

export function isIntType(type: ZeeType): type is { kind: IntKind } {
  return isIntKind(type.kind)
}

const FLOAT_KIND_SET = new Set<string>(FLOAT_KINDS)

export function isFloatKind(name: string): name is FloatKind {
  return FLOAT_KIND_SET.has(name)
}

export function isFloatType(type: ZeeType): type is { kind: FloatKind } {
  return isFloatKind(type.kind)
}

export function isOrdType(type: ZeeType): boolean {
  if (type.kind === 'newtype') return isOrdType(type.inner)
  return isIntType(type) || type.kind === 'string' || type.kind === 'char' || type.kind === 'enum'
}

export function isNeverType(type: ZeeType): boolean {
  return type.kind === 'never'
}

export function isReceiverType(
  type: ZeeType,
): type is Extract<ZeeType, { kind: 'struct' | 'enum' | 'sealed' | 'newtype' }> {
  return type.kind === 'struct' || type.kind === 'enum' || type.kind === 'sealed' || type.kind === 'newtype'
}

export function isIdentityType(type: ZeeType): boolean {
  return (type.kind === 'struct' || type.kind === 'sealed') && type.identity
}

export function namedTypeKey(type: ZeeType): string | undefined {
  if (
    type.kind === 'struct' ||
    type.kind === 'enum' ||
    type.kind === 'sealed' ||
    type.kind === 'newtype' ||
    type.kind === 'interface'
  ) {
    return `${type.module}\0${type.name}`
  }
  return undefined
}

export function typeImplements(type: ZeeType, iface: InterfaceType): boolean {
  if (type.kind === 'interface') return typeEq(type, iface)
  if (
    type.kind === 'struct' ||
    type.kind === 'enum' ||
    type.kind === 'sealed' ||
    type.kind === 'newtype'
  ) {
    return type.implements.some((item) => typeEq(item, iface))
  }
  return false
}

export function isAssignable(from: ZeeType, to: ZeeType): boolean {
  if (isNeverType(from)) return true
  if (typeEq(from, to)) return true
  if (to.kind === 'interface') return typeImplements(from, to)
  return false
}

export function intSigned(kind: IntKind): boolean {
  return kind.startsWith('i')
}

export function intBits(kind: IntKind): number {
  switch (kind) {
    case 'i8':
    case 'u8':
      return 8
    case 'i16':
    case 'u16':
      return 16
    case 'i32':
    case 'u32':
      return 32
    case 'i64':
    case 'u64':
    case 'isize':
    case 'usize':
      return 64
  }
}

export function intMin(kind: IntKind): bigint {
  if (!intSigned(kind)) return 0n
  return -(1n << BigInt(intBits(kind) - 1))
}

export function intMax(kind: IntKind): bigint {
  const bits = BigInt(intBits(kind))
  if (!intSigned(kind)) return (1n << bits) - 1n
  return (1n << (bits - 1n)) - 1n
}

export function intFits(value: bigint, kind: IntKind): boolean {
  return value >= intMin(kind) && value <= intMax(kind)
}

/** Same signedness and from is no wider than to (equal width counts). AC-int-redim. */
export function canWidenInt(from: IntKind, to: IntKind): boolean {
  return intSigned(from) === intSigned(to) && intBits(from) <= intBits(to)
}

export function splitIntLiteral(lexeme: string): { digits: string; suffix?: IntKind } {
  const suffixes = [...INT_KINDS].sort((a, b) => b.length - a.length)
  for (const suffix of suffixes) {
    if (lexeme.length > suffix.length && lexeme.endsWith(suffix)) {
      const digits = lexeme.slice(0, -suffix.length)
      if (parseIntLexeme(digits) !== undefined) return { digits, suffix }
    }
  }
  return { digits: lexeme }
}

export function splitFloatLiteral(lexeme: string): { digits: string; suffix?: FloatKind } {
  for (const suffix of FLOAT_KINDS) {
    if (lexeme.length > suffix.length && lexeme.endsWith(suffix)) {
      const digits = lexeme.slice(0, -suffix.length)
      if (parseFloatLexeme(digits) !== undefined) return { digits, suffix }
    }
  }
  return { digits: lexeme }
}

export function parseFloatLexeme(lexeme: string): number | undefined {
  const cleaned = lexeme.replaceAll('_', '')
  if (cleaned.length === 0 || !/^\d+\.\d+$/.test(cleaned)) return undefined
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : undefined
}

export function parseIntLexeme(lexeme: string): bigint | undefined {
  const cleaned = lexeme.replaceAll('_', '')
  if (cleaned.length === 0 || cleaned.endsWith('_') || lexeme.includes('__')) return undefined
  if (lexeme.startsWith('_') || lexeme.includes('_x') || lexeme.includes('_X') || lexeme.includes('_b') || lexeme.includes('_B')) {
    return undefined
  }
  try {
    if (/^0[xX][0-9A-Fa-f]+$/.test(cleaned)) return BigInt(cleaned)
    if (/^0[bB][01]+$/.test(cleaned)) return BigInt(cleaned)
    if (/^\d+$/.test(cleaned)) return BigInt(cleaned)
  } catch {
    return undefined
  }
  return undefined
}

export function typeEq(a: ZeeType, b: ZeeType): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'fn' && b.kind === 'fn') {
    if ((a.typeParams?.length ?? 0) !== (b.typeParams?.length ?? 0)) return false
    if (a.typeParams && b.typeParams && !a.typeParams.every((name, index) => name === b.typeParams![index])) {
      return false
    }
    if (a.params.length !== b.params.length) return false
    if (!typeEq(a.ret, b.ret)) return false
    return a.params.every((param, index) => typeEq(param, b.params[index]!))
  }
  if (a.kind === 'tuple' && b.kind === 'tuple') {
    if (a.parts.length !== b.parts.length) return false
    return a.parts.every((part, index) => typeEq(part, b.parts[index]!))
  }
  if (a.kind === 'option' && b.kind === 'option') {
    return typeEq(a.inner, b.inner)
  }
  if (a.kind === 'array' && b.kind === 'array') {
    return typeEq(a.elem, b.elem)
  }
  if (a.kind === 'list' && b.kind === 'list') {
    return typeEq(a.elem, b.elem)
  }
  if (a.kind === 'map' && b.kind === 'map') {
    return typeEq(a.key, b.key) && typeEq(a.value, b.value)
  }
  if (a.kind === 'struct' && b.kind === 'struct') {
    return a.name === b.name && a.module === b.module
  }
  if (a.kind === 'enum' && b.kind === 'enum') {
    return a.name === b.name && a.module === b.module
  }
  if (a.kind === 'sealed' && b.kind === 'sealed') {
    return a.name === b.name && a.module === b.module
  }
  if (a.kind === 'newtype' && b.kind === 'newtype') {
    return a.name === b.name && a.module === b.module
  }
  if (a.kind === 'interface' && b.kind === 'interface') {
    return a.name === b.name && a.module === b.module
  }
  if (a.kind === 'typeNs' && b.kind === 'typeNs') {
    return typeEq(a.of, b.of)
  }
  if (a.kind === 'typeParam' && b.kind === 'typeParam') {
    return a.name === b.name
  }
  if (a.kind === 'expect' && b.kind === 'expect') {
    return typeEq(a.inner, b.inner)
  }
  return true
}

export function isEquatable(type: ZeeType): boolean {
  if (isIntType(type)) return true
  switch (type.kind) {
    case 'bool':
    case 'string':
    case 'char':
    case 'unit':
      return true
    case 'option':
      return isEquatable(type.inner)
    case 'tuple':
      return type.parts.every(isEquatable)
    case 'struct':
      return type.data && type.fields.every((field) => isEquatable(field.type))
    case 'enum':
      return true
    case 'newtype':
      return isEquatable(type.inner)
    case 'sealed':
      return (
        type.variants.length > 0 &&
        type.variants.every(
          (variant) => variant.data && variant.fields.every((field) => isEquatable(field.type)),
        )
      )
    case 'array':
    case 'fn':
    case 'never':
    case 'module':
    case 'typeNs':
    case 'interface':
    case 'typeParam':
    case 'f32':
    case 'f64':
      return false
    case 'list':
      return isEquatable(type.elem)
    case 'map':
      return isEquatable(type.key) && isEquatable(type.value)
    case 'expect':
      return false
  }
}

export function isHashable(type: ZeeType): boolean {
  if (type.kind === 'newtype') return isHashable(type.inner)
  if (isIntType(type)) return true
  return type.kind === 'bool' || type.kind === 'string' || type.kind === 'char' || type.kind === 'enum'
}

export function isInterpolable(type: ZeeType): boolean {
  return type.kind === 'string' || type.kind === 'char' || type.kind === 'bool' || isIntType(type)
}

export function typeName(type: ZeeType): string {
  if (isIntType(type) || isFloatType(type)) return type.kind
  switch (type.kind) {
    case 'bool':
      return 'bool'
    case 'string':
      return 'String'
    case 'char':
      return 'Char'
    case 'unit':
      return 'Unit'
    case 'option':
      return `Option<${typeName(type.inner)}>`
    case 'tuple':
      return `(${type.parts.map(typeName).join(', ')})`
    case 'fn': {
      const params = type.params.map(typeName).join(', ')
      return `(${params}) -> ${typeName(type.ret)}`
    }
    case 'never':
      return 'Never'
    case 'array':
      return `${typeName(type.elem)}[]`
    case 'list':
      return `List<${typeName(type.elem)}>`
    case 'map':
      return `Map<${typeName(type.key)}, ${typeName(type.value)}>`
    case 'struct':
    case 'enum':
    case 'sealed':
    case 'newtype':
    case 'interface':
      return type.module ? `${type.module}.${type.name}` : type.name
    case 'typeNs':
      return typeName(type.of)
    case 'module':
      return type.name
    case 'typeParam':
      return type.name
    case 'expect':
      return `expect(${typeName(type.inner)})`
  }
}

export function typeFromName(name: string): ZeeType | undefined {
  if (isIntKind(name) || isFloatKind(name)) return { kind: name }
  switch (name) {
    case 'bool':
      return T_BOOL
    case 'String':
      return T_STRING
    case 'Char':
      return T_CHAR
    case 'Unit':
      return T_UNIT
    case 'Error':
      return T_ERROR
    case 'Never':
      return T_NEVER
    default:
      return undefined
  }
}
