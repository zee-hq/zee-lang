import { describe, expect, it } from 'vitest'
import { parse } from '../src/parser.ts'
import { execute } from '../src/zee.ts'

describe('Map<K, V> (AC-map)', () => {
  it('looks up Some and None', () => {
    expect(
      execute(`
        var ages: Map<String, i32> = { "ana": 30, "bo": 2 }
        (ages["ana"] == Some(30), ages["zed"] == None)
      `).value,
    ).toEqual({
      type: 'tuple',
      items: [
        { type: 'bool', value: true },
        { type: 'bool', value: true },
      ],
    })
  })

  it('assigns and grows on a var Map', () => {
    expect(
      execute(`
        var ages: Map<String, i32> = { "ana": 30 }
        ages["ana"] = 31
        ages["bo"] = 2
        (ages["ana"], ages.len)
      `).value,
    ).toEqual({
      type: 'tuple',
      items: [
        { type: 'option', tag: 'some', value: { type: 'i32', value: 31 } },
        { type: 'usize', value: 2n },
      ],
    })
  })

  it('rejects assign on a const Map', () => {
    expect(() =>
      execute(`
        const frozen: Map<String, i32> = { "ana": 30 }
        frozen["ana"] = 31
      `),
    ).toThrow(/const/)
  })

  it('rejects Map keys that are T[]', () => {
    expect(() =>
      execute(`
        var bad: Map<i32[], i32> = {}
      `),
    ).toThrow(/Hash/)
  })

  it('iterates for (k, v) in ages and rejects for x in ages', () => {
    expect(
      execute(`
        const ages: Map<String, i32> = { "ana": 30, "bo": 2 }
        var sum = 0
        for (k, v) in ages {
          sum = sum + v
        }
        sum
      `).value,
    ).toEqual({ type: 'i32', value: 32 })
    expect(() =>
      execute(`
        const ages: Map<String, i32> = { "ana": 30 }
        for x in ages { }
      `),
    ).toThrow(/\(k, v\)/)
  })

  it('parses a map literal without breaking lambdas, structs, or map methods', () => {
    const program = parse(`
      struct Point {
        const x: i32
      }
      const p = Point { x: 3 }
      const xs = [1, 2, 3]
      const ys = xs.map { it * 2 }
      const ages: Map<String, i32> = { "ana": 30 }
      const add: (i32) -> i32 = { it + 1 }
    `)
    expect(program.stmts.map((stmt) => stmt.kind)).toEqual([
      'structDecl',
      'bind',
      'bind',
      'bind',
      'bind',
      'bind',
    ])
    expect(
      execute(`
        struct Point {
          const x: i32
        }
        const p = Point { x: 3 }
        const xs = [1, 2, 3]
        const ys = xs.map { it * 2 }
        const ages: Map<String, i32> = { "ana": 30 }
        const add: (i32) -> i32 = { it + 1 }
        p.x + ys[0] + (ages["ana"] ?: 0) + add(1)
      `).value,
    ).toEqual({ type: 'i32', value: 37 })
  })

  it('needs a type for empty {}', () => {
    expect(() => execute('var ages = {}')).toThrow(/type/)
  })

  it('reports isEmpty (ZEE-18)', () => {
    expect(execute('var ages: Map<String, i32> = {}\nages.isEmpty()').value).toEqual({
      type: 'bool',
      value: true,
    })
  })
})
