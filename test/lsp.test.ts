import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { encodeLspMessage, LspSession, serveLsp, tryReadLspMessage } from '../src/lsp.ts'

const temps: string[] = []

function scratch(): string {
  const dir = mkdtempSync(join(import.meta.dirname, 'lsp-'))
  temps.push(dir)
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'zee.toml'), '[package]\nname = "app"\nversion = "0.1.0"\nentry = "src/main.zee"\n')
  return dir
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function at(source: string, needle: string, occurrence = 1): { line: number; character: number } {
  let remaining = occurrence
  let line = 1
  let column = 1
  for (let i = 0; i < source.length; i += 1) {
    if (source.startsWith(needle, i)) {
      remaining -= 1
      if (remaining === 0) return { line: line - 1, character: column - 1 }
    }
    if (source[i] === '\n') {
      line += 1
      column = 1
    } else {
      column += 1
    }
  }
  throw new Error(`needle not found: ${needle}`)
}

describe('zee lsp (ZEE-2)', () => {
  it('hovers a documented function with its signature and ///', () => {
    const root = scratch()
    const file = join(root, 'src/main.zee')
    const source = `/// Adds one.
pub fn inc(n: i32) -> i32 { n + 1 }
fn main() { inc(1) }
`
    writeFileSync(file, source)
    const session = new LspSession()
    session.open(file, source)
    const pos = at(source, 'inc', 2)
    const hover = session.hover(file, pos.line, pos.character)
    expect(hover?.contents).toMatch(/pub fn inc\(n: i32\) -> i32/)
    expect(hover?.contents).toMatch(/Adds one/)
  })

  it('completes imported names and go-to-def across modules', () => {
    const root = scratch()
    const http = join(root, 'src/http.zee')
    writeFileSync(http, '/// Fetch a URL.\npub fn get() -> String { "ok" }\n')
    const file = join(root, 'src/main.zee')
    const source = 'import http.get\nfn main() {\n  println(get())\n}\n'
    writeFileSync(file, source)
    const session = new LspSession()
    session.open(file, source)
    const items = session.complete(file, 0, 0)
    expect(items.some((item) => item.label === 'get' && item.kind === 'fn')).toBe(true)
    expect(items.some((item) => item.label === 'println')).toBe(true)
    const pos = at(source, 'get', 1)
    const def = session.definition(file, pos.line, pos.character)
    expect(def?.file).toBe(resolve(http))
  })

  it('reports checker diagnostics', () => {
    const file = '/tmp/bad.zee'
    const source = 'fn main() {\n  const x: String = 1\n}\n'
    const session = new LspSession()
    const diags = session.open(file, source)
    expect(diags.length).toBeGreaterThan(0)
    expect(diags[0]?.message).toMatch(/String|i32|printable|expected/)
  })

  it('inlays the inferred type where the annotation is omitted', () => {
    const file = '/tmp/infer.zee'
    const source = 'fn main() {\n  const n = 1\n}\n'
    const session = new LspSession()
    session.open(file, source)
    const hints = session.inlayHints(file)
    expect(hints.some((hint) => hint.label === ': i32')).toBe(true)
  })

  it('emits semantic tokens for class, fn, pub, and self', () => {
    const file = '/tmp/tokens.zee'
    const source = 'pub struct Point { }\npub class User {\n  fn name(self) -> String { "a" }\n}\n'
    const session = new LspSession()
    session.open(file, source)
    const data = session.semanticTokens(file)
    expect(data.length).toBeGreaterThan(0)
    expect(data.length % 5).toBe(0)
  })

  it('finds references to a name in the file', () => {
    const file = '/tmp/refs.zee'
    const source = 'fn add(a: i32) -> i32 { a }\nfn main() { add(1) }\n'
    const session = new LspSession()
    session.open(file, source)
    const pos = at(source, 'add', 1)
    const refs = session.references(file, pos.line, pos.character)
    expect(refs.length).toBeGreaterThanOrEqual(2)
  })

  it('offers parameter hints at a call', () => {
    const file = '/tmp/sig.zee'
    const source = 'fn add(a: i32, b: i32) -> i32 { a + b }\nfn main() { add(1, 2) }\n'
    const session = new LspSession()
    session.open(file, source)
    const pos = at(source, '(1, 2)')
    const help = session.signatureHelp(file, pos.line, pos.character + 1)
    expect(help?.label).toMatch(/fn add/)
    expect(help?.parameters).toEqual(['a: i32', 'b: i32'])
  })

  it('frames JSON-RPC messages for stdio', () => {
    const encoded = encodeLspMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    const parsed = tryReadLspMessage(encoded)
    expect(parsed?.message.method).toBe('initialize')
    const session = new LspSession()
    const reply = session.dispatch(parsed!.message)
    const result = Array.isArray(reply) ? undefined : reply?.result
    expect(result).toMatchObject({ capabilities: { hoverProvider: true, definitionProvider: true } })
    expect((result as { capabilities?: { renameProvider?: unknown; documentFormattingProvider?: boolean } } | undefined)?.capabilities?.renameProvider).toEqual({
      prepareProvider: true,
    })
    expect((result as { capabilities?: { documentFormattingProvider?: boolean } } | undefined)?.capabilities?.documentFormattingProvider).toBe(true)
  })

  it('publishes checker diagnostics on didOpen', () => {
    const session = new LspSession()
    const reply = session.dispatch({
      jsonrpc: '2.0',
      method: 'textDocument/didOpen',
      params: {
        textDocument: {
          uri: 'file:///tmp/bad.zee',
          text: 'fn main() {\n  const x: String = 1\n}\n',
        },
      },
    })
    expect(reply && !Array.isArray(reply) ? reply.method : undefined).toBe('textDocument/publishDiagnostics')
    const params = reply && !Array.isArray(reply) ? (reply.params as { diagnostics: unknown[] }) : undefined
    expect(params?.diagnostics.length).toBeGreaterThan(0)
  })

  it('serves initialize over framed stdio', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const chunks: Buffer[] = []
    output.on('data', (chunk: Buffer) => chunks.push(chunk))
    const serving = serveLsp(input, output)
    input.write(encodeLspMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }))
    input.end()
    await serving
    const parsed = tryReadLspMessage(Buffer.concat(chunks))
    expect(parsed?.message.id).toBe(1)
    expect(parsed?.message.result).toMatchObject({ capabilities: { hoverProvider: true } })
  })

  it('formats a messy document (ZEE-3)', () => {
    const session = new LspSession()
    session.open('/tmp/messy.zee', 'fn main(){println("hello, zee")}')
    const reply = session.dispatch({
      jsonrpc: '2.0',
      id: 2,
      method: 'textDocument/formatting',
      params: {
        textDocument: { uri: 'file:///tmp/messy.zee' },
        options: { tabSize: 2, insertSpaces: true },
      },
    })
    const result = Array.isArray(reply) ? undefined : reply?.result
    const edits = result as { newText: string }[] | undefined
    expect(edits?.[0]?.newText).toBe(`fn main() {
  println("hello, zee")
}
`)
  })

  it('renames a pub fn across the import (ZEE-3)', () => {
    const root = scratch()
    const http = join(root, 'src/http.zee')
    writeFileSync(http, 'pub fn get() -> String { "ok" }\n')
    const file = join(root, 'src/main.zee')
    const source = 'import http.get\nfn main() {\n  println(get())\n}\n'
    writeFileSync(file, source)
    const session = new LspSession()
    session.open(file, source)
    const pos = at(source, 'get', 1)
    const edits = session.rename(file, pos.line, pos.character, 'fetch')
    const files = new Map(edits.map((item) => [resolve(item.file), item.replacements]))
    expect(files.get(resolve(http))?.some((item) => item.text === 'fetch')).toBe(true)
    expect(files.get(resolve(file))?.filter((item) => item.text === 'fetch').length).toBeGreaterThanOrEqual(2)
  })
})
