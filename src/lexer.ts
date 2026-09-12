import { locOf, ZeeError, type Loc } from './error.ts'
import { isFloatKind, isIntKind } from './types.ts'

export type TokenKind =
  | 'eof'
  | 'number'
  | 'string'
  | 'char'
  | 'interpStart'
  | 'interpEnd'
  | 'ident'
  | 'fn'
  | 'const'
  | 'var'
  | 'redim'
  | 'if'
  | 'else'
  | 'match'
  | 'return'
  | 'while'
  | 'until'
  | 'do'
  | 'break'
  | 'continue'
  | 'for'
  | 'in'
  | 'struct'
  | 'class'
  | 'data'
  | 'readonly'
  | 'enum'
  | 'sealed'
  | 'type'
  | 'newtype'
  | 'interface'
  | 'implements'
  | 'is'
  | 'preserve'
  | 'true'
  | 'false'
  | 'import'
  | 'pub'
  | 'internal'
  | 'as'
  | 'panic'
  | 'defer'
  | '+'
  | '+='
  | '-'
  | '-='
  | '*'
  | '*='
  | '/'
  | '/='
  | '%'
  | '%='
  | '.'
  | '..'
  | '='
  | '=='
  | '==='
  | '=>'
  | '!='
  | '!=='
  | '<'
  | '<='
  | '>'
  | '>='
  | '!'
  | '&&'
  | '&&='
  | '&'
  | '&='
  | '||'
  | '||='
  | '|'
  | '|='
  | '^'
  | '^='
  | '~'
  | '<<'
  | '>>'
  | '<<='
  | '>>='
  | '?:'
  | '??='
  | '!!='
  | '<===>'
  | '('
  | ')'
  | '{'
  | '}'
  | '['
  | ']'
  | ','
  | ':'
  | '->'
  | ';'
  | '@'
  | 'doc'
  | 'innerDoc'

export interface Token {
  kind: TokenKind
  lexeme: string
  loc: Loc
}

export const KEYWORDS: Record<string, TokenKind> = {
  fn: 'fn',
  const: 'const',
  var: 'var',
  redim: 'redim',
  if: 'if',
  else: 'else',
  match: 'match',
  return: 'return',
  while: 'while',
  until: 'until',
  do: 'do',
  break: 'break',
  continue: 'continue',
  for: 'for',
  in: 'in',
  struct: 'struct',
  class: 'class',
  data: 'data',
  readonly: 'readonly',
  enum: 'enum',
  sealed: 'sealed',
  type: 'type',
  newtype: 'newtype',
  interface: 'interface',
  implements: 'implements',
  is: 'is',
  preserve: 'preserve',
  true: 'true',
  false: 'false',
  import: 'import',
  pub: 'pub',
  internal: 'internal',
  as: 'as',
  panic: 'panic',
  defer: 'defer',
}

export function tokenize(source: string, file = '<input>'): Token[] {
  const lexer = new Lexer(source, file)
  return lexer.tokenize()
}

class Lexer {
  private readonly tokens: Token[] = []
  private start = 0
  private current = 0
  private line = 1
  private column = 1
  private tokenColumn = 1

  constructor(
    private readonly source: string,
    private readonly file: string,
  ) {}

  tokenize(): Token[] {
    while (!this.isAtEnd()) {
      this.start = this.current
      this.tokenColumn = this.column
      this.scanToken()
    }
    this.tokens.push({
      kind: 'eof',
      lexeme: '',
      loc: locOf(this.file, this.line, this.column),
    })
    return this.tokens
  }

