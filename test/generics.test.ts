import { describe, expect, it } from 'vitest'
import { parse } from '../src/parser.ts'
import { execute } from '../src/zee.ts'

describe('user generics (AC-generics-fn)', () => {
  it('parses fn type parameters, including several', () => {
    const program = parse(`
      fn identity<T>(x: T) -> T { x }
      fn pair<T, U>(a: T, b: U) -> (T, U) { (a, b) }
    `)
    const identity = program.stmts[0]
    expect(identity?.kind).toBe('fn')
    if (identity?.kind !== 'fn') return
    expect(identity.name).toBe('identity')
    expect(identity.typeParams).toEqual(['T'])

    const pair = program.stmts[1]
    expect(pair?.kind).toBe('fn')
    if (pair?.kind !== 'fn') return
    expect(pair.typeParams).toEqual(['T', 'U'])
  })

  it('infers T from the argument', () => {
    expect(
      execute(`
        fn identity<T>(x: T) -> T { x }
        identity(3)
      `).value,
    ).toEqual({ type: 'i32', value: 3 })
  })

  it('accepts an explicit type argument', () => {
    expect(
      execute(`
        fn identity<T>(x: T) -> T { x }
        identity<String>("a")
      `).value,
    ).toEqual({ type: 'string', value: 'a' })
  })

  it('infers several type parameters from arguments', () => {
    expect(
      execute(`
        fn pair<T, U>(a: T, b: U) -> (T, U) { (a, b) }
        const p = pair("a", 2)
        p.1
      `).value,
    ).toEqual({ type: 'i32', value: 2 })
  })

  it('rejects an explicit type argument that disagrees with the value', () => {
    expect(() =>
      execute(`
        fn identity<T>(x: T) -> T { x }
        identity<String>(3)
      `),
    ).toThrow(/expected String, got i32|expected String/)
  })

  it('infers T when a generic fn forwards to another generic fn', () => {
    expect(
      execute(`
        fn identity<T>(x: T) -> T { x }
        fn wrap<T>(x: T) -> T { identity(x) }
        wrap(3)
      `).value,
    ).toEqual({ type: 'i32', value: 3 })
  })

  it('parses type arguments on a member call', () => {
    const program = parse('json.decode<UserRow>(text)')
    const stmt = program.stmts[0]
    expect(stmt?.kind).toBe('expr')
    if (stmt?.kind !== 'expr') return
    expect(stmt.expr.kind).toBe('call')
    if (stmt.expr.kind !== 'call') return
    expect(stmt.expr.callee.kind).toBe('member')
    expect(stmt.expr.typeArgs).toHaveLength(1)
    expect(stmt.expr.typeArgs?.[0]).toMatchObject({ kind: 'named', name: 'UserRow' })
    expect(stmt.expr.args).toHaveLength(1)
  })
})
