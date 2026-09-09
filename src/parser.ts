import type { BinaryOp, Block, Expr, Param, Program, Stmt, TypeAst } from './ast.ts'
import { ZeeError, type Loc } from './error.ts'
import { tokenize, type Token, type TokenKind } from './lexer.ts'

export function parse(source: string, file = '<input>'): Program {
  return new Parser(tokenize(source, file), file).parseProgram()
}

class Parser {
  private current = 0

  constructor(
    private readonly tokens: Token[],
    private readonly file: string,
  ) {}

  parseProgram(): Program {
    const stmts: Stmt[] = []
    while (!this.isAtEnd()) {
      stmts.push(this.parseStatement())
    }
    return { file: this.file, stmts }
  }

  private parseStatement(): Stmt {
    if (this.match('let')) return this.parseLet()
    if (this.match('fn')) return this.parseFn()
    if (this.match('return')) return this.parseReturn()
    const expr = this.parseExpression()
    this.match(';')
    return { kind: 'expr', expr, loc: expr.loc }
  }

  private parseLet(): Stmt {
    const loc = this.previous().loc
    const nameTok = this.consume('ident', 'expected name after `let`')
    let typeAnn: TypeAst | undefined
    if (this.match(':')) typeAnn = this.parseType()
    this.consume('=', 'expected `=` after let binding')
    const init = this.parseExpression()
    this.match(';')
    return { kind: 'let', name: nameTok.lexeme, typeAnn, init, loc }
  }

  private parseFn(): Stmt {
    const loc = this.previous().loc
    const nameTok = this.consume('ident', 'expected function name')
    this.consume('(', 'expected `(` after function name')
    const params: Param[] = []
    if (!this.check(')')) {
      do {
        const paramName = this.consume('ident', 'expected parameter name')
        this.consume(':', 'expected `:` after parameter name')
        const type = this.parseType()
        params.push({ name: paramName.lexeme, type, loc: paramName.loc })
      } while (this.match(','))
    }
    this.consume(')', 'expected `)` after parameters')
    let returnType: TypeAst | undefined
    if (this.match('->')) returnType = this.parseType()
    const body = this.parseBlock()
    return { kind: 'fn', name: nameTok.lexeme, params, returnType, body, loc }
  }

  private parseReturn(): Stmt {
    const loc = this.previous().loc
    let expr: Expr | undefined
    if (!this.check(';') && !this.check('}') && !this.isAtEnd()) {
      expr = this.parseExpression()
    }
    this.match(';')
    return { kind: 'return', expr, loc }
  }

  private parseType(): TypeAst {
    const tok = this.consume('ident', 'expected type name')
    return { name: tok.lexeme, loc: tok.loc }
  }

  private parseBlock(): Block {
    const lbrace = this.consume('{', 'expected `{`')
    const stmts: Stmt[] = []
    while (!this.check('}') && !this.isAtEnd()) {
      stmts.push(this.parseStatement())
    }
    this.consume('}', 'expected `}`')
    return { stmts, loc: lbrace.loc }
  }

  private parseExpression(): Expr {
    return this.parseOr()
  }

  private parseOr(): Expr {
    let expr = this.parseAnd()
    while (this.match('||')) {
      const op = this.previous().kind as BinaryOp
      const right = this.parseAnd()
      expr = { kind: 'binary', op, left: expr, right, loc: expr.loc }
    }
    return expr
  }

  private parseAnd(): Expr {
    let expr = this.parseEquality()
    while (this.match('&&')) {
      const op = this.previous().kind as BinaryOp
      const right = this.parseEquality()
      expr = { kind: 'binary', op, left: expr, right, loc: expr.loc }
    }
    return expr
  }

  private parseEquality(): Expr {
    let expr = this.parseComparison()
    while (this.match('==', '!=')) {
      const op = this.previous().kind as BinaryOp
      const right = this.parseComparison()
      expr = { kind: 'binary', op, left: expr, right, loc: expr.loc }
    }
    return expr
  }

  private parseComparison(): Expr {
    let expr = this.parseTerm()
    while (this.match('<', '<=', '>', '>=')) {
      const op = this.previous().kind as BinaryOp
      const right = this.parseTerm()
      expr = { kind: 'binary', op, left: expr, right, loc: expr.loc }
    }
    return expr
  }

