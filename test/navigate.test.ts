import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findDefinition, formatGoto } from '../src/navigate.ts'

const temps: string[] = []

function scratchProject(): string {
  const dir = mkdtempSync(join(import.meta.dirname, 'goto-'))
  temps.push(dir)
  const root = join(dir, 'nav')
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'zee.toml'), '[package]\nname = "nav"\nversion = "0.1.0"\nentry = "src/main.zee"\n')
  return root
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function at(source: string, needle: string, occurrence = 1): { line: number; column: number } {
  let remaining = occurrence
  let line = 1
  let column = 1
  for (let i = 0; i < source.length; i += 1) {
    if (source.startsWith(needle, i)) {
      remaining -= 1
      if (remaining === 0) return { line, column }
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

describe('go to definition (AC-editor-navigate)', () => {
  it('jumps from a type use to the class declaration in the same file', () => {
    const file = '/tmp/user.zee'
    const source = `
      pub class User {
        const name: String
      }
      const u = User { name: "ana" }
    `
    const use = at(source, 'User', 2)
    const decl = at(source, 'User', 1)
    expect(findDefinition({ source, file, ...use })).toMatchObject({
      file,
      line: decl.line,
      column: decl.column,
      name: 'User',
      kind: 'type',
    })
  })

  it('jumps from an import path to the other module file', () => {
    const root = scratchProject()
    const http = join(root, 'src/http/client.zee')
    mkdirSync(join(root, 'src/http'), { recursive: true })
    writeFileSync(http, 'pub fn get() -> String { "ok" }\n')
    const main = join(root, 'src/main.zee')
    const source = 'import http\nfn main() {\n  println(http.get())\n}\n'
    writeFileSync(main, source)
    const hit = findDefinition({
      source,
      file: main,
      ...at(source, 'http', 1),
    })
    expect(hit).toMatchObject({ file: resolve(http), line: 1, column: 1, kind: 'module' })
  })

  it('jumps from import http.get to the imported function', () => {
    const root = scratchProject()
    const http = join(root, 'src/http/client.zee')
    mkdirSync(join(root, 'src/http'), { recursive: true })
    writeFileSync(http, 'pub fn get() -> String { "ok" }\n')
    const main = join(root, 'src/main.zee')
    const source = 'import http.get\nfn main() {\n  println(get())\n}\n'
    writeFileSync(main, source)
    const hit = findDefinition({
      source,
      file: main,
      ...at(source, 'get', 1),
    })
    expect(hit).toMatchObject({ file: resolve(http), name: 'get', kind: 'fn' })
  })

  it('formats a goto hit for the CLI', () => {
    expect(
      formatGoto({
        file: '/tmp/user.zee',
        line: 2,
        column: 11,
        name: 'User',
        kind: 'type',
      }),
    ).toBe('{"file":"/tmp/user.zee","line":2,"column":11,"name":"User","kind":"type"}')
  })
})
