import { describe, expect, it } from 'vitest'
import { tokenize } from '../src/lexer.ts'
import { ZeeError } from '../src/error.ts'

describe('lexer', () => {
  it('tokenizes visibility and import keywords', () => {
    expect(tokenize('import http pub fn internal const as').map((token) => token.kind)).toEqual([
      'import',
      'ident',
      'pub',
      'fn',
      'internal',
      'const',
      'as',
      'eof',
    ])
  })

  it('tokenizes toString as an identifier, not Object.prototype.toString (ZEE-22)', () => {
    expect(tokenize('xs.toString()').map((token) => token.kind)).toEqual([
      'ident',
      '.',
      'ident',
      '(',
      ')',
      'eof',
    ])
  })

  it('tokenizes enum and sealed keywords', () => {
    expect(tokenize('pub enum Status sealed struct Shape').map((token) => token.kind)).toEqual([
      'pub',
      'enum',
      'ident',
      'sealed',
      'struct',
      'ident',
      'eof',
    ])
  })

  it('tokenizes @ before any identifier', () => {
    expect(tokenize('@Get @Trace @Foo').map((token) => token.kind)).toEqual([
      '@',
      'ident',
      '@',
      'ident',
      '@',
      'ident',
      'eof',
    ])
  })

  it('tokenizes type, newtype, interface, implements, and is', () => {
    expect(
      tokenize('type Handler newtype UserId interface Closeable implements is').map((token) => token.kind),
    ).toEqual(['type', 'ident', 'newtype', 'ident', 'interface', 'ident', 'implements', 'is', 'eof'])
  })

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

  it('tokenizes remainder and tuple index dots', () => {
    const kinds = tokenize('pair.0 % 2').map((token) => token.kind)
    expect(kinds).toEqual(['ident', '.', 'number', '%', 'number', 'eof'])
  })

  it('tokenizes float literals without stealing tuple index dots', () => {
    expect(tokenize('1.0 1.0f32 pair.0').map((token) => token.kind)).toEqual([
      'number',
      'number',
      'ident',
      '.',
      'number',
      'eof',
    ])
    expect(tokenize('1.0')[0]?.lexeme).toBe('1.0')
    expect(tokenize('1.0f32')[0]?.lexeme).toBe('1.0f32')
  })

  it('tokenizes loop keywords', () => {
    expect(tokenize('while until do break continue').map((token) => token.kind)).toEqual([
      'while',
      'until',
      'do',
      'break',
      'continue',
      'eof',
    ])
  })

  it('tokenizes panic and defer keywords', () => {
    expect(tokenize('panic defer').map((token) => token.kind)).toEqual(['panic', 'defer', 'eof'])
  })

  it('tokenizes match arms', () => {
    const kinds = tokenize('match x { 1 | 2 => "a" _ => "b" }').map((token) => token.kind)
    expect(kinds).toEqual([
      'match',
      'ident',
      '{',
      'number',
      '|',
      'number',
      '=>',
      'string',
      'ident',
      '=>',
      'string',
      '}',
      'eof',
    ])
  })

  it('tokenizes hex, binary, separators, and integer suffixes', () => {
    const tokens = tokenize('0xFF 0b1010 1_000 40u8 redim x')
    expect(tokens.map((token) => token.kind)).toEqual([
      'number',
      'number',
      'number',
      'number',
      'redim',
      'ident',
      'eof',
    ])
    expect(tokens[0]?.lexeme).toBe('0xFF')
    expect(tokens[3]?.lexeme).toBe('40u8')
  })

  it('rejects unterminated strings', () => {
    expect(() => tokenize('"nope')).toThrow(ZeeError)
  })

  it('tokenizes compound assign ops with longest match before + and =', () => {
    expect(tokenize('i += 1 i -= 1 i *= 2 i /= 2 i %= 10 a + b a = 1').map((token) => token.kind)).toEqual([
      'ident',
      '+=',
      'number',
      'ident',
      '-=',
      'number',
      'ident',
      '*=',
      'number',
      'ident',
      '/=',
      'number',
      'ident',
      '%=',
      'number',
      'ident',
      '+',
      'ident',
      'ident',
      '=',
      'number',
      'eof',
    ])
    expect(tokenize('a // c\nb /= 2').map((token) => token.kind)).toEqual([
      'ident',
      'ident',
      '/=',
      'number',
      'eof',
    ])
  })

  it('tokenizes Option and bool assign ops without stealing != or ||', () => {
    expect(tokenize('a ??= 1 a !!= 2 a != 3').map((token) => token.kind)).toEqual([
      'ident',
      '??=',
      'number',
      'ident',
      '!!=',
      'number',
      'ident',
      '!=',
      'number',
      'eof',
    ])
    expect(tokenize('ok &&= x ok ||= y a || b').map((token) => token.kind)).toEqual([
      'ident',
      '&&=',
      'ident',
      'ident',
      '||=',
      'ident',
      'ident',
      '||',
      'ident',
      'eof',
    ])
  })

  it('tokenizes <===> before <= and rejects bare ??', () => {
    expect(tokenize('a <===> b a <= c a ?: d').map((token) => token.kind)).toEqual([
      'ident',
      '<===>',
      'ident',
      'ident',
      '<=',
      'ident',
      'ident',
      '?:',
      'ident',
      'eof',
    ])
    expect(() => tokenize('a ?? b')).toThrow(/use `\?:`/)
  })

  it('tokenizes for, in, and exclusive ranges without stealing tuple dots', () => {
    expect(tokenize('for i in 0..n pair.0').map((token) => token.kind)).toEqual([
      'for',
      'ident',
      'in',
      'number',
      '..',
      'ident',
      'ident',
      '.',
      'number',
      'eof',
    ])
  })

  it('tokenizes array brackets and struct keywords', () => {
    expect(tokenize('struct data readonly preserve xs[0]').map((token) => token.kind)).toEqual([
      'struct',
      'data',
      'readonly',
      'preserve',
      'ident',
      '[',
      'number',
      ']',
      'eof',
    ])
  })

  it('tokenizes class and identity operators with longest match before == and !=', () => {
    expect(tokenize('class User a === b a == c a !== d a != e').map((token) => token.kind)).toEqual([
      'class',
      'ident',
      'ident',
      '===',
      'ident',
      'ident',
      '==',
      'ident',
      'ident',
      '!==',
      'ident',
      'ident',
      '!=',
      'ident',
      'eof',
    ])
    expect(tokenize('a <===> b a === c').map((token) => token.kind)).toEqual([
      'ident',
      '<===>',
      'ident',
      'ident',
      '===',
      'ident',
      'eof',
    ])
  })

  it('tokenizes interpolating strings, Char literals, and raw blocks', () => {
    expect(tokenize('`hello, {name}`').map((token) => token.kind)).toEqual([
      'interpStart',
      'string',
      '{',
      'ident',
      '}',
      'interpEnd',
      'eof',
    ])
    expect(tokenize("'a'")[0]).toMatchObject({ kind: 'char', lexeme: 'a' })
    const raw = tokenize('```\nline one\nline two\n```')
    expect(raw[0]?.kind).toBe('string')
    expect(raw[0]?.lexeme).toBe('line one\nline two')
  })

  it('tokenizes bitwise ops without eating && or match |', () => {
    expect(tokenize('a & b | c ^ ~d << e >> f').map((token) => token.kind)).toEqual([
      'ident',
      '&',
      'ident',
      '|',
      'ident',
      '^',
      '~',
      'ident',
      '<<',
      'ident',
      '>>',
      'ident',
      'eof',
    ])
    expect(tokenize('a && b || c').map((token) => token.kind)).toEqual([
      'ident',
      '&&',
      'ident',
      '||',
      'ident',
      'eof',
    ])
    expect(tokenize('x &= 1 x |= 1 x ^= 1 x <<= 1 x >>= 1').map((token) => token.kind)).toEqual([
      'ident',
      '&=',
      'number',
      'ident',
      '|=',
      'number',
      'ident',
      '^=',
      'number',
      'ident',
      '<<=',
      'number',
      'ident',
      '>>=',
      'number',
      'eof',
    ])
    expect(tokenize('a >>> 1').map((token) => token.kind)).toEqual([
      'ident',
      '>>',
      '>',
      'number',
      'eof',
    ])
  })

  it('tokenizes /// and //! docs and still skips //', () => {
    expect(tokenize('/// Opens path.\nfn f() {}').map((token) => token.kind)).toEqual([
      'doc',
      'fn',
      'ident',
      '(',
      ')',
      '{',
      '}',
      'eof',
    ])
    expect(tokenize('/// Opens path.')[0]?.lexeme).toBe('Opens path.')
    expect(tokenize('//! HTTP client.\nfn f() {}').map((token) => token.kind)).toEqual([
      'innerDoc',
      'fn',
      'ident',
      '(',
      ')',
      '{',
      '}',
      'eof',
    ])
    expect(tokenize('// not a doc\nfn f() {}').map((token) => token.kind)).toEqual([
      'fn',
      'ident',
      '(',
      ')',
      '{',
      '}',
      'eof',
    ])
    expect(tokenize('//// not a doc\nfn f() {}').map((token) => token.kind)).toEqual([
      'fn',
      'ident',
      '(',
      ')',
      '{',
      '}',
      'eof',
    ])
  })
})
