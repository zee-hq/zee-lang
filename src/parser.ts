import type {
  AssociatedConst,
  AssignOp,
  BinaryOp,
  Block,
  Expr,
  ImportName,
  InterfaceMethod,
  LoopMode,
  MatchArm,
  MatchPattern,
  Param,
  Program,
  Stmt,
  StructField,
  StructVariant,
  TypeAst,
  Visibility,
} from './ast.ts'
import { ZeeError, type Loc } from './error.ts'
import { tokenize, type Token, type TokenKind } from './lexer.ts'
import { parseIntLexeme, splitIntLiteral } from './types.ts'

const ASSIGN_OPS: TokenKind[] = ['=', '??=', '!!=', '&&=', '||=', '+=', '-=', '*=', '/=', '%=']
const LVALUE_ASSIGN_OPS: TokenKind[] = ['=', '+=', '-=', '*=', '/=', '%=']

export function parse(source: string, file = '<input>'): Program {
  return new Parser(tokenize(source, file), file).parseProgram()
}

class Parser {
  private current = 0
  private trailingBrace = true
  private typeSelf: string | undefined

  constructor(
    private readonly tokens: Token[],
    private readonly file: string,
  ) {}

  private withTypeSelf<T>(name: string, run: () => T): T {
    const previous = this.typeSelf
    this.typeSelf = name
    try {
      return run()
    } finally {
      this.typeSelf = previous
    }
  }

  parseProgram(): Program {
    const stmts: Stmt[] = []
    while (!this.isAtEnd()) {
      stmts.push(this.parseTopLevel())
    }
    return { file: this.file, stmts, units: [{ file: this.file, module: '', stmts }] }
  }

  private parseTopLevel(): Stmt {
    if (this.match('import')) return this.parseImport()
    const visibility = this.parseVisibility()
    if (this.match('const')) return this.parseBind(false, true, visibility ?? 'private')
    if (this.match('var')) return this.parseBind(true, true, visibility ?? 'private')
    if (this.match('fn')) return this.parseFn(visibility ?? 'private')
    if (this.match('enum')) return this.parseEnumDecl(visibility ?? 'private')
    if (this.match('type')) return this.parseTypeAliasDecl(visibility ?? 'private')
    if (this.match('newtype')) return this.parseNewtypeDecl(visibility ?? 'private')
    if (this.looksLikeInterfaceDecl()) {
      return this.parseInterfaceDecl(visibility ?? 'private')
    }
    if (this.looksLikeTypeDecl()) {
      return this.parseStructDecl(visibility ?? 'private')
    }
    if (visibility) {
      this.fail('expected `fn`, `const`, `var`, `struct`, `class`, `enum`, `type`, `newtype`, or `interface` after visibility')
    }
    return this.parseStatement()
  }

  private parseVisibility(): Visibility | undefined {
    if (this.match('pub')) return 'pub'
    if (this.match('internal')) return 'internal'
    return undefined
  }

  private parseImport(): Stmt {
    const loc = this.previous().loc
    const path = [this.consume('ident', 'expected module path after `import`').lexeme]
    let names: ImportName[] | undefined
    while (this.check('.')) {
      if (this.peekAt(1).kind === '{') {
        this.advance()
        this.advance()
        names = []
        do {
          const nameTok = this.consume('ident', 'expected imported name')
          let alias: string | undefined
          if (this.match('as')) {
            alias = this.consume('ident', 'expected alias after `as`').lexeme
          }
          names.push({ name: nameTok.lexeme, alias })
        } while (this.match(','))
        this.consume('}', 'expected `}` after imported names')
        break
      }
      if (this.peekAt(1).kind !== 'ident') break
      this.advance()
      path.push(this.advance().lexeme)
    }
    let alias: string | undefined
    if (this.match('as')) {
      alias = this.consume('ident', 'expected alias after `as`').lexeme
    }
    this.match(';')
    return { kind: 'import', path, names, alias, loc }
  }

  private parseStatement(): Stmt {
    if (this.match('const')) return this.parseBind(false)
    if (this.match('var')) return this.parseBind(true)
    if (this.match('redim')) return this.parseRedim()
    if (this.looksLikeInterfaceDecl()) {
      return this.parseInterfaceDecl()
    }
    if (this.looksLikeTypeDecl()) {
      return this.parseStructDecl()
    }
    if (this.check('ident') && ASSIGN_OPS.includes(this.peekAt(1).kind)) return this.parseAssign()
    if (this.match('while')) return this.parsePretestLoop('while')
    if (this.match('until')) return this.parsePretestLoop('until')
    if (this.match('do')) return this.parseDoLoop()
    if (this.match('break')) return this.parseJump('break')
    if (this.match('continue')) return this.parseJump('continue')
    if (this.match('for')) return this.parseFor()
    if (this.match('fn')) return this.parseFn()
    if (this.match('type')) return this.parseTypeAliasDecl()
    if (this.match('newtype')) return this.parseNewtypeDecl()
    if (this.looksLikeInterfaceDecl()) {
      return this.parseInterfaceDecl()
    }
    if (this.match('return')) return this.parseReturn()
    if (this.match('defer')) return this.parseDefer()
    const expr = this.parseExpression()
    if (LVALUE_ASSIGN_OPS.includes(this.peek().kind)) return this.parseLvalueAssign(expr)
    this.match(';')
    return { kind: 'expr', expr, loc: expr.loc }
  }

