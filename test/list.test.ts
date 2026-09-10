import { describe, expect, it } from 'vitest'
import { execute } from '../src/zee.ts'

describe('List<T> (AC-list)', () => {
  it('infers List from a const literal and maps with it', () => {
    expect(
      execute(`
        const xs = [1, 2, 3]
        const ys = xs.map { it * 2 }
        ys[1]
      `).value,
    ).toEqual({ type: 'i32', value: 4 })
  })

  it('keeps unannotated var literals as T[]', () => {
    expect(
      execute(`
        var xs = [1, 2, 3]
        xs[0] = 9
        xs[0]
      `).value,
    ).toEqual({ type: 'i32', value: 9 })
  })

  it('keeps annotated i32[] as an array', () => {
    expect(
      execute(`
        var xs: i32[] = [1, 2, 3]
        xs[0] = 8
        xs[0]
      `).value,
    ).toEqual({ type: 'i32', value: 8 })
  })

  it('reads len as usize and indexes with usize', () => {
    expect(
      execute(`
        const xs: List<i32> = [1, 2, 3]
        (xs.len, xs[0])
      `).value,
    ).toEqual({
      type: 'tuple',
      items: [
        { type: 'usize', value: 3n },
        { type: 'i32', value: 1 },
      ],
    })
  })

  it('leaves the original list unchanged after map', () => {
    expect(
      execute(`
        const xs = [1, 2, 3]
        const ys = xs.map { it * 2 }
        xs[0] + ys[0]
      `).value,
    ).toEqual({ type: 'i32', value: 3 })
  })

  it('filters and forEach over a list', () => {
    expect(
      execute(`
        const xs = [1, 2, 3, 4]
        const evens = xs.filter { it % 2 == 0 }
        evens.forEach { }
        (evens.len, evens[0])
      `).value,
    ).toEqual({
      type: 'tuple',
      items: [
        { type: 'usize', value: 2n },
        { type: 'i32', value: 2 },
      ],
    })
  })

  it('converts with toArray and toList as copies', () => {
    expect(
      execute(`
        const xs = [1, 2, 3]
        var buf = xs.toArray()
        buf[0] = 9
        const ys = buf.toList()
        (xs[0], buf[0], ys[0])
      `).value,
    ).toEqual({
      type: 'tuple',
      items: [
        { type: 'i32', value: 1 },
        { type: 'i32', value: 9 },
        { type: 'i32', value: 9 },
      ],
    })
  })

  it('iterates with for x in xs and for (i, x) in xs', () => {
    expect(
      execute(`
        const xs = [10, 20, 30]
        var sum = 0
        for x in xs {
          sum = sum + x
        }
        var last: usize = 0
        for (i, x) in xs {
          last = i
        }
        (sum, last)
      `).value,
    ).toEqual({
      type: 'tuple',
      items: [
        { type: 'i32', value: 60 },
        { type: 'usize', value: 2n },
      ],
    })
  })

  it('compares lists when T is Eq', () => {
    expect(execute('const xs = [1, 2]\nxs == [1, 2]').value).toEqual({ type: 'bool', value: true })
    expect(execute('const xs = [1, 2]\nxs == [1, 3]').value).toEqual({ type: 'bool', value: false })
  })

  it('rejects slot writes and redim on List', () => {
    expect(() =>
      execute(`
        const xs: List<i32> = [1, 2, 3]
        xs[0] = 9
      `),
    ).toThrow(/List/)
    expect(() =>
      execute(`
        var xs: List<i32> = [1, 2, 3]
        xs[0] = 9
      `),
    ).toThrow(/List/)
    expect(() =>
      execute(`
        var xs: List<i32> = [1, 2, 3]
        redim xs, 8
      `),
    ).toThrow(/List/)
  })

  it('panics on out of bounds list index', () => {
    expect(() => execute('const xs: List<i32> = [1]\nxs[1]')).toThrow(/bounds/)
  })
})
