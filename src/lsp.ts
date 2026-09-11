import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { Program, Stmt, TypeAst } from './ast.ts'
import { check } from './checker.ts'
import { ZeeError } from './error.ts'
import { KEYWORDS, tokenize, type Token } from './lexer.ts'
import {
  collectSymbols,
  findDefinition,
  renameSymbol,
  tokenAt,
  type LocationHit,
} from './navigate.ts'
import { formatZee } from './format.ts'
import { parse } from './parser.ts'
import { findProjectRoot, listPackageSources } from './project.ts'
import { loadProgramFromPath } from './zee.ts'

export const BUILTIN_NAMES = [
  'print',
  'println',
  'str',
  'getenv',
  'envProfile',
  'envAppMeta',
  'testCases',
  'testCall',
  'error',
  'panic',
] as const

export const SEMANTIC_TOKEN_TYPES = ['namespace', 'type', 'class', 'enum', 'interface', 'struct', 'function', 'variable', 'keyword', 'modifier', 'parameter'] as const

export interface LspDiagnostic {
  file: string
  line: number
  column: number
  message: string
}

export interface LspHover {
  contents: string
}

export interface LspCompletion {
  label: string
  kind: 'fn' | 'type' | 'var' | 'keyword' | 'module'
  detail?: string
}

export interface LspLocation {
  file: string
  line: number
  column: number
}

export interface LspInlayHint {
  line: number
  column: number
  label: string
}

export interface LspSignature {
  label: string
  parameters: string[]
}

interface OpenDoc {
  file: string
  text: string
}

export class LspSession {
  private readonly docs = new Map<string, OpenDoc>()

  open(uri: string, text: string): LspDiagnostic[] {
    const file = fileFromUri(uri)
    this.docs.set(file, { file, text })
    return this.diagnostics(file)
  }

  change(uri: string, text: string): LspDiagnostic[] {
    return this.open(uri, text)
  }

  close(uri: string): void {
    this.docs.delete(fileFromUri(uri))
  }

  diagnostics(file: string): LspDiagnostic[] {
    const source = this.sourceOf(file)
    try {
      const program = this.program(file, source)
      check(program)
      return []
    } catch (err) {
      if (err instanceof ZeeError) {
        return [{ file: err.file, line: err.line, column: err.column, message: err.message.replace(/^.*?:\d+:\d+: /, '') }]
      }
      return [{ file, line: 1, column: 1, message: err instanceof Error ? err.message : String(err) }]
    }
  }

  hover(uri: string, line: number, character: number): LspHover | undefined {
    const file = fileFromUri(uri)
    const source = this.sourceOf(file)
    const pos = { line: line + 1, column: character + 1 }
    const tokens = tokenize(source, file)
    const tok = tokenAt(tokens, pos.line, pos.column)
    if (!tok) return undefined
    if (tok.kind === 'pub' || tok.kind === 'internal') {
      return { contents: `\`${tok.lexeme}\` visibility` }
    }
    if (tok.lexeme === 'self') {
      return { contents: '`self` — enclosing type (receiver)' }
    }
    if (BUILTIN_NAMES.includes(tok.lexeme as (typeof BUILTIN_NAMES)[number])) {
      return { contents: `\`fn ${tok.lexeme}(…)\`\n\nhost builtin` }
    }
    const hit = findDefinition({ source, file, ...pos })
    const program = this.tryProgram(file, source)
    if (hit && program) {
      const stmt = findNamedStmt(program, hit)
      const doc = stmtDoc(stmt)
      const sig = stmt ? signatureOf(stmt) : `${hit.kind} ${hit.name}`
      return { contents: doc ? `${sig}\n\n${doc}` : sig }
    }
    if (hit) return { contents: `${hit.kind} ${hit.name}` }
    if (tok.kind === 'ident') return { contents: tok.lexeme }
    return undefined
  }

