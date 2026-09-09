import { locOf, ZeeError, type Loc } from './error.ts'

export type TokenKind =
  | 'eof'
  | 'number'
  | 'string'
  | 'ident'
  | 'fn'
  | 'let'
  | 'if'
  | 'else'
  | 'return'
  | 'true'
  | 'false'
  | '+'
  | '-'
  | '*'
  | '/'
  | '='
  | '=='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | '!'
  | '&&'
  | '||'
  | '('
  | ')'
  | '{'
  | '}'
  | ','
  | ':'
  | '->'
  | ';'

export interface Token {
  kind: TokenKind
  lexeme: string
  loc: Loc
}

const KEYWORDS: Record<string, TokenKind> = {
  fn: 'fn',
  let: 'let',
  if: 'if',
  else: 'else',
  return: 'return',
  true: 'true',
  false: 'false',
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
      case ',':
      case ':':
      case ';':
      case '+':
      case '*':
        this.add(char)
        break
      case '-':
        this.add(this.match('>') ? '->' : '-')
        break
      case '!':
        this.add(this.match('=') ? '!=' : '!')
        break
      case '=':
        this.add(this.match('=') ? '==' : '=')
        break
      case '<':
        this.add(this.match('=') ? '<=' : '<')
        break
      case '>':
        this.add(this.match('=') ? '>=' : '>')
        break
      case '&':
        if (this.match('&')) this.add('&&')
        else this.error('unexpected character `&`')
        break
      case '|':
        if (this.match('|')) this.add('||')
        else this.error('unexpected character `|`')
        break
      case '/':
        if (this.match('/')) {
          while (this.peek() !== '\n' && !this.isAtEnd()) this.advance()
        } else if (this.match('*')) {
          this.blockComment()
        } else {
          this.add('/')
        }
        break
      case '"':
        this.string()
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

  private number(): void {
    while (isDigit(this.peek())) this.advance()
    const lexeme = this.source.slice(this.start, this.current)
    if (!/^-?\d+$/.test(lexeme)) this.error(`invalid number ${lexeme}`)
    this.add('number')
  }

  private ident(): void {
    while (isIdentPart(this.peek())) this.advance()
    const lexeme = this.source.slice(this.start, this.current)
    this.add(KEYWORDS[lexeme] ?? 'ident')
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
