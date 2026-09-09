import { describe, expect, it } from 'vitest'
import { tokenize } from '../src/lexer.ts'
import { ZeeError } from '../src/error.ts'

describe('lexer', () => {
  it('tokenizes keywords, numbers, and arrows', () => {
    const kinds = tokenize('fn main() -> i32 { 1 }').map((token) => token.kind)
    expect(kinds).toEqual([
      'fn',
      'ident',
      '(',
      ')',
      '->',
      'ident',
      '{',
      'number',
      '}',
      'eof',
    ])
  })

  it('tokenizes strings with escapes and skips comments', () => {
    const tokens = tokenize('// c\n"hi\\n" /* block */ +')
    expect(tokens.map((token) => token.kind)).toEqual(['string', '+', 'eof'])
    expect(tokens[0]?.lexeme).toBe('hi\n')
  })

  it('rejects unterminated strings', () => {
    expect(() => tokenize('"nope')).toThrow(ZeeError)
  })
})