  definition(uri: string, line: number, character: number): LspLocation | undefined {
    const file = fileFromUri(uri)
    const source = this.sourceOf(file)
    const hit = findDefinition({ source, file, line: line + 1, column: character + 1 })
    if (!hit) return undefined
    return { file: hit.file, line: hit.line, column: hit.column }
  }

  complete(uri: string, _line: number, _character: number): LspCompletion[] {
    const file = fileFromUri(uri)
    const source = this.sourceOf(file)
    const out: LspCompletion[] = []
    for (const name of Object.keys(KEYWORDS)) {
      out.push({ label: name, kind: 'keyword' })
    }
    for (const name of BUILTIN_NAMES) {
      out.push({ label: name, kind: 'fn', detail: 'builtin' })
    }
    const program = this.tryProgram(file, source)
    if (program) {
      const tokens = tokenize(source, file)
      for (const hit of collectSymbols(program, tokens, file)) {
        const kind = hit.kind === 'fn' ? 'fn' : hit.kind === 'type' ? 'type' : hit.kind === 'module' ? 'module' : 'var'
        if (!out.some((item) => item.label === hit.name && item.kind === kind)) {
          out.push({ label: hit.name, kind })
        }
      }
      for (const unit of program.units ?? []) {
        for (const stmt of unit.stmts) {
          if (stmt.kind === 'import') {
            const label = stmt.path[0]
            if (label && !out.some((item) => item.label === label)) {
              out.push({ label, kind: 'module', detail: 'import' })
            }
          }
        }
      }
    }
    return out
  }

  references(uri: string, line: number, character: number): LspLocation[] {
    const file = fileFromUri(uri)
    const source = this.sourceOf(file)
    const tok = tokenAt(tokenize(source, file), line + 1, character + 1)
    if (!tok || tok.kind !== 'ident') return []
    const name = tok.lexeme
    const out: LspLocation[] = []
    for (const [path, text] of this.projectTexts(file, source)) {
      for (const item of tokenize(text, path)) {
        if (item.kind === 'ident' && item.lexeme === name) {
          out.push({ file: path, line: item.loc.line, column: item.loc.column })
        }
      }
    }
    return out
  }

  inlayHints(uri: string): LspInlayHint[] {
    const file = fileFromUri(uri)
    const source = this.sourceOf(file)
    try {
      const program = this.program(file, source)
      const checked = check(program)
      return checked.hints
        .filter((hint) => resolve(hint.file) === resolve(file))
        .map((hint) => {
          const nameTok = tokenize(source, file).find(
            (tok) => tok.kind === 'ident' && tok.lexeme === hint.name && tok.loc.line === hint.line,
          )
          const column = (nameTok?.loc.column ?? hint.column) + hint.name.length
          return { line: hint.line, column, label: `: ${hint.type}` }
        })
    } catch {
      return []
    }
  }

  format(uri: string): string {
    const file = fileFromUri(uri)
    try {
      return formatZee(this.sourceOf(file), file)
    } catch {
      return this.sourceOf(file)
    }
  }

  rename(uri: string, line: number, character: number, newName: string) {
    const file = fileFromUri(uri)
    return renameSymbol({
      source: this.sourceOf(file),
      file,
      line: line + 1,
      column: character + 1,
      newName,
    })
  }

  prepareRename(uri: string, line: number, character: number): { line: number; column: number; length: number } | undefined {
    const file = fileFromUri(uri)
    const tok = tokenAt(tokenize(this.sourceOf(file), file), line + 1, character + 1)
    if (!tok || tok.kind !== 'ident') return undefined
    return { line: tok.loc.line, column: tok.loc.column, length: tok.lexeme.length }
  }

