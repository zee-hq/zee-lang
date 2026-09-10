import { describe, expect, it } from 'vitest'
import { execute } from '../src/zee.ts'

describe('Option operators (AC-option-ops)', () => {
  it('unwraps with ?: and does not treat 0 or empty string as missing', () => {
    expect(execute('Some(40) ?: 1').value).toEqual({ type: 'i32', value: 40 })
    expect(execute('Some(0) ?: 1').value).toEqual({ type: 'i32', value: 0 })
    expect(
      execute(`
        var name: Option<String> = None
        name ?: "anonymous"
      `).value,
    ).toEqual({ type: 'string', value: 'anonymous' })
    expect(execute('Some("") ?: "x"').value).toEqual({ type: 'string', value: '' })
  })

  it('rejects ?: on a non-Option', () => {
    expect(() => execute('1 ?: 2')).toThrow(/Option/)
  })

  it('fills None with ??= and updates Some with !!=', () => {
    expect(
      execute(`
        var a: Option<i32> = None
        a ??= 1
        a ??= 9
        a
      `).value,
    ).toEqual({ type: 'option', tag: 'some', value: { type: 'i32', value: 1 } })

    expect(
      execute(`
        var a: Option<i32> = Some(1)
        a !!= 2
        a
      `).value,
    ).toEqual({ type: 'option', tag: 'some', value: { type: 'i32', value: 2 } })

    expect(
      execute(`
        var b: Option<i32> = None
        b !!= 2
        b
      `).value,
    ).toEqual({ type: 'option', tag: 'none' })
  })

  it('rejects ??= and !!= on const and on non-Option', () => {
    expect(() => execute('const a: Option<i32> = None\na ??= 1')).toThrow(/const/)
    expect(() => execute('var n = 1\nn ??= 2')).toThrow(/Option/)
  })

  it('short-circuits &&= and ||= on var bool', () => {
    expect(
      execute(`
        var called = false
        fn mark() -> bool {
          called = true
          true
        }
        var ok = false
        ok &&= mark()
        called
      `).value,
    ).toEqual({ type: 'bool', value: false })

    expect(
      execute(`
        var called = false
        fn mark() -> bool {
          called = true
          false
        }
        var ok = true
        ok ||= mark()
        called
      `).value,
    ).toEqual({ type: 'bool', value: false })

    expect(
      execute(`
        var ok = true
        ok &&= false
        ok
      `).value,
    ).toEqual({ type: 'bool', value: false })

    expect(
      execute(`
        var ok = false
        ok ||= true
        ok
      `).value,
    ).toEqual({ type: 'bool', value: true })

    expect(
      execute(`
        var called = false
        fn mark() -> bool {
          called = true
          true
        }
        var ok = false
        ok ||= mark()
        called
      `).value,
    ).toEqual({ type: 'bool', value: true })
  })

  it('rejects ||= on non-bool', () => {
    expect(() => execute('var n = 1\nn ||= 2')).toThrow(/bool/)
  })

  it('lets ?: return from the enclosing function', () => {
    expect(
      execute(`
        fn f() -> i32 {
          const x: Option<i32> = None
          x ?: return 7
          1
        }
        f()
      `).value,
    ).toEqual({ type: 'i32', value: 7 })
  })
})

describe('three-way compare <===> (AC-spaceship)', () => {
  it('returns -1, 0, or 1 for integers and strings', () => {
    expect(execute('1 <===> 2').value).toEqual({ type: 'i32', value: -1 })
    expect(execute('2 <===> 2').value).toEqual({ type: 'i32', value: 0 })
    expect(execute('3 <===> 1').value).toEqual({ type: 'i32', value: 1 })
    expect(execute('"a" <===> "b"').value).toEqual({ type: 'i32', value: -1 })
    expect(execute('"zee" <===> "zee"').value).toEqual({ type: 'i32', value: 0 })
  })

  it('orders strings with < and rejects mixed or non-Ord types', () => {
    expect(execute('"a" < "b"').value).toEqual({ type: 'bool', value: true })
    expect(() => execute('1 <===> 2i64')).toThrow(/not defined|expected/)
    expect(() => execute('true <===> false')).toThrow(/not defined/)
  })

  it('does not leak an i32 result context onto <===> operands', () => {
    expect(execute('const x: i32 = "a" <===> "b"\nx').value).toEqual({ type: 'i32', value: -1 })
  })
})
