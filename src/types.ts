export type ZeeType =
  | { kind: 'i32' }
  | { kind: 'bool' }
  | { kind: 'string' }
  | { kind: 'unit' }
  | { kind: 'fn'; params: ZeeType[]; ret: ZeeType }

export const T_I32: ZeeType = { kind: 'i32' }
export const T_BOOL: ZeeType = { kind: 'bool' }
export const T_STRING: ZeeType = { kind: 'string' }
export const T_UNIT: ZeeType = { kind: 'unit' }

export function typeEq(a: ZeeType, b: ZeeType): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'fn' && b.kind === 'fn') {
    if (a.params.length !== b.params.length) return false
    if (!typeEq(a.ret, b.ret)) return false
    return a.params.every((param, index) => typeEq(param, b.params[index]!))
  }
  return true
}

export function typeName(type: ZeeType): string {
  switch (type.kind) {
    case 'i32':
      return 'i32'
    case 'bool':
      return 'bool'
    case 'string':
      return 'String'
    case 'unit':
      return 'Unit'
    case 'fn':
      return `fn(${type.params.map(typeName).join(', ')}) -> ${typeName(type.ret)}`
  }
}

export function typeFromName(name: string): ZeeType | undefined {
  switch (name) {
    case 'i32':
      return T_I32
    case 'bool':
      return T_BOOL
    case 'String':
      return T_STRING
    case 'Unit':
      return T_UNIT
    default:
      return undefined
  }
}