  private parseBind(mutable: boolean, eatSemi = true, visibility: Visibility = 'private'): Stmt {
    const loc = this.previous().loc
    if (this.check('(')) return this.parseDestructure(mutable, loc)
    const nameTok = this.consume('ident', `expected name after \`${mutable ? 'var' : 'const'}\``)
    let typeAnn: TypeAst | undefined
    if (this.match(':')) typeAnn = this.parseType()
    this.consume('=', `expected \`=\` after ${mutable ? 'var' : 'const'} binding`)
    const init = this.parseExpression()
    if (eatSemi) this.match(';')
    return { kind: 'bind', mutable, visibility, name: nameTok.lexeme, typeAnn, init, loc }
  }

  private parseDestructure(mutable: boolean, loc: Loc): Stmt {
    this.consume('(', 'expected `(` in tuple binding')
    const names: string[] = []
    if (!this.check(')')) {
      do {
        const nameTok = this.consume('ident', 'expected binding name or `_`')
        names.push(nameTok.lexeme)
      } while (this.match(','))
    }
    this.consume(')', 'expected `)` after tuple binding')
    if (names.length < 2) {
      throw new ZeeError('tuple binding needs at least two names', loc.line, loc.column, this.file)
    }
    this.consume('=', `expected \`=\` after ${mutable ? 'var' : 'const'} tuple binding`)
    const init = this.parseExpression()
    this.match(';')
    return { kind: 'destructure', mutable, names, init, loc }
  }

  private parseAssign(eatSemi = true): Stmt {
    const nameTok = this.advance()
    const opTok = this.advance()
    const value = this.parseExpression()
    if (eatSemi) this.match(';')
    return { kind: 'assign', name: nameTok.lexeme, op: opTok.kind as AssignOp, value, loc: nameTok.loc }
  }

  private parseLvalueAssign(target: Expr): Stmt {
    const opTok = this.advance()
    const value = this.parseExpression()
    this.match(';')
    if (target.kind === 'index') {
      return {
        kind: 'indexAssign',
        target: target.target,
        index: target.index,
        op: opTok.kind as AssignOp,
        value,
        loc: target.loc,
      }
    }
    if (target.kind === 'member') {
      return {
        kind: 'fieldAssign',
        target: target.target,
        field: target.field,
        op: opTok.kind as AssignOp,
        value,
        loc: target.loc,
      }
    }
    throw new ZeeError('invalid assignment target', target.loc.line, target.loc.column, this.file)
  }

  private parseRedim(): Stmt {
    const loc = this.previous().loc
    const preserve = this.match('preserve')
    const nameTok = this.consume('ident', 'expected name after `redim`')
    if (preserve || this.check(',')) {
      this.consume(',', 'expected `,` after name in array `redim`')
      const length = this.parseExpression()
      this.match(';')
      return { kind: 'redimArray', name: nameTok.lexeme, preserve, length, loc }
    }
    this.consume(':', 'expected `:` after name in `redim`')
    const type = this.parseType()
    this.match(';')
    return { kind: 'redim', name: nameTok.lexeme, type, loc }
  }

  private parseStructDecl(visibility: Visibility = 'private'): Stmt {
    const loc = this.peek().loc
    let readonly = false
    let data = false
    let sealed = false
    while (true) {
      if (this.match('readonly')) {
        if (readonly) this.fail('duplicate `readonly`')
        readonly = true
        continue
      }
      if (this.match('data')) {
        if (data) this.fail('duplicate `data`')
        data = true
        continue
      }
      if (this.match('sealed')) {
        if (sealed) this.fail('duplicate `sealed`')
        sealed = true
        continue
      }
      break
    }
    const identity = this.match('class')
    if (!identity) this.consume('struct', 'expected `struct` or `class`')
    const form = identity ? 'class' : 'struct'
    const nameTok = this.consume('ident', `expected ${form} name`)
    const implementsBefore = this.parseImplementsClause()
    this.consume('{', `expected \`{\` after ${form} name`)
    if (sealed) {
      if (implementsBefore.length > 0) {
        throw new ZeeError(
          '`sealed` struct cannot `implements`',
          loc.line,
          loc.column,
          this.file,
        )
      }
      const variants: StructVariant[] = []
      const seen = new Set<string>()
      while (!this.check('}') && !this.isAtEnd()) {
        const variant = this.parseStructVariant(identity)
        if (seen.has(variant.name)) this.fail(`duplicate variant \`${variant.name}\``)
        seen.add(variant.name)
        variants.push(variant)
      }
      this.consume('}', 'expected `}` after sealed variants')
      if (variants.length === 0) {
        throw new ZeeError(`\`sealed\` ${form} needs at least one variant`, loc.line, loc.column, this.file)
      }
      return {
        kind: 'structDecl',
        visibility,
        name: nameTok.lexeme,
        readonly,
        data,
        sealed: true,
        identity,
        fields: [],
        associated: [],
        nested: [],
        variants,
        implements: [],
        methods: [],
        loc,
      }
    }
    const body = this.withTypeSelf(nameTok.lexeme, () => this.parseTypeBody(nameTok.lexeme))
    this.consume('}', `expected \`}\` after ${form} members`)
    const implementsAfter = this.parseImplementsClause()
    const implemented = uniqueImplements([...implementsBefore, ...implementsAfter])
    const afterMethods =
      this.check('{') && this.peekAt(1).kind === 'fn'
        ? this.withTypeSelf(nameTok.lexeme, () => this.parseTypeMethods(nameTok.lexeme))
        : []
    return {
      kind: 'structDecl',
      visibility,
      name: nameTok.lexeme,
      readonly,
      data,
      sealed: false,
      identity,
      fields: body.fields,
      associated: body.associated,
      nested: body.nested,
      variants: [],
      implements: implemented,
      methods: [...body.methods, ...afterMethods],
      loc,
    }
  }

