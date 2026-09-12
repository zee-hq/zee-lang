import type { Block, Expr, InterpPart, MatchPattern, Program, Stmt, TypeAst } from './ast.ts'
import { parse } from './parser.ts'

export function formatZee(source: string, file = '<fmt>'): string {
  const program = parse(source, file)
  return formatProgram(program)
}

export function formatProgram(program: Program): string {
  const inner = program.innerDoc ? program.innerDoc.split('\n').map((line) => `//! ${line}`).join('\n') + '\n\n' : ''
  const body = program.stmts.map((stmt) => formatStmt(stmt, 0)).join('\n\n')
  const text = `${inner}${body}`.replace(/[ \t]+\n/g, '\n').replace(/\n*$/, '\n')
  return text.length === 0 ? '\n' : text
}

function formatStmt(stmt: Stmt, indent: number): string {
  const pad = '  '.repeat(indent)
  const doc = 'doc' in stmt && stmt.doc ? stmt.doc.split('\n').map((line) => `${pad}/// ${line}`).join('\n') + '\n' : ''
  const attrs =
    (stmt.kind === 'fn' || stmt.kind === 'structDecl') && stmt.attributes && stmt.attributes.length > 0
      ? stmt.attributes
          .map((attr) => {
            const args = attr.args.length > 0 ? `(${attr.args.map((arg) => JSON.stringify(arg)).join(', ')})` : ''
            return `${pad}@${attr.name}${args}\n`
          })
          .join('')
      : ''
  return doc + attrs + pad + formatStmtBody(stmt, indent)
}

function vis(stmt: { visibility: string }): string {
  return stmt.visibility === 'private' ? '' : `${stmt.visibility} `
}

function formatStmtBody(stmt: Stmt, indent: number): string {
  switch (stmt.kind) {
    case 'fn':
      return formatFn(stmt, indent)
    case 'bind': {
      const kw = stmt.mutable ? 'var' : 'const'
      const ty = stmt.typeAnn ? `: ${formatType(stmt.typeAnn)}` : ''
      return `${vis(stmt)}${kw} ${stmt.name}${ty} = ${formatExpr(stmt.init, indent)}`
    }
    case 'destructure': {
      const kw = stmt.mutable ? 'var' : 'const'
      return `${kw} (${stmt.names.join(', ')}) = ${formatExpr(stmt.init, indent)}`
    }
    case 'assign':
      return `${stmt.name} ${stmt.op} ${formatExpr(stmt.value, indent)}`
    case 'indexAssign':
      return `${formatExpr(stmt.target, indent)}[${formatExpr(stmt.index, indent)}] ${stmt.op} ${formatExpr(stmt.value, indent)}`
    case 'fieldAssign':
      return `${formatExpr(stmt.target, indent)}.${stmt.field} ${stmt.op} ${formatExpr(stmt.value, indent)}`
    case 'redim':
      return `redim ${stmt.name}: ${formatType(stmt.type)}`
    case 'redimArray':
      return `redim ${stmt.preserve ? 'preserve ' : ''}${stmt.name}, ${formatExpr(stmt.length, indent)}`
    case 'return':
      return stmt.expr ? `return ${formatExpr(stmt.expr, indent)}` : 'return'
    case 'loop':
      return formatLoop(stmt, indent)
    case 'forC': {
      const init = stmt.init ? formatStmtBody(stmt.init, indent) : ''
      const cond = stmt.cond ? formatExpr(stmt.cond, indent) : ''
      const step = stmt.step ? formatStmtBody(stmt.step, indent) : ''
      return `for (${init}; ${cond}; ${step}) ${formatBlock(stmt.body, indent)}`
    }
    case 'forForever':
      return `for ${formatBlock(stmt.body, indent)}`
    case 'forRange':
      return `for ${stmt.name} in ${formatExpr(stmt.start, indent)}..${formatExpr(stmt.end, indent)} ${formatBlock(stmt.body, indent)}`
    case 'forIn': {
      const bind = stmt.indexName ? `(${stmt.indexName}, ${stmt.name})` : stmt.name
      return `for ${bind} in ${formatExpr(stmt.seq, indent)} ${formatBlock(stmt.body, indent)}`
    }
    case 'break':
      return 'break'
    case 'continue':
      return 'continue'
    case 'defer':
      return `defer ${formatExpr(stmt.body, indent)}`
    case 'structDecl':
      return formatStruct(stmt, indent)
    case 'enumDecl': {
      const inner = stmt.variants.map((variant) => {
        const vdoc = variant.doc ? `  /// ${variant.doc}\n` : ''
        return `${vdoc}  ${variant.name}`
      }).join('\n')
      return `${vis(stmt)}enum ${stmt.name} {\n${inner}\n}`
    }
    case 'typeAliasDecl': {
      const params = stmt.typeParams.length > 0 ? `<${stmt.typeParams.join(', ')}>` : ''
      return `${vis(stmt)}type ${stmt.name}${params} = ${formatType(stmt.aliased)}`
    }
    case 'newtypeDecl':
      return `${vis(stmt)}newtype ${stmt.name} = ${formatType(stmt.inner)}`
    case 'interfaceDecl': {
      const methods = stmt.methods
        .map((method) => {
          const mdoc = method.doc ? `  /// ${method.doc}\n` : ''
          const self = method.mutating ? 'var self' : 'self'
          const extra = method.params.map((param) => formatParam(param))
          const params = [self, ...extra].join(', ')
          const ret = method.returnType ? ` -> ${formatType(method.returnType)}` : ''
          return `${mdoc}  fn ${method.name}(${params})${ret}`
        })
        .join('\n')
      return `${vis(stmt)}${stmt.sealed ? 'sealed ' : ''}interface ${stmt.name} {\n${methods}\n}`
    }
    case 'import':
      return formatImport(stmt)
    case 'expr':
      return formatExpr(stmt.expr, indent)
  }
}

