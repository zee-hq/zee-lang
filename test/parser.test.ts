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
    expect(fn.returnType?.name).toBe('i32')
    expect(fn.body.stmts[0]?.kind).toBe('expr')
  })

  it('parses let with inferred and annotated types', () => {
    const program = parse('let x = 1\nlet y: String = "zee"')
    expect(program.stmts.map((stmt) => stmt.kind)).toEqual(['let', 'let'])
  })
})