  signatureHelp(uri: string, line: number, character: number): LspSignature | undefined {
    const file = fileFromUri(uri)
    const source = this.sourceOf(file)
    const tokens = tokenize(source, file)
    const pos = { line: line + 1, column: character + 1 }
    let ident: Token | undefined
    for (let i = tokens.length - 1; i >= 0; i -= 1) {
      const tok = tokens[i]!
      if (tok.loc.line > pos.line || (tok.loc.line === pos.line && tok.loc.column > pos.column)) continue
      if (tok.kind === '(' && i > 0 && tokens[i - 1]?.kind === 'ident') {
        ident = tokens[i - 1]
        break
      }
    }
    if (!ident) return undefined
    const hit = findDefinition({ source, file, line: ident.loc.line, column: ident.loc.column })
    const program = this.tryProgram(file, source)
    const stmt = hit && program ? findNamedStmt(program, hit) : undefined
    if (stmt?.kind === 'fn') {
      const params = stmt.params.map((param) => `${param.name}: ${formatTypeAst(param.type)}`)
      const ret = stmt.returnType ? ` -> ${formatTypeAst(stmt.returnType)}` : ''
      return { label: `fn ${stmt.name}(${params.join(', ')})${ret}`, parameters: params }
    }
    if (BUILTIN_NAMES.includes(ident.lexeme as (typeof BUILTIN_NAMES)[number])) {
      return { label: `fn ${ident.lexeme}(…)`, parameters: ['…'] }
    }
    return undefined
  }

  semanticTokens(uri: string): number[] {
    const file = fileFromUri(uri)
    const source = this.sourceOf(file)
    const tokens = tokenize(source, file)
    const program = this.tryProgram(file, source)
    const typeNames = new Set<string>()
    const fnNames = new Set<string>()
    if (program) {
      for (const hit of collectSymbols(program, tokens, file)) {
        if (hit.kind === 'type') typeNames.add(hit.name)
        if (hit.kind === 'fn') fnNames.add(hit.name)
      }
    }
    const data: number[] = []
    let prevLine = 1
    let prevCol = 1
    for (const tok of tokens) {
      if (tok.kind === 'eof' || tok.lexeme.length === 0) continue
      const typeIndex = tokenTypeIndex(tok, typeNames, fnNames)
      if (typeIndex < 0) continue
      const deltaLine = tok.loc.line - prevLine
      const deltaStart = deltaLine === 0 ? tok.loc.column - prevCol : tok.loc.column - 1
      data.push(deltaLine, deltaStart, tok.lexeme.length, typeIndex, 0)
      prevLine = tok.loc.line
      prevCol = tok.loc.column
    }
    return data
  }