function formatParam(param: { name: string; type: TypeAst; mutable: boolean; attributes?: { name: string; args: string[] }[] }): string {
  const attrs = (param.attributes ?? [])
    .map((attr) => {
      const args = attr.args.length > 0 ? `(${attr.args.map((arg) => JSON.stringify(arg)).join(', ')})` : ''
      return `@${attr.name}${args}`
    })
    .join(' ')
  const prefix = attrs.length > 0 ? `${attrs} ` : ''
  return `${prefix}${param.mutable ? 'var ' : ''}${param.name}: ${formatType(param.type)}`
}

function formatFn(stmt: Extract<Stmt, { kind: 'fn' }>, indent: number): string {
  const params = stmt.params.map((param) => formatParam(param)).join(', ')
  const gens = stmt.typeParams.length > 0 ? `<${stmt.typeParams.join(', ')}>` : ''
  const ret = stmt.returnType ? ` -> ${formatType(stmt.returnType)}` : ''
  return `${vis(stmt)}fn ${stmt.name}${gens}(${params})${ret} ${formatBlock(stmt.body, indent)}`
}

function formatLoop(stmt: Extract<Stmt, { kind: 'loop' }>, indent: number): string {
  const cond = formatExpr(stmt.cond, indent)
  const body = formatBlock(stmt.body, indent)
  if (stmt.mode === 'while') return `while ${cond} ${body}`
  if (stmt.mode === 'until') return `until ${cond} ${body}`
  if (stmt.mode === 'do-while') return `do ${body} while ${cond}`
  return `do ${body} until ${cond}`
}

