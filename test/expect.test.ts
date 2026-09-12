import { describe, expect, it } from 'vitest'
import { PanicError } from '../src/error.ts'
import { execute } from '../src/zee.ts'

describe('expect', () => {
  it('passes toBe and toEqual on matching values', () => {
    expect(execute('expect(1).toBe(1)').value).toEqual({ type: 'unit' })
    expect(execute('expect("ada").toBe("ada")').value).toEqual({ type: 'unit' })
    expect(
      execute(`
        data struct Point {
          const x: i32
          const y: i32
        }
        expect(Point { x: 1, y: 2 }).toEqual(Point { x: 1, y: 2 })
      `).value,
    ).toEqual({ type: 'unit' })
  })

  it('panics with a mismatch message when toBe fails', () => {
    expect(() => execute('expect(1).toBe(2)')).toThrow(PanicError)
    expect(() => execute('expect(1).toBe(2)')).toThrow(/expected 1 to be 2/)
    expect(() => execute('expect("ada").toBe("bob")')).toThrow(/expected "ada" to be "bob"/)
  })

  it('negates with expect(x).not.toBe(y)', () => {
    expect(execute('expect(1).not.toBe(2)').value).toEqual({ type: 'unit' })
    expect(() => execute('expect(1).not.toBe(1)')).toThrow(/expected 1 not to be 1/)
  })

  it('rejects expect on a non-Eq type', () => {
    expect(() =>
      execute(`
        struct Point { const x: i32 }
        expect(Point { x: 1 }).toBe(Point { x: 1 })
      `),
    ).toThrow(/Eq/)
  })
})

describe('describe (test grouping)', () => {
  it('is a no-op call with a string literal', () => {
    expect(execute('describe("UserRow")').value).toEqual({ type: 'unit' })
  })

  it('needs a string literal, not a computed String', () => {
    expect(() =>
      execute(`
        const title = "UserRow"
        describe(title)
      `),
    ).toThrow(/string literal/)
  })

  it('does not run fn inside describe("title") { } at load time', () => {
    expect(execute('describe("x") { fn testY() { panic("no") } }').value).toEqual({ type: 'unit' })
  })
})
