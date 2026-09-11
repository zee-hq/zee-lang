import { describe, expect, it } from 'vitest'
import { execute } from '../src/zee.ts'

describe('arrays (AC-array)', () => {
  it('reads, writes, and reports len as usize', () => {
    expect(
      execute(`
        var xs: i32[] = [1, 2, 3]
        xs[0] = 9
        (xs[0], xs.len)
      `).value,
    ).toEqual({
      type: 'tuple',
      items: [
        { type: 'i32', value: 9 },
        { type: 'usize', value: 3n },
      ],
    })
  })

  it('infers T[] from an unannotated var literal', () => {
    expect(
      execute(`
        var xs = [1, 2]
        xs[1]
      `).value,
    ).toEqual({ type: 'i32', value: 2 })
  })

  it('grows with redim preserve and fills new integer slots with 0', () => {
    expect(
      execute(`
        var xs: i32[] = [1, 2, 3]
        redim preserve xs, 5
        (xs[3], xs.len)
      `).value,
    ).toEqual({
      type: 'tuple',
      items: [
        { type: 'i32', value: 0 },
        { type: 'usize', value: 5n },
      ],
    })
  })

  it('shrinks with redim and keeps the prefix', () => {
    expect(
      execute(`
        var xs = [1, 2, 3, 4]
        redim xs, 2
        xs.len
      `).value,
    ).toEqual({ type: 'usize', value: 2n })
  })

  it('iterates with for x in xs', () => {
    expect(
      execute(`
        var sum = 0
        for x in [1, 2, 3] {
          sum = sum + x
        }
        sum
      `).value,
    ).toEqual({ type: 'i32', value: 6 })
  })

  it('rejects writing through a const array and a non-usize index', () => {
    expect(() =>
      execute(`
        const xs: i32[] = [1, 2, 3]
        xs[0] = 9
      `),
    ).toThrow(/const/)
    expect(() =>
      execute(`
        var xs: i32[] = [1]
        var i: i32 = 0
        xs[i]
      `),
    ).toThrow(/usize/)
  })

  it('panics on out of bounds and requires a type for []', () => {
    expect(() => execute('var xs: i32[] = [1]\nxs[1]')).toThrow(/bounds/)
    expect(() => execute('var xs = []')).toThrow(/type/)
  })

  it('queries isEmpty, contains, and concatenates with + (ZEE-18)', () => {
    expect(
      execute(`
        var xs: i32[] = [1, 2]
        var tail: i32[] = [3]
        (xs.isEmpty(), xs.contains(2), (xs + tail).len)
      `).value,
    ).toEqual({
      type: 'tuple',
      items: [
        { type: 'bool', value: false },
        { type: 'bool', value: true },
        { type: 'usize', value: 3n },
      ],
    })
  })

  it('maps, filters, and forEach without mutating the buffer (ZEE-25)', () => {
    expect(
      execute(`
        var xs: i32[] = [1, 2, 3, 4]
        const doubled = xs.map { it * 2 }
        const evens = xs.filter { it % 2 == 0 }
        doubled.forEach { }
        (doubled[1], evens.len, evens[0], xs[0])
      `).value,
    ).toEqual({
      type: 'tuple',
      items: [
        { type: 'i32', value: 4 },
        { type: 'usize', value: 2n },
        { type: 'i32', value: 2 },
        { type: 'i32', value: 1 },
      ],
    })
  })

  it('pushes, pops, fills, and sorts in place on var T[] (ZEE-25)', () => {
    expect(
      execute(`
        var xs = [3, 1, 2]
        xs.push(0)
        const last = xs.pop()
        xs.fill(9)
        var ys = [3, 1, 2]
        ys.sort()
        var zs = [3, 1, 2]
        zs.sort { a, b -> b <===> a }
        (last, xs.len, xs[0], ys[0], ys[2], zs[0])
      `).value,
    ).toEqual({
      type: 'tuple',
      items: [
        { type: 'option', tag: 'some', value: { type: 'i32', value: 0 } },
        { type: 'usize', value: 3n },
        { type: 'i32', value: 9 },
        { type: 'i32', value: 1 },
        { type: 'i32', value: 3 },
        { type: 'i32', value: 3 },
      ],
    })
  })

  it('pops None from an empty array (ZEE-25)', () => {
    expect(execute('var xs: i32[] = []\nxs.pop()').value).toEqual({ type: 'option', tag: 'none' })
  })

  it('rejects mutating methods on const T[] and on List (ZEE-25)', () => {
    expect(() => execute('const xs: i32[] = [1]\nxs.push(2)')).toThrow(/const|var/)
    expect(() => execute('const xs: i32[] = [1]\nxs.pop()')).toThrow(/const|var/)
    expect(() => execute('const xs: i32[] = [1]\nxs.fill(0)')).toThrow(/const|var/)
    expect(() => execute('const xs: i32[] = [3, 1]\nxs.sort()')).toThrow(/const|var/)
    expect(() => execute('const xs = [1]\nxs.push(2)')).toThrow(/push|immutable|field/)
  })

  it('copies first last reverse unique and join on T[] (ZEE-31)', () => {
    expect(
      execute(`
        var xs: i32[] = [1, 2, 1, 3]
        var names: String[] = ["a", "b", "a"]
        const empty: i32[] = []
        const rev = xs.reverse()
        const uniq = xs.unique()
        (
          xs.first() == Some(1),
          xs.last() == Some(3),
          empty.first() == None,
          empty.last() == None,
          rev[0],
          xs[0],
          uniq.len,
          uniq[2],
          names.join("-")
        )
      `).value,
    ).toEqual({
      type: 'tuple',
      items: [
        { type: 'bool', value: true },
        { type: 'bool', value: true },
        { type: 'bool', value: true },
        { type: 'bool', value: true },
        { type: 'i32', value: 3 },
        { type: 'i32', value: 1 },
        { type: 'usize', value: 3n },
        { type: 'i32', value: 3 },
        { type: 'string', value: 'a-b-a' },
      ],
    })
  })

  it('rejects unique without Eq and join on non-String arrays (ZEE-31)', () => {
    expect(() =>
      execute(`
        var xs: f64[] = [1.0, 2.0]
        xs.unique()
      `),
    ).toThrow(/Eq/)
    expect(() => execute('var xs: i32[] = [1, 2]\nxs.join(",")')).toThrow(/String/)
  })

  it('flattens T[][] one level (ZEE-30)', () => {
    expect(
      execute(`
        var xs: i32[][] = [[1, 2], [3]]
        const flat = xs.flat()
        (flat.len, flat[0], flat[2], xs[0][0])
      `).value,
    ).toEqual({
      type: 'tuple',
      items: [
        { type: 'usize', value: 3n },
        { type: 'i32', value: 1 },
        { type: 'i32', value: 3 },
        { type: 'i32', value: 1 },
      ],
    })
  })

  it('rejects flat on T[] (ZEE-30)', () => {
    expect(() => execute('var xs: i32[] = [1, 2]\nxs.flat()')).toThrow(/flat|T\[\]\[\]/)
  })

  it('folds counts zips groups flatMaps and mins on T[] (ZEE-26)', () => {
    expect(
      execute(`
        var xs: i32[] = [1, 2, 3, 4]
        var empty: i32[] = []
        const z = xs.zip(xs)
        (
          xs.fold(0) { acc, x -> acc + x },
          empty.fold(9) { acc, x -> acc + x },
          xs.count { it > 2 },
          z.len,
          xs.groupBy { it % 2 }.len,
          xs.flatMap {
            var inner: i32[] = [it, it * 10]
            inner
          }.len,
          xs.min() == Some(1),
          empty.max() == None
        )
      `).value,
    ).toEqual({
      type: 'tuple',
      items: [
        { type: 'i32', value: 10 },
        { type: 'i32', value: 9 },
        { type: 'usize', value: 2n },
        { type: 'usize', value: 4n },
        { type: 'usize', value: 2n },
        { type: 'usize', value: 8n },
        { type: 'bool', value: true },
        { type: 'bool', value: true },
      ],
    })
  })
})
