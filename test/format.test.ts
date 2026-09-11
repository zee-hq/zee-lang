import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { formatZee } from '../src/format.ts'

describe('zee fmt (ZEE-3)', () => {
  it('indents with two spaces and spaces around braces', () => {
    const messy = 'fn main(){println("hello, zee")}'
    expect(formatZee(messy)).toBe(`fn main() {
  println("hello, zee")
}
`)
  })

  it('formats if/else like the DIRECTION examples', () => {
    const messy =
      'fn factorial(n:i32)->i32{if n<=1{1}else{n*factorial(n-1)}}fn main(){println(str(factorial(5)))}'
    expect(formatZee(messy)).toBe(readFileSync(join(import.meta.dirname, '../examples/factorial.zee'), 'utf8'))
  })

  it('keeps /// docs on the next item', () => {
    const source = '/// Adds one.\npub fn inc(n: i32) -> i32 { n + 1 }\n'
    expect(formatZee(source)).toBe(`/// Adds one.
pub fn inc(n: i32) -> i32 {
  n + 1
}
`)
  })

  it('is a no-op on already formatted hello.zee', () => {
    const source = readFileSync(join(import.meta.dirname, '../examples/hello.zee'), 'utf8')
    expect(formatZee(source, 'examples/hello.zee')).toBe(source)
  })

  it('rewrites a file through zee fmt', () => {
    const dir = mkdtempSync(join(import.meta.dirname, 'fmt-'))
    const file = join(dir, 'main.zee')
    try {
      writeFileSync(file, 'fn main(){println("hello, zee")}')
      const tsx = join(import.meta.dirname, '../node_modules/tsx/dist/cli.mjs')
      execFileSync(process.execPath, [tsx, join(import.meta.dirname, '../src/cli.ts'), 'fmt', file], {
        encoding: 'utf8',
      })
      expect(readFileSync(file, 'utf8')).toBe(`fn main() {
  println("hello, zee")
}
`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
