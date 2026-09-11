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

  it('sorts by key and by value without PHP names (ZEE-19)', () => {
    expect(
      execute(`
        fn joined(m: Map<String, i32>) -> String {
          var s = ""
          for (k, v) in m {
            s = s + k
          }
          s
        }
        const ages: Map<String, i32> = { "bo": 2, "ana": 30 }
        (joined(ages.sortByKey()), joined(ages.sortByValue()), ages.keys(), ages.values())
      `).value,
    ).toEqual({
      type: 'tuple',
      items: [
        { type: 'string', value: 'anabo' },
        { type: 'string', value: 'boana' },
        {
          type: 'list',
          elem: { kind: 'string' },
          items: [
            { type: 'string', value: 'bo' },
            { type: 'string', value: 'ana' },
          ],
        },
        {
          type: 'list',
          elem: { kind: 'i32' },
          items: [
            { type: 'i32', value: 2 },
            { type: 'i32', value: 30 },
          ],
        },
      ],
    })
  })

  it('rejects PHP asort/ksort names and sort() on Map (ZEE-19)', () => {
    expect(() => execute('const ages: Map<String, i32> = { "a": 1 }\nages.asort()')).toThrow(
      /asort|field/,
    )
    expect(() => execute('const ages: Map<String, i32> = { "a": 1 }\nages.ksort()')).toThrow(
      /ksort|field/,
    )
    expect(() => execute('const ages: Map<String, i32> = { "a": 1 }\nages.sort()')).toThrow(/sort/)
  })

  it('maps values, filters, looks up keys, and merges with right winning (ZEE-24)', () => {
    expect(
      execute(`
        const ages: Map<String, i32> = { "ana": 30, "bo": 2 }
        const extra: Map<String, i32> = { "bo": 9, "zed": 1 }
        const doubled = ages.mapValues { it * 2 }
        const adults = ages.filter { k, v -> v >= 18 }
        const merged = ages.merge(extra)
        ages.forEach { k, v -> }
        (
          doubled["ana"] ?: 0,
          ages["ana"] ?: 0,
          adults.containsKey("ana"),
          adults.containsKey("bo"),
          ages.containsKey("zed"),
          merged["bo"] ?: 0,
          merged["zed"] ?: 0,
          ages["bo"] ?: 0
        )
      `).value,
    ).toEqual({
      type: 'tuple',
      items: [
        { type: 'i32', value: 60 },
        { type: 'i32', value: 30 },
        { type: 'bool', value: true },
        { type: 'bool', value: false },
        { type: 'bool', value: false },
        { type: 'i32', value: 9 },
        { type: 'i32', value: 1 },
        { type: 'i32', value: 2 },
      ],
    })
  })

  it('finds, any, and all with { k, v -> } (ZEE-24)', () => {
    expect(
      execute(`
        const ages: Map<String, i32> = { "ana": 30, "bo": 2 }
        var empty: Map<String, i32> = {}
        (
          ages.find { k, v -> v > 10 } == Some(("ana", 30)),
          ages.find { k, v -> v > 100 } == None,
          ages.any { k, v -> k == "bo" },
          ages.all { k, v -> v > 0 },
          empty.any { k, v -> true },
          empty.all { k, v -> false }
        )
      `).value,
    ).toEqual({
      type: 'tuple',
      items: [
        { type: 'bool', value: true },
        { type: 'bool', value: true },
        { type: 'bool', value: true },
        { type: 'bool', value: true },
        { type: 'bool', value: false },
        { type: 'bool', value: true },
      ],
    })
  })

  it('rejects map/contains on Map and unnamed filter lambdas (ZEE-24)', () => {
    expect(() => execute('const ages: Map<String, i32> = { "a": 1 }\nages.map { it }')).toThrow(
      /mapValues|map/,
    )
    expect(() => execute('const ages: Map<String, i32> = { "a": 1 }\nages.contains(1)')).toThrow(
      /containsKey|contains/,
    )
    expect(() =>
      execute('const ages: Map<String, i32> = { "a": 1 }\nages.filter { it > 0 }'),
    ).toThrow(/k, v|parameter/)
  })
})
