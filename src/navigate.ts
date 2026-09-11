import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { Program, Stmt } from './ast.ts'
import { ZeeError, type Loc } from './error.ts'
import { tokenize, type Token } from './lexer.ts'
import { parse } from './parser.ts'
import { findProjectRoot, listPackageSources } from './project.ts'

export type DefKind = 'type' | 'fn' | 'bind' | 'module'

export interface LocationHit {
  file: string
  line: number
  column: number
  name: string
  kind: DefKind
}

export function formatGoto(hit: LocationHit): string {
  return JSON.stringify({
    file: hit.file,
    line: hit.line,
    column: hit.column,
    name: hit.name,
    kind: hit.kind,
  })
}

export interface TextReplacement {
  line: number
  column: number
  length: number
  text: string
}

export interface FileEdits {
  file: string
  replacements: TextReplacement[]
}

export function renameSymbol(args: {
  source: string
  file: string
  line: number
  column: number
  newName: string
}): FileEdits[] {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(args.newName)) {
    throw new ZeeError(`invalid name \`${args.newName}\``, args.line, args.column, args.file)
  }
  const def = findDefinition(args)
  if (!def) return []
  const project = loadProject(resolve(args.file), args.source)
  const out: FileEdits[] = []
  for (const unit of project) {
    const replacements: TextReplacement[] = []
    for (const tok of tokenize(unit.source, unit.file)) {
      if (tok.kind !== 'ident' || tok.lexeme !== def.name) continue
      const hit = findDefinition({
        source: unit.source,
        file: unit.file,
        line: tok.loc.line,
        column: tok.loc.column,
      })
      if (!hit) continue
      if (
        resolve(hit.file) === resolve(def.file) &&
        hit.line === def.line &&
        hit.column === def.column &&
        hit.name === def.name
      ) {
        replacements.push({
          line: tok.loc.line,
          column: tok.loc.column,
          length: tok.lexeme.length,
          text: args.newName,
        })
      }
    }
    if (replacements.length > 0) out.push({ file: unit.file, replacements })
  }
  return out
}

export function findDefinition(args: {
  source: string
  file: string
  line: number
  column: number
}): LocationHit | undefined {
  const file = resolve(args.file)
  const tokens = tokenize(args.source, file)
  const token = tokenAt(tokens, args.line, args.column)
  if (!token || token.kind !== 'ident') return undefined

  const current = tryParse(args.source, file)
  const project = loadProject(file, args.source)
  const byModule = groupByModule(project)

  if (current) {
    const imported = hitFromImport(tokens, token, byModule)
    if (imported) return imported
    const local = lookupName(collectSymbols(current, tokens, file), token.lexeme, token.lexeme)
    if (local) return local
  }

  for (const unit of project) {
    if (unit.file === file) continue
    const hit = lookupName(unit.symbols, token.lexeme, token.lexeme)
    if (hit) return hit
  }
  return undefined
}

interface ProjectUnit {
  file: string
  source: string
  module: string
  symbols: LocationHit[]
}

function loadProject(file: string, currentSource: string): ProjectUnit[] {
  const root = findProjectRoot(dirname(file)) ?? findProjectRoot(file)
  if (!root) {
    const tokens = tokenize(currentSource, file)
    const program = tryParse(currentSource, file)
    return [
      {
        file,
        source: currentSource,
        module: '',
        symbols: program ? collectSymbols(program, tokens, file) : [],
      },
    ]
  }
  try {
    return listPackageSources(root).map((item) => {
      const path = resolve(item.file)
      const source = path === file ? currentSource : readFileSync(path, 'utf8')
      const tokens = tokenize(source, path)
      const program = tryParse(source, path)
      return {
        file: path,
        source,
        module: item.module,
        symbols: program ? collectSymbols(program, tokens, path) : [],
      }
    })
  } catch {
    const tokens = tokenize(currentSource, file)
    const program = tryParse(currentSource, file)
    return [
      {
        file,
        source: currentSource,
        module: '',
        symbols: program ? collectSymbols(program, tokens, file) : [],
      },
    ]
  }
}

function groupByModule(units: ProjectUnit[]): Map<string, ProjectUnit[]> {
  const map = new Map<string, ProjectUnit[]>()
  for (const unit of units) {
    const list = map.get(unit.module) ?? []
    list.push(unit)
    map.set(unit.module, list)
  }
  return map
}

function tryParse(source: string, file: string): Program | undefined {
  try {
    return parse(source, file)
  } catch {
    return undefined
  }
}

export function tokenAt(tokens: Token[], line: number, column: number): Token | undefined {
  let atEnd: Token | undefined
  for (const tok of tokens) {
    if (tok.kind === 'eof' || tok.loc.line !== line || tok.lexeme.length === 0) continue
    const start = tok.loc.column
    const end = start + tok.lexeme.length
    if (column >= start && column < end) return tok
    if (column === end) atEnd = tok
  }
  return atEnd
}

export function collectSymbols(program: Program, tokens: Token[], file: string): LocationHit[] {
  const out: LocationHit[] = []
  for (const stmt of program.stmts) collectStmt(stmt, tokens, file, out)
  return out
}

