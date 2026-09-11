import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { renameSymbol } from '../src/navigate.ts'

const temps: string[] = []

function scratch(): string {
  const dir = mkdtempSync(join(import.meta.dirname, 'rename-'))
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

describe('rename (ZEE-3)', () => {
  it('renames a pub fn and updates call sites plus import', () => {
    const root = scratch()
    const http = join(root, 'src/http.zee')
    const main = join(root, 'src/main.zee')
    writeFileSync(http, 'pub fn get() -> String { "ok" }\n')
    const source = 'import http.get\nfn main() {\n  println(get())\n}\n'
    writeFileSync(main, source)
    const edits = renameSymbol({ source, file: main, line: 1, column: 13, newName: 'fetch' })
    const byFile = new Map(edits.map((item) => [resolve(item.file), item.replacements]))
    expect(byFile.get(resolve(http))?.some((item) => item.text === 'fetch')).toBe(true)
    expect(byFile.get(resolve(main))?.filter((item) => item.text === 'fetch').length).toBeGreaterThanOrEqual(2)
  })
})