  private parseStructVariant(outerIdentity: boolean): StructVariant {
    const loc = this.peek().loc
    const visibility = this.parseVisibility()
    let readonly = false
    let data = false
    while (true) {
      if (this.match('readonly')) {
        if (readonly) this.fail('duplicate `readonly`')
        readonly = true
        continue
      }
      if (this.match('data')) {
        if (data) this.fail('duplicate `data`')
        data = true
        continue
      }
      break
    }
    const identity = this.match('class')
    if (!identity) this.consume('struct', 'expected nested `struct` or `class` variant inside `sealed`')
    if (identity !== outerIdentity) {
      this.fail(
        outerIdentity
          ? '`sealed class` variants must be `class`, not `struct`'
          : '`sealed struct` variants must be `struct`, not `class`',
      )
    }
    const nameTok = this.consume('ident', 'expected variant name')
    this.consume('{', 'expected `{` after variant name')
    const fields = this.parseStructFields()
    this.consume('}', 'expected `}` after variant fields')
    return { name: nameTok.lexeme, visibility, data, readonly, identity, fields, loc }
  }

  private parseStructFields(): StructField[] {
    const fields: StructField[] = []
    while (!this.check('}') && !this.isAtEnd()) {
      if (this.looksLikeTypeDecl()) {
        this.fail('nested types are only allowed inside `sealed` types')
      }
      const fieldVis = this.parseVisibility() ?? 'private'
      const mutable = this.match('var')
      if (!mutable) this.consume('const', 'expected `const` or `var` field')
      const fieldName = this.consume('ident', 'expected field name')
      this.consume(':', 'expected `:` after field name')
      const type = this.parseType()
      if (this.check('=')) {
        this.fail('associated `const` / `var` is not allowed on a sealed variant')
      }
      this.match(';')
      fields.push({
        name: fieldName.lexeme,
        mutable,
        visibility: fieldVis,
        type,
        loc: fieldName.loc,
      })
    }
    return fields
  }

  private parseTypeBody(receiverName: string): {
    fields: StructField[]
    associated: AssociatedConst[]
    nested: Stmt[]
    methods: Extract<Stmt, { kind: 'fn' }>[]
  } {
    const fields: StructField[] = []
    const associated: AssociatedConst[] = []
    const nested: Stmt[] = []
    const methods: Extract<Stmt, { kind: 'fn' }>[] = []
    const seen = new Set<string>()
    const claim = (name: string): void => {
      if (seen.has(name)) this.fail(`duplicate member \`${name}\``)
      seen.add(name)
    }
    while (!this.check('}') && !this.isAtEnd()) {
      const memberVis = this.parseVisibility() ?? 'private'
      if (this.match('fn')) {
        const fn = this.parseFn(memberVis, receiverName)
        claim(fn.name)
        methods.push(fn)
        continue
      }
      if (this.match('enum')) {
        const decl = this.parseEnumDecl(memberVis)
        if (decl.kind !== 'enumDecl') this.fail('expected nested `enum`')
        claim(decl.name)
        nested.push(decl)
        continue
      }
      if (this.match('type')) {
        const decl = this.parseTypeAliasDecl(memberVis)
        if (decl.kind !== 'typeAliasDecl') this.fail('expected nested `type`')
        claim(decl.name)
        nested.push(decl)
        continue
      }
      if (this.match('newtype')) {
        const decl = this.parseNewtypeDecl(memberVis)
        if (decl.kind !== 'newtypeDecl') this.fail('expected nested `newtype`')
        claim(decl.name)
        nested.push(decl)
        continue
      }
      if (this.looksLikeInterfaceDecl()) {
        const decl = this.parseInterfaceDecl(memberVis)
        if (decl.kind !== 'interfaceDecl') this.fail('expected nested `interface`')
        claim(decl.name)
        nested.push(decl)
        continue
      }
      if (this.looksLikeTypeDecl()) {
        const decl = this.parseStructDecl(memberVis)
        if (decl.kind !== 'structDecl') this.fail('expected nested type')
        claim(decl.name)
        nested.push(decl)
        continue
      }
      const mutable = this.match('var')
      if (!mutable) this.consume('const', 'expected `const`, `var`, `fn`, or nested type')
      const nameTok = this.consume('ident', 'expected member name')
      let typeAnn: TypeAst | undefined
      if (this.match(':')) typeAnn = this.parseType()
      if (this.match('=')) {
        const init = this.parseExpression()
        this.match(';')
        claim(nameTok.lexeme)
        associated.push({
          name: nameTok.lexeme,
          mutable,
          visibility: memberVis,
          typeAnn,
          init,
          loc: nameTok.loc,
        })
        continue
      }
      if (!typeAnn) this.fail('expected `:` after field name')
      this.match(';')
      claim(nameTok.lexeme)
      fields.push({
        name: nameTok.lexeme,
        mutable,
        visibility: memberVis,
        type: typeAnn,
        loc: nameTok.loc,
      })
    }
    return { fields, associated, nested, methods }
  }

  private parseEnumDecl(visibility: Visibility): Stmt {
    const loc = this.previous().loc
    const nameTok = this.consume('ident', 'expected enum name')
    this.consume('{', 'expected `{` after enum name')
    const variants: { name: string; loc: Loc }[] = []
    const seen = new Set<string>()
    while (!this.check('}') && !this.isAtEnd()) {
      const name = this.consume('ident', 'expected variant name')
      if (seen.has(name.lexeme)) this.fail(`duplicate variant \`${name.lexeme}\``)
      seen.add(name.lexeme)
      variants.push({ name: name.lexeme, loc: name.loc })
      this.match(';')
      this.match(',')
    }
    this.consume('}', 'expected `}` after enum variants')
    if (variants.length === 0) {
      throw new ZeeError('`enum` needs at least one variant', loc.line, loc.column, this.file)
    }
    return { kind: 'enumDecl', visibility, name: nameTok.lexeme, variants, loc }
  }

