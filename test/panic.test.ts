import { describe, expect, it } from 'vitest'
import { PanicError, ZeeError } from '../src/error.ts'
import { execute } from '../src/zee.ts'

describe('panic / Never (AC-panic)', () => {
  it('aborts with the given message', () => {
    expect(() => execute('panic("x")')).toThrow(PanicError)
    expect(() => execute('panic("x")')).toThrow(/x/)
  })

  it('type-checks Never on the right of ?:', () => {
    expect(() => execute('None ?: panic("missing")')).toThrow(PanicError)
    expect(() => execute('None ?: panic("missing")')).toThrow(/missing/)
    expect(() =>
      execute(`
        fn nameOf(opt: Option<String>) -> String {
          opt ?: panic("missing name")
        }
        nameOf(None)
      `),
    ).toThrow(/missing name/)
  })

  it('allows panic as a match arm', () => {
    expect(
      execute(`
        fn label(n: i32) -> String {
          match n {
            1 => "ok"
            _ => panic("nope")
          }
        }
        label(1)
      `).value,
    ).toEqual({ type: 'string', value: 'ok' })

    expect(() =>
      execute(`
        fn label(n: i32) -> String {
          match n {
            1 => "ok"
            _ => panic("nope")
          }
        }
        label(0)
      `),
    ).toThrow(/nope/)
  })

  it('does not treat overflow as PanicError at top level', () => {
    expect(() => execute('120i8 + 10i8')).toThrow(ZeeError)
    expect(() => execute('120i8 + 10i8')).not.toThrow(PanicError)
  })
})
