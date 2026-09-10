import { describe, expect, it } from 'vitest'
import { execute } from '../src/zee.ts'

describe('loops (AC-loops)', () => {
  it('counts down with while', () => {
    expect(
      execute(`
        var remaining = 3
        while remaining > 0 {
          remaining = remaining - 1
        }
        remaining
      `).value,
    ).toEqual({ type: 'i32', value: 0 })
  })

  it('skips the while body when the condition starts false', () => {
    expect(
      execute(`
        var n = 1
        while false {
          n = 0
        }
        n
      `).value,
    ).toEqual({ type: 'i32', value: 1 })
  })

  it('runs until the condition becomes true', () => {
    expect(
      execute(`
        var n = 0
        until n == 3 {
          n = n + 1
        }
        n
      `).value,
    ).toEqual({ type: 'i32', value: 3 })
  })

  it('runs do-while at least once', () => {
    expect(
      execute(`
        var n = 0
        do {
          n = n + 1
        } while false
        n
      `).value,
    ).toEqual({ type: 'i32', value: 1 })
  })

  it('runs do-until until the condition is true', () => {
    expect(
      execute(`
        var n = 0
        do {
          n = n + 1
        } until n == 2
        n
      `).value,
    ).toEqual({ type: 'i32', value: 2 })
  })

  it('break leaves the innermost loop', () => {
    expect(
      execute(`
        var n = 0
        while true {
          n = n + 1
          if n == 3 { break }
        }
        n
      `).value,
    ).toEqual({ type: 'i32', value: 3 })
  })

  it('continue skips the rest of the body', () => {
    expect(
      execute(`
        var n = 0
        var i = 0
        while i < 5 {
          i = i + 1
          if i == 3 { continue }
          n = n + 1
        }
        n
      `).value,
    ).toEqual({ type: 'i32', value: 4 })
  })

  it('lets return leave a loop', () => {
    expect(
      execute(`
        fn f() -> i32 {
          while true {
            return 9
          }
        }
        f()
      `).value,
    ).toEqual({ type: 'i32', value: 9 })
  })

  it('rejects a non-bool loop condition', () => {
    expect(() => execute('while 1 { }')).toThrow(/bool/)
    expect(() => execute('until 1 { }')).toThrow(/bool/)
  })

  it('rejects break and continue outside a loop', () => {
    expect(() => execute('break')).toThrow(/loop/)
    expect(() => execute('continue')).toThrow(/loop/)
  })

  it('rejects break inside a lambda even when the lambda is in a loop', () => {
    expect(() =>
      execute(`
        while true {
          const f: () -> Unit = { break }
          f()
        }
      `),
    ).toThrow(/loop/)
  })
})

describe('for (AC-for)', () => {
  it('runs a three-clause for and keeps the index in loop scope', () => {
    expect(
      execute(`
        var sum = 0
        for (var i = 0; i < 3; i = i + 1) {
          sum = sum + i
        }
        sum
      `).value,
    ).toEqual({ type: 'i32', value: 3 })
    expect(() =>
      execute(`
        for (var i = 0; i < 1; i = i + 1) { }
        i
      `),
    ).toThrow(/undefined/)
  })

  it('runs continue through the step clause', () => {
    expect(
      execute(`
        var sum = 0
        for (var i = 0; i < 4; i = i + 1) {
          if i == 1 { continue }
          sum = sum + i
        }
        sum
      `).value,
    ).toEqual({ type: 'i32', value: 5 })
  })

  it('breaks an infinite for', () => {
    expect(
      execute(`
        var n = 0
        for {
          n = n + 1
          if n == 2 { break }
        }
        n
      `).value,
    ).toEqual({ type: 'i32', value: 2 })
  })

  it('walks 0..n exclusive', () => {
    expect(
      execute(`
        var sum = 0
        for i in 0..4 {
          sum = sum + i
        }
        sum
      `).value,
    ).toEqual({ type: 'i32', value: 6 })
    expect(
      execute(`
        var n = 0
        for i in 0..0 {
          n = 1
        }
        n
      `).value,
    ).toEqual({ type: 'i32', value: 0 })
  })

  it('rejects a non-bool three-clause condition and collection for-in', () => {
    expect(() => execute('for (var i = 0; 1; i = i + 1) { }')).toThrow(/bool/)
    expect(() => execute('for x in 1 { }')).toThrow(/array/)
  })

  it('iterates for x in xs with break and continue', () => {
    expect(
      execute(`
        var sum = 0
        for x in [1, 2, 3, 4] {
          if x == 2 { continue }
          if x == 4 { break }
          sum = sum + x
        }
        sum
      `).value,
    ).toEqual({ type: 'i32', value: 4 })
  })

  it('iterates for (i, x) in xs with usize index and const element', () => {
    expect(
      execute(`
        var acc: usize = 0
        var sum = 0
        for (i, x) in [10, 20, 30] {
          acc = acc + i
          sum = sum + x
        }
        (acc, sum)
      `).value,
    ).toEqual({
      type: 'tuple',
      items: [
        { type: 'usize', value: 3n },
        { type: 'i32', value: 60 },
      ],
    })
  })

  it('honors break and continue in indexed for-in', () => {
    expect(
      execute(`
        var sum = 0
        for (i, x) in [1, 2, 3, 4] {
          if i == 1 { continue }
          if i == 3 { break }
          sum = sum + x
        }
        sum
      `).value,
    ).toEqual({ type: 'i32', value: 4 })
  })

  it('rejects assignment to indexed for-in bindings', () => {
    expect(() =>
      execute(`
        for (i, x) in [1] {
          i = 0
        }
      `),
    ).toThrow(/const/)
    expect(() =>
      execute(`
        for (i, x) in [1] {
          x = 0
        }
      `),
    ).toThrow(/const/)
  })

  it('still parses three-clause for when the header is not ident, ident', () => {
    expect(
      execute(`
        var sum = 0
        for (var i = 0; i < 3; i += 1) {
          sum = sum + i
        }
        sum
      `).value,
    ).toEqual({ type: 'i32', value: 3 })
  })
})
