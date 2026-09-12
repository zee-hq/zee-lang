import { describe, expect, it } from 'vitest'
import { parse } from '../src/parser.ts'
import { checkSource } from '../src/zee.ts'
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
})