function formatStruct(stmt: Extract<Stmt, { kind: 'structDecl' }>, indent: number): string {
  const mods = `${stmt.readonly ? 'readonly ' : ''}${stmt.data ? 'data ' : ''}${stmt.sealed ? 'sealed ' : ''}`
  const form = stmt.identity ? 'class' : 'struct'
  const impl = stmt.implements.length > 0 ? ` implements ${stmt.implements.join(', ')}` : ''
  const members: string[] = []
  for (const field of stmt.fields) {
    const fdoc = field.doc ? `  /// ${field.doc}\n` : ''
    const fvis = field.visibility === 'private' ? '' : `${field.visibility} `
    members.push(`${fdoc}  ${fvis}${field.mutable ? 'var' : 'const'} ${field.name}: ${formatType(field.type)}`)
  }
  for (const item of stmt.associated) {
    const adoc = item.doc ? `  /// ${item.doc}\n` : ''
    const avis = item.visibility === 'private' ? '' : `${item.visibility} `
    const ty = item.typeAnn ? `: ${formatType(item.typeAnn)}` : ''
    members.push(`${adoc}  ${avis}${item.mutable ? 'var' : 'const'} ${item.name}${ty} = ${formatExpr(item.init, indent + 1)}`)
  }
  for (const nested of stmt.nested) {
    members.push(formatStmt(nested, indent + 1).replace(/^\s*/, '  '))
  }
  for (const variant of stmt.variants) {
    const vdoc = variant.doc ? `  /// ${variant.doc}\n` : ''
    const vform = variant.identity ? 'class' : 'struct'
    const vmods = `${variant.readonly ? 'readonly ' : ''}${variant.data ? 'data ' : ''}`
    const fields = variant.fields
      .map((field) => `    ${field.mutable ? 'var' : 'const'} ${field.name}: ${formatType(field.type)}`)
      .join('\n')
    members.push(`${vdoc}  ${vmods}${vform} ${variant.name} {\n${fields}\n  }`)
  }
  for (const method of stmt.methods) {
    members.push(formatStmt(method, indent + 1).replace(/^\s*/, '  '))
  }
  const inner = members.length === 0 ? '' : `\n${members.join('\n')}\n`
  return `${vis(stmt)}${mods}${form} ${stmt.name}${impl} {${inner}}`
}

function formatImport(stmt: Extract<Stmt, { kind: 'import' }>): string {
  const path = stmt.path.join('.')
  if (stmt.names) {
    const names = stmt.names.map((item) => (item.alias ? `${item.name} as ${item.alias}` : item.name)).join(', ')
    return `import ${path}.{${names}}`
  }
  return `import ${path}${stmt.alias ? ` as ${stmt.alias}` : ''}`
}

function formatBlock(block: Block, indent: number): string {
  if (block.stmts.length === 0) return '{}'
  const inner = block.stmts.map((stmt) => formatStmt(stmt, indent + 1)).join('\n')
  const close = '  '.repeat(indent)
  return `{\n${inner}\n${close}}`
}