  private parseTypeAliasDecl(visibility: Visibility = 'private'): Stmt {
    const loc = this.previous().loc
    const nameTok = this.consume('ident', 'expected type alias name')
    const typeParams = this.parseTypeParams()
    this.consume('=', 'expected `=` after type alias name')
    const aliased = this.parseType()
    this.match(';')
    return {
      kind: 'typeAliasDecl',
      visibility,
      name: nameTok.lexeme,
      typeParams,
      aliased,
      loc,
    }
  }

  private parseNewtypeDecl(visibility: Visibility = 'private'): Stmt {
    const loc = this.previous().loc
    const nameTok = this.consume('ident', 'expected newtype name')
    if (this.check('<')) this.fail('`newtype` cannot take type parameters')
    this.consume('=', 'expected `=` after newtype name')
    const inner = this.parseType()
    this.match(';')
    return { kind: 'newtypeDecl', visibility, name: nameTok.lexeme, inner, loc }
  }

  private looksLikeInterfaceDecl(): boolean {
    return this.check('interface') || (this.check('sealed') && this.peekAt(1).kind === 'interface')
  }

  private parseInterfaceDecl(visibility: Visibility = 'private'): Stmt {
    const loc = this.peek().loc
    const sealed = this.match('sealed')
    this.consume('interface', 'expected `interface`')
    const nameTok = this.consume('ident', 'expected interface name')
    this.consume('{', 'expected `{` after interface name')
    const methods: InterfaceMethod[] = []
    const seen = new Set<string>()
    while (!this.check('}') && !this.isAtEnd()) {
      if (this.check('const') || this.check('var') || this.check('pub') || this.check('internal')) {
        throw new ZeeError('interface methods only; no fields', loc.line, loc.column, this.file)
      }
      this.consume('fn', 'expected `fn` in interface body')
      const method = this.parseInterfaceMethod()
      if (seen.has(method.name)) this.fail(`duplicate method \`${method.name}\``)
      seen.add(method.name)
      methods.push(method)
    }
    this.consume('}', 'expected `}` after interface methods')
    return { kind: 'interfaceDecl', visibility, name: nameTok.lexeme, sealed, methods, loc }
  }

  private parseInterfaceMethod(): InterfaceMethod {
    const loc = this.previous().loc
    const nameTok = this.consume('ident', 'expected method name')
    this.consume('(', 'expected `(` after method name')
    const mutating = this.match('var')
    const selfTok = this.consume('ident', 'interface method needs `self`')
    if (selfTok.lexeme !== 'self') {
      throw new ZeeError('interface method needs `self`', selfTok.loc.line, selfTok.loc.column, this.file)
    }
    if (this.match(':')) {
      throw new ZeeError(
        'interface `self` has no type; the implementor is the type',
        selfTok.loc.line,
        selfTok.loc.column,
        this.file,
      )
    }
    const params: Param[] = []
    while (this.match(',')) {
      const paramName = this.consume('ident', 'expected parameter name')
      this.consume(':', 'expected `:` after parameter name')
      const type = this.parseType()
      params.push({ name: paramName.lexeme, type, loc: paramName.loc, mutable: false })
    }
    this.consume(')', 'expected `)` after parameters')
    let returnType: TypeAst | undefined
    if (this.match('->')) returnType = this.parseType()
    if (this.check('{')) {
      throw new ZeeError('interface methods cannot have a default body', loc.line, loc.column, this.file)
    }
    this.match(';')
    return { name: nameTok.lexeme, mutating, params, returnType, loc }
  }

  private parseImplementsClause(): string[] {
    if (!this.match('implements')) return []
    const names = [this.consume('ident', 'expected interface name after `implements`').lexeme]
    while (this.match(',')) {
      names.push(this.consume('ident', 'expected interface name').lexeme)
    }
    return names
  }

  private parseTypeMethods(receiverName: string): Extract<Stmt, { kind: 'fn' }>[] {
    this.consume('{', 'expected `{` after `implements`')
    const methods: Extract<Stmt, { kind: 'fn' }>[] = []
    while (!this.check('}') && !this.isAtEnd()) {
      this.consume('fn', 'expected `fn` in implements block')
      const fn = this.parseFn('private', receiverName)
      if (fn.kind !== 'fn') this.fail('expected a method')
      methods.push(fn)
    }
    this.consume('}', 'expected `}` after implements methods')
    return methods
  }

  private parseTypeParams(): string[] {
    if (!this.match('<')) return []
    const params: string[] = []
    const seen = new Set<string>()
    do {
      const tok = this.consume('ident', 'expected type parameter')
      if (seen.has(tok.lexeme)) this.fail(`duplicate type parameter \`${tok.lexeme}\``)
      seen.add(tok.lexeme)
      params.push(tok.lexeme)
    } while (this.match(','))
    this.consume('>', 'expected `>` after type parameters')
    if (params.length === 0) this.fail('expected a type parameter')
    return params
  }