function collectStmt(stmt: Stmt, tokens: Token[], file: string, out: LocationHit[]): void {
  switch (stmt.kind) {
    case 'fn':
      out.push(namedHit(tokens, file, stmt.name, stmt.loc, 'fn'))
      return
    case 'structDecl':
      out.push(namedHit(tokens, file, stmt.name, stmt.loc, 'type'))
      for (const nested of stmt.nested) collectStmt(nested, tokens, file, out)
      for (const method of stmt.methods) collectStmt(method, tokens, file, out)
      for (const item of stmt.associated) {
        out.push({ file, line: item.loc.line, column: item.loc.column, name: item.name, kind: 'bind' })
      }
      return
    case 'enumDecl':
      out.push(namedHit(tokens, file, stmt.name, stmt.loc, 'type'))
      for (const variant of stmt.variants) {
        out.push({ file, line: variant.loc.line, column: variant.loc.column, name: variant.name, kind: 'bind' })
      }
      return
    case 'typeAliasDecl':
    case 'newtypeDecl':
    case 'interfaceDecl':
      out.push(namedHit(tokens, file, stmt.name, stmt.loc, 'type'))
      return
    case 'bind':
      out.push(namedHit(tokens, file, stmt.name, stmt.loc, 'bind'))
      return
    default:
      return
  }
}

function namedHit(tokens: Token[], file: string, name: string, start: Loc, kind: DefKind): LocationHit {
  for (const tok of tokens) {
    if (tok.kind !== 'ident' || tok.lexeme !== name) continue
    if (tok.loc.line < start.line) continue
    if (tok.loc.line === start.line && tok.loc.column < start.column) continue
    return { file, line: tok.loc.line, column: tok.loc.column, name, kind }
  }
  return { file, line: start.line, column: start.column, name, kind }
}

function lookupName(symbols: LocationHit[], name: string, raw: string): LocationHit | undefined {
  const matches = symbols.filter((item) => item.name === name)
  if (matches.length === 0) return undefined
  const preferType = /^[A-Z]/.test(raw)
  if (preferType) {
    const type = matches.find((item) => item.kind === 'type')
    if (type) return type
  }
  return matches[0]
}

function hitFromImport(
  tokens: Token[],
  token: Token,
  byModule: Map<string, ProjectUnit[]>,
): LocationHit | undefined {
  const query = importQuery(tokens, token)
  if (!query) return undefined
  if (query.braceName) {
    const moduleName = query.path.join('.')
    return lookupInModule(byModule, moduleName, query.braceName) ?? moduleHit(byModule, moduleName)
  }
  const index = query.tokens.findIndex(
    (tok) => tok.loc.line === token.loc.line && tok.loc.column === token.loc.column,
  )
  if (index < 0) return undefined
  const prefix = query.path.slice(0, index + 1).join('.')
  if (byModule.has(prefix)) return moduleHit(byModule, prefix)
  if (index === 0) return undefined
  const parent = query.path.slice(0, index).join('.')
  return lookupInModule(byModule, parent, query.path[index]!) ?? moduleHit(byModule, parent)
}

function lookupInModule(
  byModule: Map<string, ProjectUnit[]>,
  moduleName: string,
  name: string,
): LocationHit | undefined {
  const units = byModule.get(moduleName)
  if (!units) return undefined
  for (const unit of units) {
    const hit = lookupName(unit.symbols, name, name)
    if (hit) return hit
  }
  return undefined
}

function moduleHit(byModule: Map<string, ProjectUnit[]>, moduleName: string): LocationHit | undefined {
  const units = byModule.get(moduleName)
  const first = units?.[0]
  if (!first) return undefined
  const last = moduleName.split('.').pop() ?? moduleName
  return { file: first.file, line: 1, column: 1, name: last, kind: 'module' }
}

function importQuery(
  tokens: Token[],
  token: Token,
): { path: string[]; tokens: Token[]; braceName?: string } | undefined {
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i]?.kind !== 'import') continue
    const pathToks: Token[] = []
    let j = i + 1
    while (tokens[j]?.kind === 'ident') {
      pathToks.push(tokens[j]!)
      j += 1
      if (tokens[j]?.kind === '.') {
        if (tokens[j + 1]?.kind === '{') {
          j += 2
          while (tokens[j]?.kind === 'ident') {
            const nameTok = tokens[j]!
            j += 1
            if (tokens[j]?.kind === 'as') {
              j += 1
              if (tokens[j]?.kind === 'ident') j += 1
            }
            if (sameToken(nameTok, token) || (tokens[j - 1] && sameToken(tokens[j - 1]!, token))) {
              return { path: pathToks.map((item) => item.lexeme), tokens: pathToks, braceName: nameTok.lexeme }
            }
            if (tokens[j]?.kind === ',') {
              j += 1
              continue
            }
            break
          }
          break
        }
        j += 1
        continue
      }
      break
    }
    if (pathToks.some((item) => sameToken(item, token))) {
      return { path: pathToks.map((item) => item.lexeme), tokens: pathToks }
    }
  }
  return undefined
}

function sameToken(left: Token, right: Token): boolean {
  return left.loc.line === right.loc.line && left.loc.column === right.loc.column && left.lexeme === right.lexeme
}
