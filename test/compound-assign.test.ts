import { describe, expect, it } from 'vitest'
import { execute } from '../src/zee.ts'

describe('compound assign (AC-compound-assign)', () => {
  it('applies += -= *= /= %= on var integers', () => {
    expect(
      execute(`
        var i = 10
        i += 5
        i -= 3
        i *= 2
        i /= 4
        i %= 3
        i
      `).value,
    ).toEqual({ type: 'i32', value: 0 })
  })

  it('concatenates strings with += only', () => {
    expect(
      execute(`
        var s = "a"
        s += "b"
        s
      `).value,
    ).toEqual({ type: 'string', value: 'ab' })
    expect(() =>
      execute(`
        var s = "a"
        s -= "b"
      `),
    ).toThrow(/not defined/)
  })

  it('rejects compound assign on const, bool, Option, and mixed types', () => {
    expect(() => execute('const n = 1\nn += 1')).toThrow(/const/)
    expect(() => execute('var ok = true\nok += true')).toThrow(/not defined/)
    expect(() =>
      execute(`
        var a: Option<i32> = None
        a += None
      `),
    ).toThrow(/not defined/)
    expect(() => execute('var n = 1\nn += 1i64')).toThrow(/not defined|expected/)
  })

  it('evaluates an indexed lhs once', () => {
    expect(
      execute(`
        var xs = [10, 20]
        var calls = 0
        fn idx() -> usize {
          calls += 1
          0
        }
        xs[idx()] += 5
        (xs[0], calls)
      `).value,
    ).toEqual({
      type: 'tuple',
      items: [
        { type: 'i32', value: 15 },
        { type: 'i32', value: 1 },
      ],
    })
  })

  it('compounds a var field on a var binding', () => {
    expect(
      execute(`
        struct Point {
          const x: i32
          var y: i32
        }
        var p = Point { x: 1, y: 2 }
        p.y += 3
        p.y
      `).value,
    ).toEqual({ type: 'i32', value: 5 })
    expect(() =>
      execute(`
        struct Point {
          const x: i32
          var y: i32
        }
        var p = Point { x: 1, y: 2 }
        p.x += 1
      `),
    ).toThrow(/const/)
    expect(() =>
      execute(`
        struct Point {
          var y: i32
        }
        const p = Point { y: 2 }
        p.y += 1
      `),
    ).toThrow(/const/)
  })

  it('panics on integer overflow and division by zero like binary ops', () => {
    expect(() => execute('var x: i8 = 120\nx += 10')).toThrow(/overflow/)
    expect(() => execute('var x = 1\nx /= 0')).toThrow(/division by zero/)
    expect(() => execute('var x = 1\nx %= 0')).toThrow(/division by zero/)
  })

  it('keeps remainder sign with the dividend', () => {
    expect(
      execute(`
        var x = -7
        x %= 3
        x
      `).value,
    ).toEqual({ type: 'i32', value: -1 })
  })
})