  private scanToken(): void {
    const char = this.advance()
    switch (char) {
      case '(':
      case ')':
      case '{':
      case '}':
      case '[':
      case ']':
      case ',':
      case ':':
      case ';':
      case '+':
      case '*':
      case '%':
        this.add(this.match('=') ? (`${char}=` as TokenKind) : char)
        break
      case '.':
        if (this.match('.')) {
          if (this.peek() === '=') {
            this.error('inclusive range `..=` is not in v0; use `0..n` (exclusive)')
          }
          this.add('..')
        } else {
          this.add('.')
        }
        break
      case '-':
        this.add(this.match('>') ? '->' : this.match('=') ? '-=' : '-')
        break
      case '!':
        if (this.peek() === '!' && this.peekNext() === '=') {
          this.advance()
          this.advance()
          this.add('!!=')
        } else if (this.peek() === '=' && this.peekNext() === '=') {
          this.advance()
          this.advance()
          this.add('!==')
        } else {
          this.add(this.match('=') ? '!=' : '!')
        }
        break
      case '=':
        if (this.match('=')) this.add(this.match('=') ? '===' : '==')
        else if (this.match('>')) this.add('=>')
        else this.add('=')
        break
      case '<':
        if (this.peek() === '=' && this.peekNext() === '=' && this.charAt(2) === '=' && this.charAt(3) === '>') {
          this.advance()
          this.advance()
          this.advance()
          this.advance()
          this.add('<===>')
        } else if (this.match('<')) {
          this.add(this.match('=') ? '<<=' : '<<')
        } else {
          this.add(this.match('=') ? '<=' : '<')
        }
        break
      case '>':
        if (this.match('>')) this.add(this.match('=') ? '>>=' : '>>')
        else this.add(this.match('=') ? '>=' : '>')
        break
      case '^':
        this.add(this.match('=') ? '^=' : '^')
        break
      case '~':
        this.add('~')
        break
      case '@':
        this.add('@')
        break
      case '?':
        if (this.match(':')) this.add('?:')
        else if (this.match('?')) {
          if (this.match('=')) this.add('??=')
          else this.error('use `?:` for Elvis; `??` is not a token')
        } else {
          this.error('unexpected character `?`')
        }
        break
      case '&':
        if (this.match('&')) this.add(this.match('=') ? '&&=' : '&&')
        else this.add(this.match('=') ? '&=' : '&')
        break
      case '|':
        if (this.match('|')) this.add(this.match('=') ? '||=' : '||')
        else this.add(this.match('=') ? '|=' : '|')
        break
      case '/':
        if (this.match('/')) {
          if (this.peek() === '/' && this.peekNext() !== '/') {
            this.advance()
            this.docLine('doc')
          } else if (this.peek() === '!') {
            this.advance()
            this.docLine('innerDoc')
          } else {
            while (this.peek() !== '\n' && !this.isAtEnd()) this.advance()
          }
        } else if (this.match('*')) {
          this.blockComment()
        } else {
          this.add(this.match('=') ? '/=' : '/')
        }
        break
      case '"':
        this.string()
        break
      case '`':
        if (this.peek() === '`' && this.peekNext() === '`') this.rawString()
        else this.interpolating()
        break
      case "'":
        this.charLiteral()
        break
      case ' ':
      case '\r':
      case '\t':
        break
      case '\n':
        this.line += 1
        this.column = 1
        break
      default:
        if (isDigit(char)) this.number()
        else if (isIdentStart(char)) this.ident()
        else this.error(`unexpected character \`${char}\``)
    }
  }

  private docLine(kind: 'doc' | 'innerDoc'): void {
    if (this.peek() === ' ') this.advance()
    const start = this.current
    while (this.peek() !== '\n' && !this.isAtEnd()) this.advance()
    this.tokens.push({
      kind,
      lexeme: this.source.slice(start, this.current),
      loc: locOf(this.file, this.line, this.tokenColumn),
    })
  }

  private blockComment(): void {
    while (!this.isAtEnd()) {
      if (this.peek() === '*' && this.peekNext() === '/') {
        this.advance()
        this.advance()
        return
      }
      if (this.peek() === '\n') {
        this.advance()
        this.line += 1
        this.column = 1
      } else {
        this.advance()
      }
    }
    this.error('unterminated block comment')
  }

  private string(): void {
    let value = ''
    while (this.peek() !== '"' && !this.isAtEnd()) {
      if (this.peek() === '\n') this.error('unterminated string')
      if (this.peek() === '\\') {
        this.advance()
        const escaped = this.advance()
        const mapped = unescape(escaped)
        if (mapped === undefined) this.error(`unknown escape \\${escaped}`)
        value += mapped
      } else {
        value += this.advance()
      }
    }
    if (this.isAtEnd()) this.error('unterminated string')
    this.advance()
    this.tokens.push({
      kind: 'string',
      lexeme: value,
      loc: locOf(this.file, this.line, this.tokenColumn),
    })
  }

  private interpolating(): void {
    this.add('interpStart')
    let text = ''
    let textLine = this.line
    let textColumn = this.column
    const flush = (): void => {
      if (text.length === 0) return
      this.tokens.push({
        kind: 'string',
        lexeme: text,
        loc: locOf(this.file, textLine, textColumn),
      })
      text = ''
    }
    while (!this.isAtEnd()) {
      if (this.peek() === '`') {
        flush()
        this.start = this.current
        this.tokenColumn = this.column
        this.advance()
        this.add('interpEnd')
        return
      }
      if (this.peek() === '\\') {
        const escLine = this.line
        const escColumn = this.column
        this.advance()
        if (this.isAtEnd()) this.error('unterminated interpolating string')
        const escaped = this.advance()
        if (escaped === '\n') {
          this.line += 1
          this.column = 1
        }
        const mapped = unescapeInterp(escaped)
        if (mapped === undefined) this.error(`unknown escape \\${escaped}`)
        if (text.length === 0) {
          textLine = escLine
          textColumn = escColumn
        }
        text += mapped
        continue
      }
      if (this.peek() === '{') {
        flush()
        this.start = this.current
        this.tokenColumn = this.column
        this.scanToken()
        this.scanInterpExpr()
        textLine = this.line
        textColumn = this.column
        continue
      }
      const line = this.line
      const column = this.column
      const char = this.advance()
      if (char === '\n') {
        this.line += 1
        this.column = 1
      }
      if (text.length === 0) {
        textLine = line
        textColumn = column
      }
      text += char
    }
    this.error('unterminated interpolating string')
  }

