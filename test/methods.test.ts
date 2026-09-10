import { describe, expect, it } from 'vitest'
import { parse } from '../src/parser.ts'
import { execute } from '../src/zee.ts'

describe('methods / self (AC-method-ufcs)', () => {
  it('calls p.mag() and reads fields through self', () => {
    expect(
      execute(`
        struct Point {
          const x: i32
          const y: i32
        }
        fn mag(self: Point) -> i32 {
          self.x * self.x + self.y * self.y
        }
        const p = Point { x: 3, y: 4 }
        p.mag()
      `).value,
    ).toEqual({ type: 'i32', value: 25 })
  })

  it('parses p.mag() as a call on a member, not only field read', () => {
    const program = parse(`
      struct Point {
        const x: i32
      }
      fn mag(self: Point) -> i32 { self.x }
      const p = Point { x: 3 }
      p.mag()
    `)
    const last = program.stmts[program.stmts.length - 1]
    expect(last?.kind).toBe('expr')
    if (last?.kind !== 'expr') return
    expect(last.expr.kind).toBe('call')
    if (last.expr.kind !== 'call') return
    expect(last.expr.callee.kind).toBe('member')
    if (last.expr.callee.kind !== 'member') return
    expect(last.expr.callee.field).toBe('mag')
    expect(last.expr.args).toHaveLength(0)
  })

  it('passes extra arguments after self', () => {
    expect(
      execute(`
        struct Point {
          const x: i32
        }
        fn addX(self: Point, n: i32) -> i32 {
          self.x + n
        }
        const p = Point { x: 3 }
        p.addX(7)
      `).value,
    ).toEqual({ type: 'i32', value: 10 })
  })

  it('allows var self to mutate a var binding', () => {
    expect(
      execute(`
        struct Point {
          const x: i32
          var y: i32
        }
        fn bump(var self: Point) {
          self.y = self.y + 1
        }
        var p = Point { x: 1, y: 2 }
        p.bump()
        p.y
      `).value,
    ).toEqual({ type: 'i32', value: 3 })
  })

  it('rejects calling a mutating method on a const binding', () => {
    expect(() =>
      execute(`
        struct Point {
          var y: i32
        }
        fn bump(var self: Point) {
          self.y = self.y + 1
        }
        const p = Point { y: 2 }
        p.bump()
      `),
    ).toThrow(/const/)
  })

  it('rejects field writes through read-only self', () => {
    expect(() =>
      execute(`
        struct Point {
          var y: i32
        }
        fn bump(self: Point) {
          self.y = 8
        }
        var p = Point { y: 2 }
        p.bump()
      `),
    ).toThrow(/const/)
  })

  it('still reads struct fields and tuple .0', () => {
    expect(
      execute(`
        struct Point {
          const x: i32
        }
        const p = Point { x: 3 }
        const pair = (p.x, 4)
        p.x + pair.0
      `).value,
    ).toEqual({ type: 'i32', value: 6 })
  })
})
