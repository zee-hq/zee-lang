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
})