  private parseFn(visibility: Visibility = 'private', receiverName?: string): Extract<Stmt, { kind: 'fn' }> {
    const loc = this.previous().loc
    const nameTok = this.consume('ident', 'expected function name')
    const typeParams = this.parseTypeParams()
    this.consume('(', 'expected `(` after function name')
    const params: Param[] = []
    if (!this.check(')')) {
      do {
        const mutable = this.match('var')
        const paramName = this.consume('ident', 'expected parameter name')
        if (mutable && paramName.lexeme === 'self' && params.length !== 0) {
          throw new ZeeError(
            'only the first parameter can be `var self`',
            paramName.loc.line,
            paramName.loc.column,
            this.file,
          )
        }
        if (paramName.lexeme === 'self' && params.length !== 0) {
          throw new ZeeError(
            '`self` must be the first parameter',
            paramName.loc.line,
            paramName.loc.column,
            this.file,
          )
        }
        let type: TypeAst
        if (this.match(':')) {
          type = this.parseType()
        } else if (receiverName && paramName.lexeme === 'self' && params.length === 0) {
          type = { kind: 'named', name: receiverName, loc: paramName.loc }
        } else {
          throw new ZeeError('expected `:` after parameter name', paramName.loc.line, paramName.loc.column, this.file)
        }
        params.push({ name: paramName.lexeme, type, loc: paramName.loc, mutable })
      } while (this.match(','))
    }
    this.consume(')', 'expected `)` after parameters')
    let returnType: TypeAst | undefined
    if (this.match('->')) returnType = this.parseType()
    const body = this.parseBlock()
    return { kind: 'fn', visibility, name: nameTok.lexeme, typeParams, params, returnType, body, loc }
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

  private parseDefer(): Stmt {
    const loc = this.previous().loc
    const body = this.parseExpression()
    this.match(';')
    return { kind: 'defer', body, loc }
  }

  private parsePretestLoop(mode: 'while' | 'until'): Stmt {
    const loc = this.previous().loc
    const cond = this.parseBeforeBlock()
    const body = this.parseBlock()
    return { kind: 'loop', mode, cond, body, loc }
  }

  private parseDoLoop(): Stmt {
    const loc = this.previous().loc
    const body = this.parseBlock()
    const mode: LoopMode = this.match('while')
      ? 'do-while'
      : this.match('until')
        ? 'do-until'
        : this.fail('expected `while` or `until` after `do` block')
    const cond = this.parseExpression()
    this.match(';')
    return { kind: 'loop', mode, cond, body, loc }
  }

  private parseJump(kind: 'break' | 'continue'): Stmt {
    const loc = this.previous().loc
    this.match(';')
    return { kind, loc }
  }

  private parseFor(): Stmt {
    const loc = this.previous().loc
    if (this.check('{')) {
      return { kind: 'forForever', body: this.parseBlock(), loc }
    }
    if (this.match('(')) {
      if (
        this.check('ident') &&
        this.peekAt(1).kind === ',' &&
        this.peekAt(2).kind === 'ident' &&
        this.peekAt(3).kind === ')' &&
        this.peekAt(4).kind === 'in'
      ) {
        const indexName = this.advance().lexeme
        this.advance()
        const name = this.advance().lexeme
        this.advance()
        this.advance()
        const seq = this.parseBeforeBlock()
        return { kind: 'forIn', name, indexName, seq, body: this.parseBlock(), loc }
      }
      const init = this.parseForInit()
      this.consume(';', 'expected `;` after for init')
      const cond = this.check(';') ? undefined : this.parseExpression()
      this.consume(';', 'expected `;` after for condition')
      const step = this.check(')') ? undefined : this.parseForStep()
      this.consume(')', 'expected `)` after for header')
      return { kind: 'forC', init, cond, step, body: this.parseBlock(), loc }
    }
    if (this.check('ident') && this.peekAt(1).kind === 'in') {
      const name = this.advance().lexeme
      this.advance()
      const seq = this.parseBeforeBlock()
      if (this.match('..')) {
        const end = this.parseBeforeBlock()
        return { kind: 'forRange', name, start: seq, end, body: this.parseBlock(), loc }
      }
      return { kind: 'forIn', name, seq, body: this.parseBlock(), loc }
    }
    this.fail('expected `{`, `(`, or `name in …` after `for`')
  }

  private parseForInit(): Stmt | undefined {
    if (this.check(';')) return undefined
    if (this.match('var')) return this.parseBind(true, false)
    if (this.check('ident') && ASSIGN_OPS.includes(this.peekAt(1).kind)) {
      return this.parseAssign(false)
    }
    this.fail('expected `var` binding, assignment, or `;` in for init')
  }

  private parseForStep(): Stmt {
    if (this.check('ident') && ASSIGN_OPS.includes(this.peekAt(1).kind)) {
      return this.parseAssign(false)
    }
    const expr = this.parseExpression()
    return { kind: 'expr', expr, loc: expr.loc }
  }

  private fail(message: string): never {
    const tok = this.peek()
    throw new ZeeError(message, tok.loc.line, tok.loc.column, this.file)
  }

  private parseType(): TypeAst {
    return this.parseArraySuffix(this.parseTypeHead())
  }

  private parseArraySuffix(type: TypeAst): TypeAst {
    while (this.match('[')) {
      this.consume(']', 'expected `]` after `[` in array type')
      type = { kind: 'array', elem: type, loc: type.loc }
    }
    return type
  }

  private parseTypeHead(): TypeAst {
    if (this.match('(')) {
      const loc = this.previous().loc
      if (this.match(')')) {
        if (this.match('->')) {
          const ret = this.parseType()
          return { kind: 'fn', params: [], ret, loc }
        }
        return { kind: 'unit', loc }
      }
      const first = this.parseType()
      if (this.match(')')) {
        if (this.match('->')) {
          const ret = this.parseType()
          return { kind: 'fn', params: [first], ret, loc }
        }
        return first
      }
      this.consume(',', 'expected `,` in tuple type')
      const parts = [first]
      do {
        parts.push(this.parseType())
      } while (this.match(','))
      this.consume(')', 'expected `)` after tuple type')
      if (this.match('->')) {
        const ret = this.parseType()
        return { kind: 'fn', params: parts, ret, loc }
      }
      return { kind: 'tuple', parts, loc }
    }
    const tok = this.consume('ident', 'expected type name')
    if (tok.lexeme === 'self') {
      if (this.check('<')) {
        throw new ZeeError('`self` cannot take type arguments', tok.loc.line, tok.loc.column, this.file)
      }
      if (!this.typeSelf) {
        throw new ZeeError('`self` type is only valid inside a type body', tok.loc.line, tok.loc.column, this.file)
      }
      return { kind: 'named', name: this.typeSelf, loc: tok.loc }
    }
    if (this.match('<')) {
      const args: TypeAst[] = []
      if (!this.check('>')) {
        do {
          args.push(this.parseType())
        } while (this.match(','))
      }
      this.consume('>', 'expected `>` after type arguments')
      return { kind: 'generic', name: tok.lexeme, args, loc: tok.loc }
    }
    return { kind: 'named', name: tok.lexeme, loc: tok.loc }
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

  private parseBeforeBlock(): Expr {
    const previous = this.trailingBrace
    this.trailingBrace = false
    try {
      return this.parseExpression()
    } finally {
      this.trailingBrace = previous
    }
  }

  private parseExpression(): Expr {
    return this.parseElvis()
  }

  private parseElvis(): Expr {
    const expr = this.parseOr()
    if (!this.match('?:')) return expr
    const right = this.parseElvisRhs()
    return { kind: 'binary', op: '?:', left: expr, right, loc: expr.loc }
  }

  private parseElvisRhs(): Expr {
    if (this.match('return')) {
      const loc = this.previous().loc
      let inner: Expr | undefined
      if (!this.check(';') && !this.check('}') && !this.isAtEnd() && !this.check('?:')) {
        inner = this.parseExpression()
      }
      return { kind: 'returnExpr', expr: inner, loc }
    }
    return this.parseElvis()
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
    let expr = this.parseIs()
    while (this.match('==', '===', '!=', '!==')) {
      const op = this.previous().kind as BinaryOp
      const right = this.parseIs()
      expr = { kind: 'binary', op, left: expr, right, loc: expr.loc }
    }
    return expr
  }

  private parseIs(): Expr {
    const expr = this.parseComparison()
    if (!this.match('is')) return expr
    const type = this.parseType()
    return { kind: 'isType', expr, type, loc: expr.loc }
  }

  private parseComparison(): Expr {
    let expr = this.parseTerm()
    while (this.match('<', '<=', '>', '>=', '<===>')) {
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
    while (this.match('*', '/', '%')) {
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
      if (opTok.kind === '-' && expr.kind === 'int') {
        return { kind: 'int', value: -expr.value, suffix: expr.suffix, loc: opTok.loc }
      }
      return { kind: 'unary', op: opTok.kind as '-' | '!', expr, loc: opTok.loc }
    }
    return this.parseCall()
  }

  private parseCall(): Expr {
    let expr = this.parsePrimary()
    while (true) {
      if (expr.kind === 'ident' && this.looksLikeTypeArgs()) {
        this.advance()
        const typeArgs: TypeAst[] = []
        if (!this.check('>')) {
          do {
            typeArgs.push(this.parseType())
          } while (this.match(','))
        }
        this.consume('>', 'expected `>` after type arguments')
        this.consume('(', 'expected `(` after type arguments')
        const args: Expr[] = []
        if (!this.check(')')) {
          do {
            args.push(this.parseExpression())
          } while (this.match(','))
        }
        this.consume(')', 'expected `)` after arguments')
        expr = { kind: 'call', callee: expr, args, typeArgs, loc: expr.loc }
      } else if (expr.kind === 'member' && expr.field === 'copy' && this.looksLikeCopyCall()) {
        this.advance()
        const fields: { name: string; value: Expr }[] = []
        const seen = new Set<string>()
        if (!this.check(')')) {
          do {
            const nameTok = this.consume('ident', 'expected field name in `copy`')
            this.consume(':', 'expected `:` after field name in `copy`')
            if (seen.has(nameTok.lexeme)) this.fail(`duplicate field \`${nameTok.lexeme}\` in \`copy\``)
            seen.add(nameTok.lexeme)
            fields.push({ name: nameTok.lexeme, value: this.parseExpression() })
          } while (this.match(','))
        }
        this.consume(')', 'expected `)` after `copy` fields')
        expr = { kind: 'copy', target: expr.target, fields, loc: expr.loc }
      } else if ((expr.kind === 'ident' || expr.kind === 'member') && this.match('(')) {
        const args: Expr[] = []
        if (!this.check(')')) {
          do {
            args.push(this.parseExpression())
          } while (this.match(','))
        }
        this.consume(')', 'expected `)` after arguments')
        expr = { kind: 'call', callee: expr, args, loc: expr.loc }
      } else if (
        this.trailingBrace &&
        expr.kind === 'member' &&
        this.check('{') &&
        !this.looksLikeStructFields()
      ) {
        expr = { kind: 'call', callee: expr, args: [this.parsePrimary()], loc: expr.loc }
      } else if (this.match('.')) {
        if (this.check('number')) {
          const indexTok = this.advance()
          expr = {
            kind: 'tupleIndex',
            target: expr,
            index: Number(indexTok.lexeme),
            loc: expr.loc,
          }
        } else {
          const fieldTok = this.consume('ident', 'expected field name or tuple index after `.`')
          expr = { kind: 'member', target: expr, field: fieldTok.lexeme, loc: expr.loc }
        }
      } else if (this.match('[')) {
        const index = this.parseExpression()
        this.consume(']', 'expected `]` after index')
        expr = { kind: 'index', target: expr, index, loc: expr.loc }
      } else if (
        (expr.kind === 'ident' || expr.kind === 'member') &&
        this.check('{') &&
        this.looksLikeStructLit()
      ) {
        expr = this.parseStructLit(expr)
      } else if (this.trailingBrace && expr.kind === 'call' && this.check('{')) {
        expr.args.push(this.parsePrimary())
      } else {
        break
      }
    }
    return expr
  }

  private parsePrimary(): Expr {
    if (this.match('true')) return { kind: 'bool', value: true, loc: this.previous().loc }
    if (this.match('false')) return { kind: 'bool', value: false, loc: this.previous().loc }
    if (this.match('number')) {
      const tok = this.previous()
      const { digits, suffix } = splitIntLiteral(tok.lexeme)
      const value = parseIntLexeme(digits)
      if (value === undefined) {
        throw new ZeeError(`invalid integer literal \`${tok.lexeme}\``, tok.loc.line, tok.loc.column, this.file)
      }
      return { kind: 'int', value, suffix, loc: tok.loc }
    }
    if (this.match('string')) {
      const tok = this.previous()
      return { kind: 'string', value: tok.lexeme, loc: tok.loc }
    }
    if (this.match('ident')) {
      const tok = this.previous()
      return { kind: 'ident', name: tok.lexeme, loc: tok.loc }
    }
    if (this.match('panic')) {
      const tok = this.previous()
      return { kind: 'ident', name: 'panic', loc: tok.loc }
    }
    if (this.match('if')) return this.parseIf(this.previous().loc)
    if (this.match('match')) return this.parseMatch(this.previous().loc)
    if (this.match('[')) return this.parseArrayLit(this.previous().loc)
    if (this.check('{')) return this.parseBrace()
    if (this.match('(')) {
      const loc = this.previous().loc
      if (this.match(')')) return { kind: 'unit', loc }
      const first = this.parseExpression()
      if (this.match(')')) return first
      this.consume(',', 'expected `,` in tuple')
      const items = [first]
      do {
        items.push(this.parseExpression())
      } while (this.match(','))
      this.consume(')', 'expected `)` after tuple')
      return { kind: 'tuple', items, loc }
    }
    const tok = this.peek()
    throw new ZeeError(`expected expression, found \`${tok.lexeme || tok.kind}\``, tok.loc.line, tok.loc.column, this.file)
  }

  private parseIf(loc: Loc): Expr {
    const cond = this.parseBeforeBlock()
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

  private parseMatch(loc: Loc): Expr {
    const scrutinee = this.parseBeforeBlock()
    this.consume('{', 'expected `{` after `match` subject')
    const arms: MatchArm[] = []
    while (!this.check('}') && !this.isAtEnd()) {
      arms.push(this.parseMatchArm())
    }
    this.consume('}', 'expected `}` after match arms')
    if (arms.length === 0) {
      throw new ZeeError('`match` needs at least one arm', loc.line, loc.column, this.file)
    }
    return { kind: 'match', scrutinee, arms, loc }
  }

  private parseMatchArm(): MatchArm {
    const first = this.parseMatchPattern()
    const patterns = [first]
    while (this.match('|')) {
      patterns.push(this.parseMatchPattern())
    }
    this.consume('=>', 'expected `=>` in match arm')
    const body = this.parseExpression()
    this.match(';')
    this.match(',')
    return { patterns, body, loc: first.loc }
  }

  private parseMatchPattern(): MatchPattern {
    if (this.check('ident') && this.peek().lexeme === '_') {
      const next = this.peekAt(1)
      if (next.kind === '=>' || next.kind === '|' || next.kind === '}' || next.kind === ',') {
        const tok = this.advance()
        return { kind: 'wildcard', loc: tok.loc }
      }
    }
    if (this.check('ident') && this.peekAt(1).kind === '.') {
      const saved = this.current
      const loc = this.peek().loc
      const path = [this.advance().lexeme]
      while (this.match('.')) {
        path.push(this.consume('ident', 'expected name after `.`').lexeme)
      }
      if (this.check('{') && this.looksLikeVariantFields()) {
        this.advance()
        const fields: { name: string }[] = []
        if (!this.check('}')) {
          do {
            const nameTok = this.consume('ident', 'expected field name')
            fields.push({ name: nameTok.lexeme })
          } while (this.match(','))
        }
        this.consume('}', 'expected `}` after variant fields')
        return { kind: 'variant', path, fields, loc }
      }
      this.current = saved
    }
    if (this.check('ident') && this.peekAt(1).kind === '{' && this.looksLikeVariantFieldsAt(1)) {
      const loc = this.peek().loc
      const path = [this.advance().lexeme]
      this.advance()
      const fields: { name: string }[] = []
      if (!this.check('}')) {
        do {
          const nameTok = this.consume('ident', 'expected field name')
          fields.push({ name: nameTok.lexeme })
        } while (this.match(','))
      }
      this.consume('}', 'expected `}` after variant fields')
      return { kind: 'variant', path, fields, loc }
    }
    const expr = this.parseUnary()
    return { kind: 'value', expr, loc: expr.loc }
  }

  private looksLikeVariantFields(): boolean {
    return this.looksLikeVariantFieldsAt(0)
  }

  private looksLikeVariantFieldsAt(offset: number): boolean {
    if (this.peekAt(offset).kind !== '{') return false
    const inner = this.peekAt(offset + 1)
    if (inner.kind === '}') return true
    if (inner.kind !== 'ident') return false
    const next = this.peekAt(offset + 2)
    return next.kind === '}' || next.kind === ','
  }

  private parseBrace(): Expr {
    if (this.looksLikeExplicitLambda()) return this.parseExplicitLambda()
    if (this.looksLikeMapLit()) return this.parseMapLit()
    const block = this.parseBlock()
    return { kind: 'block', block, loc: block.loc }
  }

  private parseArrayLit(loc: Loc): Expr {
    const items: Expr[] = []
    if (!this.check(']')) {
      do {
        items.push(this.parseExpression())
      } while (this.match(','))
    }
    this.consume(']', 'expected `]` after array literal')
    return { kind: 'arrayLit', items, loc }
  }

  private looksLikeMapLit(): boolean {
    if (!this.check('{')) return false
    return this.peekAt(1).kind === 'string' && this.peekAt(2).kind === ':'
  }

  private parseMapLit(): Expr {
    const loc = this.consume('{', 'expected `{`').loc
    const entries: { key: Expr; value: Expr }[] = []
    if (!this.check('}')) {
      do {
        const key = this.parseExpression()
        this.consume(':', 'expected `:` after map key')
        entries.push({ key, value: this.parseExpression() })
      } while (this.match(','))
    }
    this.consume('}', 'expected `}` after map literal')
    return { kind: 'mapLit', entries, loc }
  }

  private looksLikeStructLit(): boolean {
    if (!this.check('{')) return false
    if (this.looksLikeStructFields()) return true
    return this.trailingBrace && this.peekAt(1).kind === '}'
  }

  private looksLikeStructFields(): boolean {
    return this.check('{') && this.peekAt(1).kind === 'ident' && this.peekAt(2).kind === ':'
  }

  private parseStructLit(target: Expr): Expr {
    this.consume('{', 'expected `{`')
    const fields: { name: string; value: Expr }[] = []
    if (!this.check('}')) {
      do {
        const nameTok = this.consume('ident', 'expected field name')
        this.consume(':', 'expected `:` after field name')
        fields.push({ name: nameTok.lexeme, value: this.parseExpression() })
      } while (this.match(','))
    }
    this.consume('}', 'expected `}` after struct literal')
    const parts = flattenQualifier(target)
    let name = parts[parts.length - 1]!
    if (name === 'self') {
      if (!this.typeSelf) {
        throw new ZeeError(
          '`self` type is only valid inside a type body',
          target.loc.line,
          target.loc.column,
          this.file,
        )
      }
      if (parts.length > 1) {
        throw new ZeeError('`self` cannot be qualified', target.loc.line, target.loc.column, this.file)
      }
      name = this.typeSelf
    }
    const qualifier = parts.length > 1 ? parts.slice(0, -1) : undefined
    return { kind: 'structLit', name, qualifier, fields, loc: target.loc }
  }

  private looksLikeTypeDecl(): boolean {
    return (
      this.check('struct') ||
      this.check('class') ||
      this.check('data') ||
      this.check('readonly') ||
      this.check('sealed')
    )
  }

  private looksLikeCopyCall(): boolean {
    if (!this.check('(')) return false
    const inner = this.peekAt(1)
    if (inner.kind === ')') return true
    return inner.kind === 'ident' && this.peekAt(2).kind === ':'
  }

  private looksLikeTypeArgs(): boolean {
    if (!this.check('<')) return false
    let depth = 0
    for (let i = 0; i < 80; i += 1) {
      const tok = this.peekAt(i)
      if (tok.kind === 'eof') return false
      if (tok.kind === '<') depth += 1
      else if (tok.kind === '>') {
        depth -= 1
        if (depth === 0) return this.peekAt(i + 1).kind === '('
      }
    }
    return false
  }

  private looksLikeExplicitLambda(): boolean {
    if (!this.check('{')) return false
    const inner = this.peekAt(1)
    if (inner.kind === '->') return true
    if (inner.kind !== 'ident') return false
    const next = this.peekAt(2)
    return next.kind === '->' || next.kind === ','
  }

  private parseExplicitLambda(): Expr {
    const lbrace = this.consume('{', 'expected `{`')
    const params: string[] = []
    if (!this.match('->')) {
      do {
        const nameTok = this.consume('ident', 'expected parameter name or `_`')
        params.push(nameTok.lexeme)
      } while (this.match(','))
      this.consume('->', 'expected `->` in lambda')
    }
    const stmts: Stmt[] = []
    while (!this.check('}') && !this.isAtEnd()) {
      stmts.push(this.parseStatement())
    }
    this.consume('}', 'expected `}`')
    return { kind: 'lambda', params, body: { stmts, loc: lbrace.loc }, loc: lbrace.loc }
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

  private peekAt(offset: number): Token {
    return this.tokens[this.current + offset] ?? this.tokens[this.tokens.length - 1]!
  }

  private previous(): Token {
    return this.tokens[this.current - 1]!
  }
}

function uniqueImplements(names: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const name of names) {
    if (seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

function flattenQualifier(expr: Expr): string[] {
  const parts: string[] = []
  let current: Expr | undefined = expr
  while (current) {
    if (current.kind === 'ident') {
      parts.unshift(current.name)
      break
    }
    if (current.kind === 'member') {
      parts.unshift(current.field)
      current = current.target
      continue
    }
    throw new ZeeError('invalid struct name', expr.loc.line, expr.loc.column, expr.loc.file)
  }
  return parts
}
