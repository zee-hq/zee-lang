import { describe, expect, it } from 'vitest'
import { ZeeError } from '../src/error.ts'
import { execute } from '../src/zee.ts'

describe('match (AC-match-php)', () => {
  it('matches literals, combines patterns with |, and uses _ as default', () => {
    expect(
      execute(`
        fn label(code: i32) -> String {
          match code {
            200 | 201 => "ok"
            404 => "missing"
            _ => "other"
          }
        }
        label(201)
      `).value,
    ).toEqual({ type: 'string', value: 'ok' })

    expect(
      execute(`
        fn label(code: i32) -> String {
          match code {
            200 | 201 => "ok"
            404 => "missing"
            _ => "other"
          }
        }
        label(500)
      `).value,
    ).toEqual({ type: 'string', value: 'other' })
  })

  it('is exhaustive on bool without _', () => {
    expect(
      execute(`
        match true {
          true => 1
          false => 0
        }
      `).value,
    ).toEqual({ type: 'i32', value: 1 })
  })

  it('rejects a non-exhaustive match on i32', () => {
    expect(() =>
      execute(`
        match 1 {
          1 => "one"
        }
      `),
    ).toThrow(ZeeError)
    expect(() =>
      execute(`
        match 1 {
          1 => "one"
        }
      `),
    ).toThrow(/exhaustive/)
  })

  it('rejects arms of different types', () => {
    expect(() =>
      execute(`
        match 1 {
          1 => 1
          _ => "no"
        }
      `),
    ).toThrow(/different types/)
  })

  it('compares Option with None using ==, not coercing truthiness', () => {
    expect(
      execute(`
        fn label(err: Option<Error>) -> String {
          match err {
            None => "ok"
            _ => "fail"
          }
        }
        label(None)
      `).value,
    ).toEqual({ type: 'string', value: 'ok' })

    expect(
      execute(`
        fn label(err: Option<Error>) -> String {
          match err {
            None => "ok"
            _ => "fail"
          }
        }
        label(Some(error("empty")))
      `).value,
    ).toEqual({ type: 'string', value: 'fail' })
  })
})