  dispatch(message: LspMessage): LspMessage | LspMessage[] | undefined {
    if (message.method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          capabilities: {
            textDocumentSync: 1,
            hoverProvider: true,
            completionProvider: { triggerCharacters: ['.'] },
            definitionProvider: true,
            referencesProvider: true,
            signatureHelpProvider: { triggerCharacters: ['('] },
            inlayHintProvider: true,
            documentFormattingProvider: true,
            renameProvider: { prepareProvider: true },
            semanticTokensProvider: {
              legend: { tokenTypes: [...SEMANTIC_TOKEN_TYPES], tokenModifiers: [] },
              full: true,
            },
          },
        },
      }
    }
    if (message.method === 'initialized' || message.method === 'shutdown') {
      return message.method === 'shutdown' ? { jsonrpc: '2.0', id: message.id, result: null } : undefined
    }
    const params = (message.params ?? {}) as Record<string, unknown>
    const doc = params.textDocument as { uri?: string; text?: string } | undefined
    const pos = params.position as { line?: number; character?: number } | undefined
    if (message.method === 'textDocument/didOpen') {
      const item = (params.textDocument ?? {}) as { uri: string; text: string }
      const diags = this.open(item.uri, item.text)
      return publishDiagnostics(item.uri, diags)
    }
    if (message.method === 'textDocument/didChange') {
      const uri = doc?.uri
      const changes = params.contentChanges as { text: string }[] | undefined
      if (uri && changes?.[0]) {
        return publishDiagnostics(uri, this.change(uri, changes[0].text))
      }
      return undefined
    }
    if (message.method === 'textDocument/didClose' && doc?.uri) {
      this.close(doc.uri)
      return undefined
    }
    if (!doc?.uri) return message.id === undefined ? undefined : { jsonrpc: '2.0', id: message.id, result: null }
    const uri = doc.uri
    const line = pos?.line ?? 0
    const character = pos?.character ?? 0
    if (message.method === 'textDocument/hover') {
      const hover = this.hover(uri, line, character)
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: hover ? { contents: { kind: 'markdown', value: hover.contents } } : null,
      }
    }
    if (message.method === 'textDocument/definition') {
      const hit = this.definition(uri, line, character)
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: hit ? locationToLsp(hit) : null,
      }
    }
    if (message.method === 'textDocument/completion') {
      return { jsonrpc: '2.0', id: message.id, result: this.complete(uri, line, character).map(completionToLsp) }
    }
    if (message.method === 'textDocument/references') {
      return { jsonrpc: '2.0', id: message.id, result: this.references(uri, line, character).map(locationToLsp) }
    }
    if (message.method === 'textDocument/inlayHint') {
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: this.inlayHints(uri).map((hint) => ({
          position: { line: hint.line - 1, character: hint.column - 1 },
          label: hint.label,
        })),
      }
    }
    if (message.method === 'textDocument/formatting') {
      const formatted = this.format(uri)
      const source = this.sourceOf(fileFromUri(uri))
      const lines = source.split('\n')
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: [
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: Math.max(lines.length - 1, 0), character: lines.at(-1)?.length ?? 0 },
            },
            newText: formatted,
          },
        ],
      }
    }
    if (message.method === 'textDocument/prepareRename') {
      const prep = this.prepareRename(uri, line, character)
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: prep
          ? {
              range: {
                start: { line: prep.line - 1, character: prep.column - 1 },
                end: { line: prep.line - 1, character: prep.column - 1 + prep.length },
              },
            }
          : null,
      }
    }
    if (message.method === 'textDocument/rename') {
      try {
        const newName = String((params.newName as string | undefined) ?? '')
        const edits = this.rename(uri, line, character, newName)
        const changes: Record<string, { range: { start: { line: number; character: number }; end: { line: number; character: number } }; newText: string }[]> = {}
        for (const file of edits) {
          const uriKey = `file://${file.file}`
          changes[uriKey] = file.replacements.map((item) => ({
            range: {
              start: { line: item.line - 1, character: item.column - 1 },
              end: { line: item.line - 1, character: item.column - 1 + item.length },
            },
            newText: item.text,
          }))
        }
        return { jsonrpc: '2.0', id: message.id, result: { changes } }
      } catch (error) {
        return {
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32602, message: error instanceof Error ? error.message : String(error) },
        }
      }
    }
    if (message.method === 'textDocument/signatureHelp') {
      const help = this.signatureHelp(uri, line, character)
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: help
          ? {
              signatures: [
                {
                  label: help.label,
                  parameters: help.parameters.map((label) => ({ label })),
                },
              ],
              activeSignature: 0,
              activeParameter: 0,
            }
          : null,
      }
    }
    if (message.method === 'textDocument/semanticTokens/full') {
      return { jsonrpc: '2.0', id: message.id, result: { data: this.semanticTokens(uri) } }
    }
    return message.id === undefined ? undefined : { jsonrpc: '2.0', id: message.id, result: null }
  }

  private sourceOf(file: string): string {
    const open = this.docs.get(resolve(file)) ?? this.docs.get(file)
    if (open) return open.text
    return readFileSync(file, 'utf8')
  }

  private overlay(): Map<string, string> {
    const map = new Map<string, string>()
    for (const doc of this.docs.values()) {
      map.set(resolve(doc.file), doc.text)
    }
    return map
  }

  private program(file: string, source: string): Program {
    const overlay = this.overlay()
    overlay.set(resolve(file), source)
    if (!existsSync(file) && !overlay.has(resolve(file))) {
      return parse(source, file)
    }
    try {
      return loadProgramFromPath(file, { overlay })
    } catch {
      return parse(source, file)
    }
  }

  private tryProgram(file: string, source: string): Program | undefined {
    try {
      return this.program(file, source)
    } catch {
      try {
        return parse(source, file)
      } catch {
        return undefined
      }
    }
  }

  private projectTexts(file: string, source: string): [string, string][] {
    const overlay = this.overlay()
    overlay.set(resolve(file), source)
    const root = findProjectRoot(dirname(file))
    if (!root) return [[file, source]]
    return listPackageSources(root).map((item) => {
      const path = resolve(item.file)
      const text = overlay.get(path) ?? (existsSync(path) ? readFileSync(path, 'utf8') : '')
      return [path, text]
    })
  }
}

