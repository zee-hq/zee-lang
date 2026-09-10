import { describe, expect, it } from 'vitest'
import { ZeeError } from '../src/error.ts'
import { execute } from '../src/zee.ts'

describe('lambdas (AC-lambda-kotlin)', () => {
  it('binds an annotated lambda and calls it', () => {
    expect(
      execute(`
        const add: (i32, i32) -> i32 = { a, b -> a + b }
        add(40, 2)
      `).value,
    ).toEqual({ type: 'i32', value: 42 })
  })

  it('infers it and omitted param from the expected function type', () => {
    expect(
      execute(`
        fn apply(n: i32, f: (i32) -> i32) -> i32 {
          f(n)
        }
        apply(3, { it * 2 })
      `).value,
    ).toEqual({ type: 'i32', value: 6 })

    expect(
      execute(`
        fn apply(n: i32, f: (i32) -> i32) -> i32 {
          f(n)
        }
        apply(3, { 0 })
      `).value,
    ).toEqual({ type: 'i32', value: 0 })
  })

  it('accepts a trailing lambda after the closing paren', () => {
    expect(
      execute(`
        fn apply(n: i32, f: (i32) -> i32) -> i32 {
          f(n)
        }
        apply(3) { x -> x + 1 }
      `).value,
    ).toEqual({ type: 'i32', value: 4 })
  })

  it('captures an immutable binding', () => {
    expect(
      execute(`
        const n = 10
        const addN: (i32) -> i32 = { it + n }
        addN(5)
      `).value,
    ).toEqual({ type: 'i32', value: 15 })
  })

  it('rejects capturing a var', () => {
    expect(() =>
      execute(`
        var n = 10
        const addN: (i32) -> i32 = { it + n }
        addN(5)
      `),
    ).toThrow(ZeeError)
    expect(() =>
      execute(`
        var n = 10
        const addN: (i32) -> i32 = { it + n }
        addN(5)
      `),
    ).toThrow(/capture/)
  })

  it('rejects implicit it when the function type has several parameters', () => {
    expect(() =>
      execute(`
        const add: (i32, i32) -> i32 = { it + 1 }
      `),
    ).toThrow(/names/)
  })

  it('passes a named function where a lambda is expected', () => {
    expect(
      execute(`
        fn double(n: i32) -> i32 { n * 2 }
        fn apply(n: i32, f: (i32) -> i32) -> i32 { f(n) }
        apply(21, double)
      `).value,
    ).toEqual({ type: 'i32', value: 42 })
  })
})
