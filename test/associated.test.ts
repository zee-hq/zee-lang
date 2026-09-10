import { describe, expect, it } from 'vitest'
import { parse } from '../src/parser.ts'
import { execute } from '../src/zee.ts'

describe('associated names and nested types (AC-associated)', () => {
  it('calls an associated fn with Point.origin()', () => {
    expect(
      execute(`
        struct Point {
          const x: i32
          const y: i32

          fn origin() -> Point {
            Point { x: 0, y: 0 }
          }
        }
        const p = Point.origin()
        p.x + p.y
      `).value,
    ).toEqual({ type: 'i32', value: 0 })
  })

  it('reads an associated const as Type.NAME', () => {
    expect(
      execute(`
        struct User {
          const name: String
          pub const ROLE_ADMIN: String = "admin"
        }
        User.ROLE_ADMIN
      `).value,
    ).toEqual({ type: 'string', value: 'admin' })
  })

  it('reads a nested type associated const as Outer.Inner.NAME', () => {
    expect(
      execute(`
        struct User {
          const name: String
          pub struct Constants {
            pub const ANY_VALUE: i32 = 1
          }
        }
        User.Constants.ANY_VALUE
      `).value,
    ).toEqual({ type: 'i32', value: 1 })
  })

  it('constructs User with fields only; associated names are not constructor fields', () => {
    expect(
      execute(`
        struct User {
          const name: String
          pub const ROLE_ADMIN: String = "admin"
          pub struct Constants {
            pub const ANY_VALUE: i32 = 1
          }
        }
        const role = User.ROLE_ADMIN
        const n = User.Constants.ANY_VALUE
        const u = User { name: "ana" }
        u.name
      `).value,
    ).toEqual({ type: 'string', value: 'ana' })
    expect(() =>
      execute(`
        struct User {
          const name: String
          pub const ROLE_ADMIN: String = "admin"
        }
        User { name: "ana", ROLE_ADMIN: "x" }
      `),
    ).toThrow(/unknown field|not a field|associated/)
    expect(() =>
      execute(`
        struct User {
          const name: String
          pub struct Constants {
            pub const ANY_VALUE: i32 = 1
          }
        }
        User { name: "ana", Constants: 1 }
      `),
    ).toThrow(/unknown field|not a field|associated/)
  })

  it('parses associated fns, consts, and nested types inside the type body', () => {
    const program = parse(`
      struct User {
        const name: String
        pub const ROLE_ADMIN: String = "admin"
        pub struct Constants {
          pub const ANY_VALUE: i32 = 1
        }
        fn origin() -> User {
          User { name: "" }
        }
      }
    `)
    const decl = program.stmts[0]
    expect(decl?.kind).toBe('structDecl')
    if (decl?.kind !== 'structDecl') return
    expect(decl.fields.map((field) => field.name)).toEqual(['name'])
    expect(decl.associated.map((item) => item.name)).toEqual(['ROLE_ADMIN'])
    expect(decl.nested).toHaveLength(1)
    expect(decl.nested[0]?.kind).toBe('structDecl')
    if (decl.nested[0]?.kind !== 'structDecl') return
    expect(decl.nested[0].name).toBe('Constants')
    expect(decl.methods.map((method) => method.name)).toEqual(['origin'])
    expect(decl.methods[0]?.params).toHaveLength(0)
  })
})
