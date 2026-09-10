import { describe, expect, it } from 'vitest'
import { parse } from '../src/parser.ts'
import { execute } from '../src/zee.ts'

describe('self as enclosing type (AC-self-type)', () => {
  it('rewrites -> self and self { } to the enclosing class name', () => {
    const program = parse(`
      pub class User {
        const name: String
        pub fn empty() -> self {
          self { name: "" }
        }
      }
    `)
    const decl = program.stmts[0]
    expect(decl?.kind).toBe('structDecl')
    if (decl?.kind !== 'structDecl') return
    const empty = decl.methods.find((method) => method.name === 'empty')
    expect(empty?.returnType).toMatchObject({ kind: 'named', name: 'User' })
    const expr = empty?.body.stmts[0]
    expect(expr?.kind).toBe('expr')
    if (expr?.kind !== 'expr') return
    expect(expr.expr).toMatchObject({ kind: 'structLit', name: 'User' })
  })

  it('constructs through self and returns the enclosing type', () => {
    expect(
      execute(`
        pub class User {
          const name: String
          pub fn empty() -> self {
            self { name: "" }
          }
        }
        User.empty().name
      `).value,
    ).toEqual({ type: 'string', value: '' })
  })

  it('resolves self in a nested type to the inner name, not the outer', () => {
    const program = parse(`
      pub class User {
        const name: String
        pub struct Tag {
          pub fn make() -> self {
            self { }
          }
        }
      }
    `)
    const user = program.stmts[0]
    expect(user?.kind).toBe('structDecl')
    if (user?.kind !== 'structDecl') return
    const tag = user.nested[0]
    expect(tag?.kind).toBe('structDecl')
    if (tag?.kind !== 'structDecl') return
    expect(tag.methods[0]?.returnType).toMatchObject({ kind: 'named', name: 'Tag' })
    const expr = tag.methods[0]?.body.stmts[0]
    expect(expr?.kind).toBe('expr')
    if (expr?.kind !== 'expr') return
    expect(expr.expr).toMatchObject({ kind: 'structLit', name: 'Tag' })
  })

  it('rejects self as a type outside a type body', () => {
    expect(() => parse('fn empty() -> self { 1 }')).toThrow(/self.*type body/)
    expect(() => parse('const x = self { name: "a" }')).toThrow(/self.*type body/)
  })

  it('keeps UFCS self: Point as a parameter, not a type rewrite', () => {
    const program = parse(`
      struct Point {
        const x: i32
      }
      fn mag(self: Point) -> i32 { self.x }
    `)
    const mag = program.stmts[1]
    expect(mag?.kind).toBe('fn')
    if (mag?.kind !== 'fn') return
    expect(mag.params[0]).toMatchObject({
      name: 'self',
      type: { kind: 'named', name: 'Point' },
    })
  })
})
