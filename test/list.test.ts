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

  it('sorts by a key extractor (ZEE-21)', () => {
    expect(
      execute(`
        struct Row {
          const name: String
          const age: i32
        }
        const xs = [Row { name: "bo", age: 2 }, Row { name: "ana", age: 30 }]
        const byAge = xs.sortBy { it.age }
        const byName = xs.sortBy { it.name }
        (byAge[0].name, byAge[1].name, byName[0].name, xs[0].name)
      `).value,
    ).toEqual({
      type: 'tuple',
      items: [
        { type: 'string', value: 'bo' },
        { type: 'string', value: 'ana' },
        { type: 'string', value: 'ana' },
        { type: 'string', value: 'bo' },
      ],
    })
  })

  it('rejects a non-Ord sortBy key and sortBy on Map (ZEE-21)', () => {
    expect(() =>
      execute(`
        struct Row {
          const name: String
        }
        const xs = [Row { name: "a" }]
        xs.sortBy { it }
      `),
    ).toThrow(/Ord/)
    expect(() =>
      execute(`
        const ages: Map<String, i32> = { "bo": 2 }
        ages.sortBy { it }
      `),
    ).toThrow(/sortByKey|sortByValue|field/)
  })

  it('sorts by a key extractor descending (ZEE-27)', () => {
    expect(
      execute(`
        struct Row {
          const name: String
          const age: i32
        }
        const xs = [Row { name: "bo", age: 2 }, Row { name: "ana", age: 30 }]
        const byAge = xs.sortByDescending { it.age }
        const byName = xs.sortByDescending { it.name }
        (byAge[0].name, byAge[1].name, byName[0].name, xs[0].name)
      `).value,
    ).toEqual({
      type: 'tuple',
      items: [
        { type: 'string', value: 'ana' },
        { type: 'string', value: 'bo' },
        { type: 'string', value: 'bo' },
        { type: 'string', value: 'bo' },
      ],
    })
  })

  it('rejects PHP rsort and sortByDescending on Map and T[] (ZEE-27)', () => {
    expect(() => execute('const xs = [3, 1]\nxs.rsort()')).toThrow(/rsort|field/)
    expect(() => execute('const xs = [3, 1]\nxs.arsort()')).toThrow(/arsort|field/)
    expect(() =>
      execute(`
        struct Row {
          const name: String
        }
        const xs = [Row { name: "a" }]
        xs.sortByDescending { it }
      `),
    ).toThrow(/Ord/)
    expect(() =>
      execute(`
        const ages: Map<String, i32> = { "bo": 2 }
        ages.sortByDescending { it }
      `),
    ).toThrow(/sortByKey|sortByValue|field/)
    expect(() =>
      execute(`
        var xs: i32[] = [3, 1]
        xs.sortByDescending { it }
      `),
    ).toThrow(/sortByDescending|field/)
  })

  it('first last reverse unique join and toString (ZEE-22)', () => {
    expect(
      execute(`
        const xs = [1, 2, 1, 3]
        const names = ["a", "b", "a"]
        const empty: List<i32> = []
        (
          xs.first() == Some(1),
          xs.last() == Some(3),
          empty.first() == None,
          empty.last() == None,
          xs.reverse(),
          xs.unique(),
          xs[0],
          names.join("-"),
          xs.toString()
        )
      `).value,
    ).toEqual({
      type: 'tuple',
      items: [
        { type: 'bool', value: true },
        { type: 'bool', value: true },
        { type: 'bool', value: true },
        { type: 'bool', value: true },
        {
          type: 'list',
          elem: { kind: 'i32' },
          items: [
            { type: 'i32', value: 3 },
            { type: 'i32', value: 1 },
            { type: 'i32', value: 2 },
            { type: 'i32', value: 1 },
          ],
        },
        {
          type: 'list',
          elem: { kind: 'i32' },
          items: [
            { type: 'i32', value: 1 },
            { type: 'i32', value: 2 },
            { type: 'i32', value: 3 },
          ],
        },
        { type: 'i32', value: 1 },
        { type: 'string', value: 'a-b-a' },
        { type: 'string', value: '[1, 2, 1, 3]' },
      ],
    })
  })

  it('rejects unique without Eq and join on non-String (ZEE-22)', () => {
    expect(() =>
      execute(`
        const xs: List<f64> = [1.0, 2.0]
        xs.unique()
      `),
    ).toThrow(/Eq/)
    expect(() => execute('const xs = [1, 2]\nxs.join(",")')).toThrow(/String/)
  })

  it('flattens List<List<T>> one level (ZEE-30)', () => {
    expect(
      execute(`
        const xs = [[1, 2], [3]]
        const deep = [[[1]], [[2, 3]]]
        const empty: List<List<i32>> = []
        (xs.flat(), xs[0][0], deep.flat().len, empty.flat().len)
      `).value,
    ).toEqual({
      type: 'tuple',
      items: [
        {
          type: 'list',
          elem: { kind: 'i32' },
          items: [
            { type: 'i32', value: 1 },
            { type: 'i32', value: 2 },
            { type: 'i32', value: 3 },
          ],
        },
        { type: 'i32', value: 1 },
        { type: 'usize', value: 2n },
        { type: 'usize', value: 0n },
      ],
    })
  })

  it('rejects flat on List<T> and Map (ZEE-30)', () => {
    expect(() => execute('const xs = [1, 2]\nxs.flat()')).toThrow(/flat|List<List/)
    expect(() => execute('var ages: Map<String, i32> = { "a": 1 }\nages.flat()')).toThrow(
      /flat|field/,
    )
  })

  it('folds counts zips groups flatMaps and mins (ZEE-26)', () => {
    expect(
      execute(`
        const xs = [1, 2, 3, 4]
        const empty: List<i32> = []
        const g = xs.groupBy { it % 2 }
        const z = xs.zip([10, 20])
        (
          xs.fold(0) { acc, x -> acc + x },
          empty.fold(9) { acc, x -> acc + x },
          xs.count { it > 2 },
          z.len,
          z[0],
          g.len,
          g[0] == Some([2, 4]),
          g[1] == Some([1, 3]),
          xs.flatMap { [it, it * 10] },
          xs.min() == Some(1),
          xs.max() == Some(4),
          empty.min() == None
        )
      `).value,
    ).toEqual({
      type: 'tuple',
      items: [
        { type: 'i32', value: 10 },
        { type: 'i32', value: 9 },
        { type: 'usize', value: 2n },
        { type: 'usize', value: 2n },
        {
          type: 'tuple',
          items: [
            { type: 'i32', value: 1 },
            { type: 'i32', value: 10 },
          ],
        },
        { type: 'usize', value: 2n },
        { type: 'bool', value: true },
        { type: 'bool', value: true },
        {
          type: 'list',
          elem: { kind: 'i32' },
          items: [
            { type: 'i32', value: 1 },
            { type: 'i32', value: 10 },
            { type: 'i32', value: 2 },
            { type: 'i32', value: 20 },
            { type: 'i32', value: 3 },
            { type: 'i32', value: 30 },
            { type: 'i32', value: 4 },
            { type: 'i32', value: 40 },
          ],
        },
        { type: 'bool', value: true },
        { type: 'bool', value: true },
        { type: 'bool', value: true },
      ],
    })
  })

  it('rejects min without Ord, Map fold, and take (ZEE-26)', () => {
    expect(() =>
      execute(`
        struct Row {
          const name: String
        }
        const xs = [Row { name: "a" }]
        xs.min()
      `),
    ).toThrow(/Ord/)
    expect(() => execute('var ages: Map<String, i32> = { "a": 1 }\nages.fold(0) { acc, x -> acc }')).toThrow(
      /fold|field/,
    )
    expect(() => execute('const xs = [1, 2]\nxs.take(1)')).toThrow(/take|slice|field/)
    expect(() => execute('const xs = [1, 2]\nxs.drop(1)')).toThrow(/drop|slice|field/)
  })
})
