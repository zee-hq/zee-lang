import { describe, expect, it } from 'vitest'
import { execute } from '../src/zee.ts'

describe('Regex stdlib (AC-regex)', () => {
  it('matches unanchored Unicode patterns via Regex.of (AC-regex-match)', () => {
    expect(
      execute(`
        const (re, err) = Regex.of("[A-Z]")
        (err.isNone(), re.isMatch("Abc"), re.isMatch("abc"))
      `).value,
    ).toEqual({
      type: 'tuple',
      items: [
        { type: 'bool', value: true },
        { type: 'bool', value: true },
        { type: 'bool', value: false },
      ],
    })
  })

  it('returns err and a non-matching dummy on a bad pattern (AC-regex-err)', () => {
    expect(
      execute(`
        const (re, err) = Regex.of("[")
        (err.isSome(), re.isMatch("a"))
      `).value,
    ).toEqual({
      type: 'tuple',
      items: [
        { type: 'bool', value: true },
        { type: 'bool', value: false },
      ],
    })
  })
})
