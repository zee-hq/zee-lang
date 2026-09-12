import { describe, expect, it } from 'vitest'
import { parse } from '../src/parser.ts'
import { checkSource, execute } from '../src/zee.ts'
import { formatZee } from '../src/format.ts'

describe('attributes are language metadata (decision 40)', () => {
  it('parses any @Name, not an HTTP catalog', () => {
    const program = parse(`
      @Trace("span")
      pub fn ping() {}

      @Foo
      pub class Box {
        @Bar("x")
        pub fn id(self) {}
      }
    `)
    const ping = program.stmts[0]
    const box = program.stmts[1]
    expect(ping?.kind).toBe('fn')
    expect(box?.kind).toBe('structDecl')
    if (ping?.kind !== 'fn' || box?.kind !== 'structDecl') return
    expect(ping.attributes).toEqual([expect.objectContaining({ name: 'Trace', args: ['span'] })])
    expect(box.attributes).toEqual([expect.objectContaining({ name: 'Foo', args: [] })])
    expect(box.methods[0]?.attributes).toEqual([expect.objectContaining({ name: 'Bar', args: ['x'] })])
  })

  it('type-checks unknown attribute names (the package decides the action)', () => {
    checkSource(`
      @Trace("span")
      pub fn ping() {}

      @Foo
      pub class Box {
        @Bar
        pub fn id(self, @Baz x: i32) {}
      }

      fn main() {}
    `)
  })

  it('formats @Name on a parameter', () => {
    expect(formatZee('fn show(@Param("id") id: i32) {}')).toBe('fn show(@Param("id") id: i32) {}\n')
  })

  it('parses @Name on a data struct field (AC-validate-fields)', () => {
    const program = parse(`
      pub data struct StoreUser {
        @NotBlank
        @MinLength(1)
        pub const name: String
      }
    `)
    const decl = program.stmts[0]
    expect(decl?.kind).toBe('structDecl')
    if (decl?.kind !== 'structDecl') return
    expect(decl.fields[0]?.attributes).toEqual([
      expect.objectContaining({ name: 'NotBlank', args: [] }),
      expect.objectContaining({ name: 'MinLength', args: ['1'], argKinds: ['int'] }),
    ])
  })

  it('type-checks unknown field attributes (the package decides the action)', () => {
    checkSource(`
      pub data struct StoreUser {
        @NotBlank
        @MinLength(1)
        pub const name: String
      }

      fn main() {}
    `)
  })

  it('formats field attributes and integer args without quotes', () => {
    expect(
      formatZee(`pub data struct StoreUser {
  @MinLength(1)
  pub const name: String
}`),
    ).toBe(`pub data struct StoreUser {
  @MinLength(1)
  pub const name: String
}
`)
  })

  it('exposes stored field metadata with fields() (AC-fields)', () => {
    expect(
      execute(`
        pub data struct User {
          @MinLength(8)
          pub const name: String
        }
        const u = User { name: "ada" }
        const snap = u.fields().first() ?: ("", None, None, [])
        const attr = snap.3.first() ?: ("", [])
        (snap.0, snap.1 ?: "", attr.0, attr.1.first() ?: "")
      `).value,
    ).toEqual({
      type: 'tuple',
      items: [
        { type: 'string', value: 'name' },
        { type: 'string', value: 'ada' },
        { type: 'string', value: 'MinLength' },
        { type: 'string', value: '8' },
      ],
    })
  })

  it('keeps field attributes when the value is passed through unconstrained T (AC-fields-generic)', () => {
    expect(
      execute(`
        pub data struct User {
          @MinLength(8)
          pub const name: String
        }
        fn rule<T>(value: T) -> String {
          const snap = value.fields().first() ?: ("", None, None, [])
          const attr = snap.3.first() ?: ("", [])
          attr.0
        }
        rule(User { name: "ada" })
      `).value,
    ).toEqual({ type: 'string', value: 'MinLength' })
  })

  it('returns an empty list from fields() on a non-struct, including unconstrained T', () => {
    expect(
      execute(`
        pub data struct User {
          pub const name: String
        }
        fn count<T>(value: T) -> usize {
          value.fields().len
        }
        (1.fields().isEmpty(), count(User { name: "ada" }))
      `).value,
    ).toEqual({
      type: 'tuple',
      items: [
        { type: 'bool', value: true },
        { type: 'usize', value: 1n },
      ],
    })
  })
})