  private scanInterpExpr(): void {
    let depth = 1
    while (depth > 0 && !this.isAtEnd()) {
      this.start = this.current
      this.tokenColumn = this.column
      const before = this.tokens.length
      this.scanToken()
      if (this.tokens.length === before) continue
      const last = this.tokens[this.tokens.length - 1]!
      if (last.kind === 'interpEnd' || last.kind === 'interpStart') continue
      if (last.kind === '{') depth += 1
      if (last.kind === '}') depth -= 1
    }
    if (depth !== 0) this.error('unterminated interpolation')
  }

  private charLiteral(): void {
    if (this.isAtEnd() || this.peek() === "'") this.error('empty character literal')
    let value: string
    if (this.peek() === '\\') {
      this.advance()
      if (this.isAtEnd()) this.error('unterminated character literal')
      const escaped = this.advance()
      const mapped = unescapeChar(escaped)
      if (mapped === undefined) this.error(`unknown escape \\${escaped}`)
      value = mapped
    } else {
      value = this.readCodePoint()
    }
    if (this.peek() !== "'") {
      if (this.isAtEnd()) this.error('unterminated character literal')
      this.error('character literal must be one Unicode scalar')
    }
    this.advance()
    this.tokens.push({
      kind: 'char',
      lexeme: value,
      loc: locOf(this.file, this.line, this.tokenColumn),
    })
  }

