import { describe, expect, it } from 'vitest'
import { ZeeError } from '../src/error.ts'
import { parse } from '../src/parser.ts'
import { execute } from '../src/zee.ts'

const USER = `
  class User {
    const name: String
    var age: i32
  }
`

describe('class (AC-class-identity)', () => {
  it('constructs an identity object and reads fields', () => {
    expect(
      execute(`
        ${USER}
        const a = User { name: "ana", age: 1 }
        a.age
      `).value,
    ).toEqual({ type: 'i32', value: 1 })
  })

  it('parses class declarations the same way as struct', () => {
    const program = parse(`
      ${USER}
      var a = User { name: "ana", age: 1 }
    `)
    const decl = program.stmts[0]
    expect(decl?.kind).toBe('structDecl')
    if (decl?.kind !== 'structDecl') return
    expect(decl.identity).toBe(true)
    expect(decl.sealed).toBe(false)
    expect(decl.fields.map((field) => field.name)).toEqual(['name', 'age'])
  })

  it('shares the object on assign so mutating one var is visible on the other', () => {
    expect(
      execute(`
        ${USER}
        var a = User { name: "ana", age: 1 }
        var b = a
        a.age = 2
        b.age
      `).value,
    ).toEqual({ type: 'i32', value: 2 })
  })

  it('compares identity with === and !==', () => {
    expect(
      execute(`
        ${USER}
        var a = User { name: "ana", age: 1 }
        var b = a
        a === b
      `).value,
    ).toEqual({ type: 'bool', value: true })
    expect(
      execute(`
        ${USER}
        var a = User { name: "ana", age: 2 }
        a === User { name: "ana", age: 2 }
      `).value,
    ).toEqual({ type: 'bool', value: false })
    expect(
      execute(`
        ${USER}
        var a = User { name: "ana", age: 1 }
        var b = User { name: "ana", age: 1 }
        a !== b
      `).value,
    ).toEqual({ type: 'bool', value: true })
  })

  it('rejects === on struct, i32, and List', () => {
    expect(() =>
      execute(`
        struct Point {
          var x: i32
        }
        var p = Point { x: 1 }
        p === p
      `),
    ).toThrow(/class/)
    expect(() => execute('1 === 1')).toThrow(/class/)
    expect(() => execute('const xs = [1, 2]\nxs === xs')).toThrow(/class/)
  })

  it('rejects == on a plain class that is not Eq', () => {
    expect(() =>
      execute(`
        ${USER}
        var a = User { name: "ana", age: 1 }
        a == a
      `),
    ).toThrow(/not defined/)
  })

  it('compares data class by fields and still uses === for identity', () => {
    expect(
      execute(`
        data class Point {
          const x: i32
          const y: i32
        }
        Point { x: 1, y: 2 } == Point { x: 1, y: 2 }
      `).value,
    ).toEqual({ type: 'bool', value: true })
    expect(
      execute(`
        data class Point {
          const x: i32
          const y: i32
        }
        const p = Point { x: 1, y: 2 }
        p === Point { x: 1, y: 2 }
      `).value,
    ).toEqual({ type: 'bool', value: false })
  })

  it('rejects field writes on a readonly class even on a var binding', () => {
    expect(() =>
      execute(`
        readonly class Config {
          const host: String
          var port: i32
        }
        var cfg = Config { host: "localhost", port: 80 }
        cfg.port = 443
      `),
    ).toThrow(/readonly/)
  })

  it('lets var self mutate the shared object', () => {
    expect(
      execute(`
        ${USER}
        fn bump(var self: User) {
          self.age = self.age + 1
        }
        var a = User { name: "ana", age: 1 }
        var b = a
        a.bump()
        b.age
      `).value,
    ).toEqual({ type: 'i32', value: 2 })
  })

  it('matches sealed class variants exhaustively', () => {
    expect(
      execute(`
        sealed class Shape {
          data class Circle {
            const r: i32
          }
          data class Rect {
            const w: i32
            const h: i32
          }
        }
        const shape = Shape.Circle { r: 3 }
        match shape {
          Shape.Circle { r } => r * r
          Shape.Rect { w, h } => w * h
        }
      `).value,
    ).toEqual({ type: 'i32', value: 9 })
  })

  it('shares a sealed class variant on assign and uses === for identity', () => {
    expect(
      execute(`
        sealed class Shape {
          data class Circle {
            const r: i32
          }
          data class Rect {
            const w: i32
            const h: i32
          }
        }
        var a = Shape.Circle { r: 3 }
        var b = a
        a === b
      `).value,
    ).toEqual({ type: 'bool', value: true })
    expect(
      execute(`
        sealed class Shape {
          data class Circle {
            const r: i32
          }
        }
        var a = Shape.Circle { r: 3 }
        a === Shape.Circle { r: 3 }
      `).value,
    ).toEqual({ type: 'bool', value: false })
  })

  it('rejects a non-exhaustive sealed class match', () => {
    expect(() =>
      execute(`
        sealed class Shape {
          data class Circle {
            const r: i32
          }
          data class Rect {
            const w: i32
            const h: i32
          }
        }
        match Shape.Circle { r: 1 } {
          Shape.Circle { r } => r
        }
      `),
    ).toThrow(ZeeError)
    expect(() =>
      execute(`
        sealed class Shape {
          data class Circle {
            const r: i32
          }
          data class Rect {
            const w: i32
            const h: i32
          }
        }
        match Shape.Circle { r: 1 } {
          Shape.Circle { r } => r
        }
      `),
    ).toThrow(/exhaustive/)
  })

  it('still copies structs on assign', () => {
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

  it('copies data struct and data class with named field replacements', () => {
    expect(
      execute(`
        data struct Point {
          const x: i32
          const y: i32
        }
        const p = Point { x: 3, y: 4 }
        const q = p.copy(x: 0)
        q.x + q.y
      `).value,
    ).toEqual({ type: 'i32', value: 4 })
    expect(
      execute(`
        data class Point {
          const x: i32
          const y: i32
        }
        const p = Point { x: 1, y: 2 }
        const q = p.copy(x: 0)
        q == Point { x: 0, y: 2 }
      `).value,
    ).toEqual({ type: 'bool', value: true })
    expect(
      execute(`
        data class Point {
          const x: i32
          const y: i32
        }
        const p = Point { x: 1, y: 2 }
        p.copy(x: 0) === p
      `).value,
    ).toEqual({ type: 'bool', value: false })
  })

  it('rejects copy on a plain class', () => {
    expect(() =>
      execute(`
        ${USER}
        var a = User { name: "ana", age: 1 }
        a.copy(age: 2)
      `),
    ).toThrow(/data/)
  })
})