function formatExpr(expr: Expr, indent: number): string {
  switch (expr.kind) {
    case 'int':
      return `${expr.value}${expr.suffix ?? ''}`
    case 'float':
      return `${expr.value}${expr.suffix ?? ''}`
    case 'bool':
      return expr.value ? 'true' : 'false'
    case 'string':
      return JSON.stringify(expr.value)
    case 'char':
      return `'${escapeChar(expr.value)}'`
    case 'interp':
      return '`' + expr.parts.map(formatInterpPart).join('') + '`'
    case 'unit':
      return '()'
    case 'ident':
      return expr.name
    case 'binary':
      return `${formatExpr(expr.left, indent)} ${expr.op} ${formatExpr(expr.right, indent)}`
    case 'unary':
      return `${expr.op}${formatExpr(expr.expr, indent)}`
    case 'call': {
      const gens = expr.typeArgs && expr.typeArgs.length > 0 ? `<${expr.typeArgs.map(formatType).join(', ')}>` : ''
      return `${formatExpr(expr.callee, indent)}${gens}(${expr.args.map((arg) => formatExpr(arg, indent)).join(', ')})`
    }
    case 'tuple':
      return `(${expr.items.map((item) => formatExpr(item, indent)).join(', ')})`
    case 'tupleIndex':
      return `${formatExpr(expr.target, indent)}.${expr.index}`
    case 'index':
      return `${formatExpr(expr.target, indent)}[${formatExpr(expr.index, indent)}]`
    case 'member':
      return `${formatExpr(expr.target, indent)}.${expr.field}`
    case 'arrayLit':
      return `[${expr.items.map((item) => formatExpr(item, indent)).join(', ')}]`
    case 'mapLit': {
      const entries = expr.entries.map((entry) => `${formatExpr(entry.key, indent)}: ${formatExpr(entry.value, indent)}`)
      return `{ ${entries.join(', ')} }`
    }
    case 'structLit': {
      const name = [...(expr.qualifier ?? []), expr.name].join('.')
      const fields = expr.fields.map((field) => `${field.name}: ${formatExpr(field.value, indent)}`).join(', ')
      return `${name} { ${fields} }`
    }
    case 'if': {
      const then = formatBlock(expr.then, indent)
      if (!expr.else) return `if ${formatExpr(expr.cond, indent)} ${then}`
      return `if ${formatExpr(expr.cond, indent)} ${then} else ${formatBlock(expr.else, indent)}`
    }
    case 'block': {
      const params = expr.lambdaParams?.length ? `${expr.lambdaParams.join(', ')} -> ` : ''
      if (expr.block.stmts.length === 0) return `{ ${params.trim()} }`
      const inner = expr.block.stmts.map((stmt) => formatStmt(stmt, indent + 1)).join('\n')
      return `{ ${params}\n${inner}\n${'  '.repeat(indent)}}`
    }
    case 'lambda': {
      const params = expr.params.length > 0 ? `${expr.params.join(', ')} -> ` : ''
      if (expr.body.stmts.length === 0) return `{ ${params}}`
      const inner = expr.body.stmts.map((stmt) => formatStmt(stmt, indent + 1)).join('\n')
      return `{ ${params}\n${inner}\n${'  '.repeat(indent)}}`
    }
    case 'match': {
      const arms = expr.arms
        .map((arm) => {
          const pats = arm.patterns.map(formatPattern).join(' | ')
          return `${'  '.repeat(indent + 1)}${pats} => ${formatExpr(arm.body, indent + 1)}`
        })
        .join('\n')
      return `match ${formatExpr(expr.scrutinee, indent)} {\n${arms}\n${'  '.repeat(indent)}}`
    }
    case 'copy': {
      const fields = expr.fields.map((field) => `${field.name}: ${formatExpr(field.value, indent)}`).join(', ')
      return `${formatExpr(expr.target, indent)}.copy(${fields})`
    }
    case 'returnExpr':
      return expr.expr ? `return ${formatExpr(expr.expr, indent)}` : 'return'
    case 'isType':
      return `${formatExpr(expr.expr, indent)} is ${formatType(expr.type)}`
  }
}

function formatInterpPart(part: InterpPart): string {
  if (part.kind === 'text') return part.value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/{/g, '\\{')
  return `{${formatExpr(part.expr, 0)}}`
}

function formatPattern(pattern: MatchPattern): string {
  if (pattern.kind === 'wildcard') return '_'
  if (pattern.kind === 'value') return formatExpr(pattern.expr, 0)
  const path = pattern.path.join('.')
  if (!pattern.fields) return path
  return `${path} { ${pattern.fields.map((field) => field.name).join(', ')} }`
}

function formatType(type: TypeAst): string {
  switch (type.kind) {
    case 'named':
      return type.name
    case 'unit':
      return '()'
    case 'tuple':
      return `(${type.parts.map(formatType).join(', ')})`
    case 'generic':
      return `${type.name}<${type.args.map(formatType).join(', ')}>`
    case 'fn':
      return `(${type.params.map(formatType).join(', ')}) -> ${formatType(type.ret)}`
    case 'array':
      return `${formatType(type.elem)}[]`
  }
}

function escapeChar(value: string): string {
  if (value === '\n') return '\\n'
  if (value === '\t') return '\\t'
  if (value === '\\') return '\\\\'
  if (value === "'") return "\\'"
  return value
}
