import { intFits, type FloatKind, type IntKind } from './types.ts'
import type { ZeeValue } from './interpreter.ts'
import type { ZeeType } from './types.ts'

export type JsonTarget =
  | { tag: 'int'; kind: IntKind }
  | { tag: 'float'; kind: FloatKind }
  | { tag: 'bool' }
  | { tag: 'string' }
  | { tag: 'char' }
  | { tag: 'option'; inner: JsonTarget }
  | { tag: 'list'; elem: JsonTarget }
  | { tag: 'array'; elem: JsonTarget }
  | { tag: 'map'; value: JsonTarget }
  | {
      tag: 'struct'
      name: string
      module: string
      data: boolean
      readonly: boolean
      identity: boolean
      fields: { name: string; mutable: boolean; type: JsonTarget }[]
    }

export function encodeZeeToJson(value: ZeeValue): unknown {
  switch (value.type) {
    case 'i8':
    case 'i16':
    case 'i32':
    case 'u8':
    case 'u16':
    case 'u32':
    case 'f32':
    case 'f64':
    case 'bool':
    case 'string':
      return value.value
    case 'i64':
    case 'u64':
    case 'isize':
    case 'usize':
      return jsonSafeInt(value.value)
    case 'char':
      return value.value
    case 'option':
      return value.tag === 'none' ? null : encodeZeeToJson(value.value)
    case 'list':
    case 'array':
      return value.items.map(encodeZeeToJson)
    case 'tuple':
      return value.items.map(encodeZeeToJson)
    case 'map': {
      const obj: Record<string, unknown> = {}
      for (const { key, value: item } of value.entries.values()) {
        if (key.type !== 'string') {
          throw new Error('JSON object keys must be String')
        }
        obj[key.value] = encodeZeeToJson(item)
      }
      return obj
    }
    case 'struct': {
      const obj: Record<string, unknown> = {}
      for (const [name, field] of Object.entries(value.fields)) {
        obj[name] = encodeZeeToJson(field)
      }
      return obj
    }
    case 'enum':
      return value.variant
    case 'newtype':
      return encodeZeeToJson(value.inner)
    default:
      throw new Error(`cannot encode ${value.type} as JSON`)
  }
}

export function dummyZeeValue(target: JsonTarget): ZeeValue {
  switch (target.tag) {
    case 'int':
      return intDummy(target.kind)
    case 'float':
      return { type: target.kind, value: 0 }
    case 'bool':
      return { type: 'bool', value: false }
    case 'string':
      return { type: 'string', value: '' }
    case 'char':
      return { type: 'char', value: '\u0000' }
    case 'option':
      return { type: 'option', tag: 'none' }
    case 'list':
      return { type: 'list', items: [], elem: dummyElemType(target.elem) }
    case 'array':
      return { type: 'array', items: [], elem: dummyElemType(target.elem) }
    case 'map':
      return { type: 'map', entries: new Map(), key: { kind: 'string' }, value: dummyElemType(target.value) }
    case 'struct': {
      const fields: Record<string, ZeeValue> = {}
      const fieldMut: Record<string, boolean> = {}
      for (const field of target.fields) {
        fields[field.name] = dummyZeeValue(field.type)
        fieldMut[field.name] = field.mutable
      }
      return {
        type: 'struct',
        name: target.name,
        module: target.module,
        data: target.data,
        readonly: target.readonly,
        identity: target.identity,
        fields,
        fieldMut,
      }
    }
  }
}

export function decodeJsonToZee(raw: unknown, target: JsonTarget): { value: ZeeValue; error?: string } {
  try {
    return { value: decodeRequired(raw, target) }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'invalid JSON'
    return { value: dummyZeeValue(target), error: message }
  }
}