  private parseTerm(): Expr {
    let expr = this.parseFactor()
    while (this.match('+', '-')) {
      const op = this.previous().kind as BinaryOp
      const right = this.parseFactor()
      expr = { kind: 'binary', op, left: expr, right, loc: expr.loc }
    }
    return expr
  }

  private parseFactor(): Expr {
    let expr = this.parseUnary()
    while (this.match('*', '/')) {
      const op = this.previous().kind as BinaryOp
      const right = this.parseUnary()
      expr = { kind: 'binary', op, left: expr, right, loc: expr.loc }
    }
    return expr
  }

  private parseUnary(): Expr {
    if (this.match('!', '-')) {
      const opTok = this.previous()
      const expr = this.parseUnary()
      return { kind: 'unary', op: opTok.kind as '-' | '!', expr, loc: opTok.loc }
    }
    return this.parseCall()
  }

  private parseCall(): Expr {
    let expr = this.parsePrimary()
    while (this.match('(')) {
      const args: Expr[] = []
      if (!this.check(')')) {
        do {
          args.push(this.parseExpression())
        } while (this.match(','))
      }
      this.consume(')', 'expected `)` after arguments')
      expr = { kind: 'call', callee: expr, args, loc: expr.loc }
    }
    return expr
  }

  private parsePrimary(): Expr {
    if (this.match('true')) return { kind: 'bool', value: true, loc: this.previous().loc }
    if (this.match('false')) return { kind: 'bool', value: false, loc: this.previous().loc }
    if (this.match('number')) {
      const tok = this.previous()
      const value = Number(tok.lexeme)
      if (!Number.isSafeInteger(value) || value > 2147483647) {
        throw new ZeeError(`integer literal out of i32 range`, tok.loc.line, tok.loc.column, this.file)
      }
      return { kind: 'int', value, loc: tok.loc }
    }
    if (this.match('string')) {
      const tok = this.previous()
      return { kind: 'string', value: tok.lexeme, loc: tok.loc }
    }
    if (this.match('ident')) {
      const tok = this.previous()
      return { kind: 'ident', name: tok.lexeme, loc: tok.loc }
    }
    if (this.match('if')) return this.parseIf(this.previous().loc)
    if (this.check('{')) {
      const block = this.parseBlock()
      return { kind: 'block', block, loc: block.loc }
    }
    if (this.match('(')) {
      const expr = this.parseExpression()
      this.consume(')', 'expected `)` after expression')
      return expr
    }
    const tok = this.peek()
    throw new ZeeError(`expected expression, found \`${tok.lexeme || tok.kind}\``, tok.loc.line, tok.loc.column, this.file)
  }

  private parseIf(loc: Loc): Expr {
    const cond = this.parseExpression()
    const then = this.parseBlock()
    let elseBlock: Block | undefined
    if (this.match('else')) {
      if (this.check('if')) {
        const inner = this.parseExpression()
        elseBlock = { stmts: [{ kind: 'expr', expr: inner, loc: inner.loc }], loc: inner.loc }
      } else {
        elseBlock = this.parseBlock()
      }
    }
    return { kind: 'if', cond, then, else: elseBlock, loc }
  }

  private match(...kinds: TokenKind[]): boolean {
    for (const kind of kinds) {
      if (this.check(kind)) {
        this.advance()
        return true
      }
    }
    return false
  }

  private consume(kind: TokenKind, message: string): Token {
    if (this.check(kind)) return this.advance()
    const tok = this.peek()
    throw new ZeeError(message, tok.loc.line, tok.loc.column, this.file)
  }

  private check(kind: TokenKind): boolean {
    if (this.isAtEnd()) return kind === 'eof'
    return this.peek().kind === kind
  }

  private advance(): Token {
    if (!this.isAtEnd()) this.current += 1
    return this.previous()
  }

  private isAtEnd(): boolean {
    return this.peek().kind === 'eof'
  }

  private peek(): Token {
    return this.tokens[this.current]!
  }

  private previous(): Token {
    return this.tokens[this.current - 1]!
  }
}