  private readCodePoint(): string {
    const first = this.advance()
    const code = first.charCodeAt(0)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = this.peek().charCodeAt(0)
      if (next >= 0xdc00 && next <= 0xdfff) return first + this.advance()
    }
    return first
  }

  private rawString(): void {
    let n = 1
    while (this.peek() === '`') {
      this.advance()
      n += 1
    }
    while (isIdentPart(this.peek())) this.advance()
    if (this.peek() === '\r' && this.peekNext() === '\n') this.advance()
    if (this.peek() === '\n') {
      this.advance()
      this.line += 1
      this.column = 1
    }
    const lines: string[] = []
    let line = ''
    while (!this.isAtEnd()) {
      if (line.length === 0) {
        const close = this.matchClosingFence(n)
        if (close) {
          this.consumeRawFence(close.indent + n)
          const value = lines.map((item) => stripRawIndent(item, close.indent)).join('\n')
          this.tokens.push({
            kind: 'string',
            lexeme: value,
            loc: locOf(this.file, this.line, this.tokenColumn),
          })
          return
        }
      } else if (this.matchFenceOnly(n)) {
        this.consumeRawFence(n)
        this.tokens.push({
          kind: 'string',
          lexeme: line,
          loc: locOf(this.file, this.line, this.tokenColumn),
        })
        return
      }
      if (this.peek() === '\n') {
        this.advance()
        this.line += 1
        this.column = 1
        lines.push(line)
        line = ''
        continue
      }
      const char = this.advance()
      if (char === '\r' && this.peek() === '\n') continue
      line += char
    }
    this.error('unterminated raw string')
  }

  private matchClosingFence(n: number): { indent: number } | undefined {
    let i = 0
    let indent = 0
    while (this.charAt(i) === ' ' || this.charAt(i) === '\t') {
      indent += 1
      i += 1
    }
    let ticks = 0
    while (this.charAt(i) === '`') {
      ticks += 1
      i += 1
    }
    if (ticks !== n) return undefined
    const next = this.charAt(i)
    if (next !== '\0' && next !== '\n' && next !== '\r' && next !== ' ' && next !== '\t') return undefined
    return { indent }
  }

  private matchFenceOnly(n: number): boolean {
    let ticks = 0
    while (this.charAt(ticks) === '`') ticks += 1
    if (ticks !== n) return false
    const next = this.charAt(n)
    return next === '\0' || next === '\n' || next === '\r' || next === ' ' || next === '\t'
  }

  private consumeRawFence(count: number): void {
    for (let i = 0; i < count; i += 1) this.advance()
    while (this.peek() === ' ' || this.peek() === '\t') this.advance()
  }

  private number(): void {
    if (this.source[this.start] === '0' && (this.peek() === 'x' || this.peek() === 'X')) {
      this.advance()
      if (!isHexDigit(this.peek())) this.error('invalid hex literal')
      this.consumeDigits(isHexDigit)
      this.tryIntSuffix()
      this.add('number')
      return
    }
    if (this.source[this.start] === '0' && (this.peek() === 'b' || this.peek() === 'B')) {
      this.advance()
      if (!isBinDigit(this.peek())) this.error('invalid binary literal')
      this.consumeDigits(isBinDigit)
      if (isDigit(this.peek())) this.error('invalid binary literal')
      this.tryIntSuffix()
      this.add('number')
      return
    }
    this.consumeDigits(isDigit)
    if (this.peek() === '.' && isDigit(this.peekNext())) {
      this.advance()
      this.consumeDigits(isDigit)
      this.tryFloatSuffix()
      this.add('number')
      return
    }
    this.tryIntSuffix()
    this.add('number')
  }

  private tryIntSuffix(): void {
    let index = this.current
    const start = this.source[index] ?? ''
    if (!isIdentStart(start)) return
    index += 1
    while (isIdentPart(this.source[index] ?? '')) index += 1
    const suffix = this.source.slice(this.current, index)
    if (!isIntKind(suffix)) return
    while (this.current < index) this.advance()
  }

  private tryFloatSuffix(): void {
    let index = this.current
    const start = this.source[index] ?? ''
    if (!isIdentStart(start)) return
    index += 1
    while (isIdentPart(this.source[index] ?? '')) index += 1
    const suffix = this.source.slice(this.current, index)
    if (!isFloatKind(suffix)) return
    while (this.current < index) this.advance()
  }

  private consumeDigits(isDigitChar: (char: string) => boolean): void {
    while (true) {
      if (isDigitChar(this.peek())) {
        this.advance()
        continue
      }
      if (this.peek() === '_' && isDigitChar(this.peekNext())) {
        this.advance()
        continue
      }
      break
    }
  }

  private ident(): void {
    while (isIdentPart(this.peek())) this.advance()
    const lexeme = this.source.slice(this.start, this.current)
    this.add(Object.hasOwn(KEYWORDS, lexeme) ? KEYWORDS[lexeme]! : 'ident')
  }

  private add(kind: TokenKind): void {
    this.tokens.push({
      kind,
      lexeme: this.source.slice(this.start, this.current),
      loc: locOf(this.file, this.line, this.tokenColumn),
    })
  }

  private match(expected: string): boolean {
    if (this.isAtEnd() || this.source[this.current] !== expected) return false
    this.advance()
    return true
  }

  private advance(): string {
    const char = this.source[this.current] ?? ''
    this.current += 1
    if (char !== '\n') this.column += 1
    return char
  }

  private peek(): string {
    return this.source[this.current] ?? '\0'
  }

  private peekNext(): string {
    return this.source[this.current + 1] ?? '\0'
  }

  private charAt(offset: number): string {
    return this.source[this.current + offset] ?? '\0'
  }

  private isAtEnd(): boolean {
    return this.current >= this.source.length
  }

  private error(message: string): never {
    throw new ZeeError(message, this.line, this.tokenColumn, this.file)
  }
}

function isDigit(char: string): boolean {
  return char >= '0' && char <= '9'
}

function isBinDigit(char: string): boolean {
  return char === '0' || char === '1'
}

function isHexDigit(char: string): boolean {
  return isDigit(char) || (char >= 'a' && char <= 'f') || (char >= 'A' && char <= 'F')
}

function isIdentStart(char: string): boolean {
  return (char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z') || char === '_'
}

function isIdentPart(char: string): boolean {
  return isIdentStart(char) || isDigit(char)
}

function unescape(char: string): string | undefined {
  switch (char) {
    case 'n':
      return '\n'
    case 't':
      return '\t'
    case '\\':
      return '\\'
    case '"':
      return '"'
    default:
      return undefined
  }
}

function unescapeInterp(char: string): string | undefined {
  switch (char) {
    case 'n':
      return '\n'
    case 't':
      return '\t'
    case '\\':
      return '\\'
    case '`':
      return '`'
    case '{':
      return '{'
    default:
      return undefined
  }
}

function unescapeChar(char: string): string | undefined {
  switch (char) {
    case 'n':
      return '\n'
    case 't':
      return '\t'
    case '\\':
      return '\\'
    case "'":
      return "'"
    default:
      return undefined
  }
}

function stripRawIndent(line: string, indent: number): string {
  let i = 0
  while (i < indent && i < line.length && (line[i] === ' ' || line[i] === '\t')) i += 1
  return line.slice(i)
}
