import { describe, expect, it } from 'vitest'
import { parse } from '../src/parser.ts'

describe('parser', () => {
  it('parses a typed function with an if expression', () => {
    const program = parse(`
      fn factorial(n: i32) -> i32 {
        if n <= 1 { 1 } else { n * factorial(n - 1) }
      }
    `)
    expect(program.stmts).toHaveLength(1)
    const fn = program.stmts[0]
    expect(fn?.kind).toBe('fn')
    if (fn?.kind !== 'fn') return
    expect(fn.name).toBe('factorial')
    expect(fn.params).toHaveLength(1)
    expect(fn.returnType).toMatchObject({ kind: 'named', name: 'i32' })
    expect(fn.body.stmts[0]?.kind).toBe('expr')
  })

  it('parses const and var with inferred and annotated types', () => {
    const program = parse('const x = 1\nvar y: String = "zee"')
    expect(program.stmts.map((stmt) => stmt.kind)).toEqual(['bind', 'bind'])
  })

  it('parses @Name on a class method', () => {
    const program = parse(`
      @Controller("/users")
      pub class Users {
        @Get("/:id")
        pub fn show(self) {}
      }
    `)
    const decl = program.stmts[0]
    expect(decl?.kind).toBe('structDecl')
    if (decl?.kind !== 'structDecl') return
    expect(decl.attributes).toEqual([expect.objectContaining({ name: 'Controller', args: ['/users'] })])
    expect(decl.methods[0]?.attributes).toEqual([expect.objectContaining({ name: 'Get', args: ['/:id'] })])
  })

  it('parses @Name on a parameter', () => {
    const program = parse(`
      pub fn show(@Param("id") id: i32, @Params all: Map<String, String>) {}
    `)
    const fn = program.stmts[0]
    expect(fn?.kind).toBe('fn')
    if (fn?.kind !== 'fn') return
    expect(fn.params[0]?.attributes).toEqual([expect.objectContaining({ name: 'Param', args: ['id'] })])
    expect(fn.params[1]?.attributes).toEqual([expect.objectContaining({ name: 'Params', args: [] })])
  })
})
