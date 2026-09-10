import { describe, expect, it } from 'vitest'
import { execute } from '../src/zee.ts'

describe('struct (AC-struct)', () => {
  it('constructs a value object and reads fields', () => {
    expect(
      execute(`
        struct Point {
          const x: i32
          var y: i32
        }
        const p = Point { x: 3, y: 4 }
        p.x + p.y
      `).value,
    ).toEqual({ type: 'i32', value: 7 })
  })

  it('copies on assign so mutating one var does not change the other', () => {
    expect(
      execute(`
        struct Point {
          var x: i32
          var y: i32
        }
        var p = Point { x: 1, y: 2 }
        var q = p
        q.x = 9
        p.x
      `).value,
    ).toEqual({ type: 'i32', value: 1 })
  })

  it('allows writing a var field only on a var binding', () => {
    expect(
      execute(`
        struct Point {
          const x: i32
          var y: i32
        }
        var p = Point { x: 1, y: 2 }
        p.y = 8
        p.y
      `).value,
    ).toEqual({ type: 'i32', value: 8 })
    expect(() =>
      execute(`
        struct Point {
          const x: i32
          var y: i32
        }
        var p = Point { x: 1, y: 2 }
        p.x = 0
      `),
    ).toThrow(/const/)
    expect(() =>
      execute(`
        struct Point {
          var y: i32
        }
        const p = Point { y: 2 }
        p.y = 8
      `),
    ).toThrow(/const/)
  })

  it('compares data structs by value and rejects writes on readonly', () => {
    expect(
      execute(`
        data struct Point {
          const x: i32
          const y: i32
        }
        Point { x: 1, y: 2 } == Point { x: 1, y: 2 }
      `).value,
    ).toEqual({ type: 'bool', value: true })
    expect(() =>
      execute(`
        struct Point {
          const x: i32
        }
        Point { x: 1 } == Point { x: 1 }
      `),
    ).toThrow(/not defined/)
    expect(() =>
      execute(`
        readonly struct Config {
          var port: i32
        }
        var cfg = Config { port: 80 }
        cfg.port = 443
      `),
    ).toThrow(/readonly/)
  })
})