export type LspMessage = {
  jsonrpc: '2.0'
  id?: number | string
  method?: string
  params?: unknown
  result?: unknown
  error?: unknown
}

export function encodeLspMessage(message: LspMessage): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf8')
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf8')
  return Buffer.concat([header, body])
}

export function tryReadLspMessage(buffer: Buffer): { message: LspMessage; rest: Buffer } | undefined {
  const headerEnd = buffer.indexOf('\r\n\r\n')
  if (headerEnd < 0) return undefined
  const header = buffer.subarray(0, headerEnd).toString('utf8')
  const match = /Content-Length:\s*(\d+)/i.exec(header)
  if (!match) return undefined
  const length = Number(match[1])
  const start = headerEnd + 4
  if (buffer.length < start + length) return undefined
  const body = buffer.subarray(start, start + length).toString('utf8')
  const rest = buffer.subarray(start + length)
  return { message: JSON.parse(body) as LspMessage, rest }
}

export async function serveLsp(
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
): Promise<void> {
  const session = new LspSession()
  let buffer: Buffer = Buffer.alloc(0)
  for await (const chunk of input) {
    buffer = Buffer.concat([buffer, Buffer.from(chunk)]) as Buffer
    while (true) {
      const parsed = tryReadLspMessage(buffer)
      if (!parsed) break
      buffer = parsed.rest
      const reply = session.dispatch(parsed.message)
      for (const item of Array.isArray(reply) ? reply : reply ? [reply] : []) {
        output.write(encodeLspMessage(item))
      }
    }
  }
}

function publishDiagnostics(uri: string, diags: LspDiagnostic[]): LspMessage {
  return {
    jsonrpc: '2.0',
    method: 'textDocument/publishDiagnostics',
    params: {
      uri,
      diagnostics: diags.map((item) => ({
        range: {
          start: { line: Math.max(item.line - 1, 0), character: Math.max(item.column - 1, 0) },
          end: { line: Math.max(item.line - 1, 0), character: Math.max(item.column, 1) },
        },
        message: item.message,
        severity: 1,
        source: 'zee',
      })),
    },
  }
}

function fileFromUri(uri: string): string {
  if (uri.startsWith('file://')) {
    let path = decodeURIComponent(uri.slice('file://'.length))
    if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1)
    return path
  }
  return resolve(uri)
}

function locationToLsp(hit: LspLocation): { uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } } {
  const pos = { line: hit.line - 1, character: hit.column - 1 }
  return { uri: `file://${hit.file}`, range: { start: pos, end: pos } }
}

function completionToLsp(item: LspCompletion): { label: string; kind: number; detail?: string } {
  const kinds = { fn: 3, type: 22, var: 6, keyword: 14, module: 9 }
  return { label: item.label, kind: kinds[item.kind], detail: item.detail }
}

function tokenTypeIndex(tok: Token, typeNames: Set<string>, fnNames: Set<string>): number {
  const types = SEMANTIC_TOKEN_TYPES
  if (tok.kind === 'pub' || tok.kind === 'internal') return types.indexOf('modifier')
  if (tok.kind === 'class') return types.indexOf('class')
  if (tok.kind === 'struct' || tok.kind === 'data') return types.indexOf('struct')
  if (tok.kind === 'enum') return types.indexOf('enum')
  if (tok.kind === 'interface') return types.indexOf('interface')
  if (tok.kind === 'fn' || tok.lexeme in KEYWORDS) return types.indexOf('keyword')
  if (tok.lexeme === 'self') return types.indexOf('parameter')
  if (tok.kind === 'ident') {
    if (typeNames.has(tok.lexeme) || /^[A-Z]/.test(tok.lexeme)) return types.indexOf('type')
    if (fnNames.has(tok.lexeme) || BUILTIN_NAMES.includes(tok.lexeme as (typeof BUILTIN_NAMES)[number])) {
      return types.indexOf('function')
    }
    return types.indexOf('variable')
  }
  return -1
}

