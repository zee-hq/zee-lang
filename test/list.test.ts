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

  it('queries with contains, find, any, all, and isEmpty (ZEE-18)', () => {
    expect(
      execute(`
        const xs: List<i32> = [1, 2, 3]
        (
          xs.contains(2),
          xs.contains(9),
          xs.find { it > 1 } == Some(2),
          xs.find { it > 9 } == None,
          xs.any { it == 3 },
          xs.all { it > 0 },
          xs.isEmpty(),
          xs.isNotEmpty()
        )
      `).value,
    ).toEqual({
      type: 'tuple',
      items: [
        { type: 'bool', value: true },
        { type: 'bool', value: false },
        { type: 'bool', value: true },
        { type: 'bool', value: true },
        { type: 'bool', value: true },
        { type: 'bool', value: true },
        { type: 'bool', value: false },
        { type: 'bool', value: true },
      ],
    })
    expect(execute('const xs: List<i32> = []\nxs.isEmpty()').value).toEqual({
      type: 'bool',
      value: true,
    })
  })

  it('sorts into a new List and slices a window (ZEE-18)', () => {
    expect(
      execute(`
        const xs = [3, 1, 2]
        const ordered = xs.sort()
        (xs, ordered, ordered.slice(1, 3))
      `).value,
    ).toEqual({
      type: 'tuple',
      items: [
        { type: 'list', elem: { kind: 'i32' }, items: [
          { type: 'i32', value: 3 },
          { type: 'i32', value: 1 },
          { type: 'i32', value: 2 },
        ]},
        { type: 'list', elem: { kind: 'i32' }, items: [
          { type: 'i32', value: 1 },
          { type: 'i32', value: 2 },
          { type: 'i32', value: 3 },
        ]},
        { type: 'list', elem: { kind: 'i32' }, items: [
          { type: 'i32', value: 2 },
          { type: 'i32', value: 3 },
        ]},
      ],
    })
  })

  it('concatenates List with + (ZEE-18)', () => {
    expect(execute('const xs = [1, 2]\nxs + [3]').value).toEqual({
      type: 'list',
      elem: { kind: 'i32' },
      items: [
        { type: 'i32', value: 1 },
        { type: 'i32', value: 2 },
        { type: 'i32', value: 3 },
      ],
    })
  })

  it('rejects sort when T is not Ord (ZEE-18)', () => {
    expect(() =>
      execute(`
        const xs: List<bool> = [true, false]
        xs.sort()
      `),
    ).toThrow(/Ord/)
  })

  it('sorts with a (T, T) -> i32 comparator (ZEE-20)', () => {
    expect(
      execute(`
        struct Row {
          const name: String
          const age: i32
        }
        const xs = [Row { name: "bo", age: 2 }, Row { name: "ana", age: 30 }]
        const byAge = xs.sort { a, b -> a.age <===> b.age }
        const nums = [1, 3, 2]
        const desc = nums.sort { a, b -> b <===> a }
        (byAge[0].name, byAge[1].name, xs[0].name, desc)
      `).value,
    ).toEqual({
      type: 'tuple',
      items: [
        { type: 'string', value: 'bo' },
        { type: 'string', value: 'ana' },
        { type: 'string', value: 'bo' },
        {
          type: 'list',
          elem: { kind: 'i32' },
          items: [
            { type: 'i32', value: 3 },
            { type: 'i32', value: 2 },
            { type: 'i32', value: 1 },
          ],
        },
      ],
    })
  })

  it('rejects a bool comparator and PHP usort (ZEE-20)', () => {
    expect(() =>
      execute(`
        const xs = [3, 1, 2]
        xs.sort { a, b -> a < b }
      `),
    ).toThrow(/i32/)
    expect(() => execute('const xs = [3, 1]\nxs.usort { a, b -> a <===> b }')).toThrow(
      /usort|field/,
    )
  })
})