function decodeRequired(raw: unknown, target: JsonTarget): ZeeValue {
  if (target.tag === 'option') {
    if (raw === null) return { type: 'option', tag: 'none' }
    return { type: 'option', tag: 'some', value: decodeRequired(raw, target.inner) }
  }
  if (raw === null) throw new Error('JSON null is only Option')
  switch (target.tag) {
    case 'int':
      return decodeInt(raw, target.kind)
    case 'float': {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) throw new Error('expected JSON number')
      return { type: target.kind, value: raw }
    }
    case 'bool':
      if (typeof raw !== 'boolean') throw new Error('expected JSON boolean')
      return { type: 'bool', value: raw }
    case 'string':
      if (typeof raw !== 'string') throw new Error('expected JSON string')
      return { type: 'string', value: raw }
    case 'char':
      if (typeof raw !== 'string' || [...raw].length !== 1) throw new Error('expected JSON string of one Char')
      return { type: 'char', value: raw }
    case 'list':
    case 'array': {
      if (!Array.isArray(raw)) throw new Error('expected JSON array')
      const items = raw.map((item) => decodeRequired(item, target.elem))
      return target.tag === 'list'
        ? { type: 'list', items, elem: dummyElemType(target.elem) }
        : { type: 'array', items, elem: dummyElemType(target.elem) }
    }
    case 'map': {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('expected JSON object')
      const entries = new Map<string, { key: ZeeValue; value: ZeeValue }>()
      for (const [key, item] of Object.entries(raw as Record<string, unknown>)) {
        entries.set(`str:${JSON.stringify(key)}`, {
          key: { type: 'string', value: key },
          value: decodeRequired(item, target.value),
        })
      }
      return { type: 'map', entries, key: { kind: 'string' }, value: dummyElemType(target.value) }
    }
    case 'struct': {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('expected JSON object')
      const obj = raw as Record<string, unknown>
      const fields: Record<string, ZeeValue> = {}
      const fieldMut: Record<string, boolean> = {}
      for (const field of target.fields) {
        if (!(field.name in obj)) throw new Error(`missing field \`${field.name}\``)
        fields[field.name] = decodeRequired(obj[field.name], field.type)
        fieldMut[field.name] = field.mutable
      }
      return {
        type: 'struct',
        name: target.name,
        module: target.module,
        data: target.data,
        readonly: target.readonly,
        identity: target.identity,
        fields,
        fieldMut,
      }
    }
  }
}

function decodeInt(raw: unknown, kind: IntKind): ZeeValue {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) throw new Error('expected JSON integer')
  const n = BigInt(raw)
  if (!intFits(n, kind)) throw new Error(`JSON integer does not fit ${kind}`)
  if (kind === 'i64' || kind === 'u64' || kind === 'isize' || kind === 'usize') {
    return { type: kind, value: n }
  }
  return { type: kind, value: Number(n) }
}

function intDummy(kind: IntKind): ZeeValue {
  if (kind === 'i64' || kind === 'u64' || kind === 'isize' || kind === 'usize') {
    return { type: kind, value: 0n }
  }
  return { type: kind, value: 0 }
}

function jsonSafeInt(n: bigint): number {
  if (n < BigInt(Number.MIN_SAFE_INTEGER) || n > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('JSON integer is out of range')
  }
  return Number(n)
}

function dummyElemType(target: JsonTarget): ZeeType {
  switch (target.tag) {
    case 'int':
      return { kind: target.kind }
    case 'float':
      return { kind: target.kind }
    case 'bool':
      return { kind: 'bool' }
    case 'string':
      return { kind: 'string' }
    case 'char':
      return { kind: 'char' }
    case 'option':
      return { kind: 'option', inner: dummyElemType(target.inner) }
    case 'list':
      return { kind: 'list', elem: dummyElemType(target.elem) }
    case 'array':
      return { kind: 'array', elem: dummyElemType(target.elem) }
    case 'map':
      return { kind: 'map', key: { kind: 'string' }, value: dummyElemType(target.value) }
    case 'struct':
      return {
        kind: 'struct',
        name: target.name,
        module: target.module,
        data: target.data,
        readonly: target.readonly,
        identity: target.identity,
        fields: [],
        implements: [],
      }
  }
}