function findNamedStmt(program: Program, hit: LocationHit): Stmt | undefined {
  const units = program.units ?? [{ file: program.file, module: '', stmts: program.stmts }]
  for (const unit of units) {
    if (resolve(unit.file) !== resolve(hit.file) && hit.kind !== 'fn' && hit.kind !== 'type') continue
    const found = walkStmts(unit.stmts, hit)
    if (found) return found
  }
  return walkStmts(program.stmts, hit)
}

function walkStmts(stmts: Stmt[], hit: LocationHit): Stmt | undefined {
  for (const stmt of stmts) {
    if ((stmt.kind === 'fn' || stmt.kind === 'structDecl' || stmt.kind === 'enumDecl' || stmt.kind === 'typeAliasDecl' || stmt.kind === 'newtypeDecl' || stmt.kind === 'interfaceDecl' || stmt.kind === 'bind') && stmt.name === hit.name) {
      if (hit.kind === 'fn' && stmt.kind !== 'fn') continue
      if (hit.kind === 'type' && stmt.kind === 'fn') continue
      if (hit.kind === 'bind' && stmt.kind !== 'bind') continue
      return stmt
    }
    if (stmt.kind === 'structDecl') {
      const nested = walkStmts([...stmt.nested, ...stmt.methods], hit)
      if (nested) return nested
    }
  }
  return undefined
}

function stmtDoc(stmt: Stmt | undefined): string | undefined {
  if (!stmt) return undefined
  if ('doc' in stmt) return stmt.doc
  return undefined
}

function signatureOf(stmt: Stmt): string {
  if (stmt.kind === 'fn') {
    const params = stmt.params.map((param) => `${param.name}: ${formatTypeAst(param.type)}`).join(', ')
    const ret = stmt.returnType ? ` -> ${formatTypeAst(stmt.returnType)}` : ''
    const vis = stmt.visibility === 'private' ? '' : `${stmt.visibility} `
    return `${vis}fn ${stmt.name}(${params})${ret}`
  }
  if (stmt.kind === 'structDecl') {
    const form = stmt.identity ? 'class' : stmt.data ? 'data' : 'struct'
    return `${stmt.visibility === 'private' ? '' : `${stmt.visibility} `}${form} ${stmt.name}`
  }
  if (stmt.kind === 'enumDecl') return `enum ${stmt.name}`
  if (stmt.kind === 'interfaceDecl') return `interface ${stmt.name}`
  if (stmt.kind === 'bind') {
    const kw = stmt.mutable ? 'var' : 'const'
    const ty = stmt.typeAnn ? `: ${formatTypeAst(stmt.typeAnn)}` : ''
    return `${kw} ${stmt.name}${ty}`
  }
  if (stmt.kind === 'typeAliasDecl') return `type ${stmt.name}`
  if (stmt.kind === 'newtypeDecl') return `newtype ${stmt.name}`
  return stmt.kind
}

function formatTypeAst(type: TypeAst): string {
  switch (type.kind) {
    case 'named':
      return type.name
    case 'unit':
      return 'Unit'
    case 'tuple':
      return `(${type.parts.map(formatTypeAst).join(', ')})`
    case 'generic':
      return `${type.name}<${type.args.map(formatTypeAst).join(', ')}>`
    case 'fn':
      return `(${type.params.map(formatTypeAst).join(', ')}) -> ${formatTypeAst(type.ret)}`
    case 'array':
      return `${formatTypeAst(type.elem)}[]`
  }
}
