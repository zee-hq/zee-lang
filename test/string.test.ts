import { describe, expect, it } from 'vitest'
import { PanicError, ZeeError } from '../src/error.ts'
import { execute, executeFile } from '../src/zee.ts'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const examples = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples')
const fence = '`'.repeat(3)

describe('String / Char (ZEE-8 / §0c)', () => {
  it('keeps `{` literal in double-quoted strings', () => {
    expect(execute('"hello, {name}"').value).toEqual({ type: 'string', value: 'hello, {name}' })
  })

  it('interpolates String, Char, bool, and integers in backticks', () => {
    expect(
      execute(`
        const name = "zee"
        const flag = true
        const n = 3
        const c: Char = 'z'
        \`hello, {name} {c} {flag} {n}\`
      `).value,
    ).toEqual({ type: 'string', value: 'hello, zee z true 3' })
  })

  it('interpolates expressions and concatenates around holes', () => {
    expect(execute('const a = 1\nconst b = 2\n`total {a + b}`').value).toEqual({
      type: 'string',
      value: 'total 3',
    })
  })

  it('rejects interpolating a class or struct', () => {
    expect(() =>
      execute(`
        class Box { pub const n: i32 }
        const box = Box { n: 1 }
        \`x {box}\`
      `),
    ).toThrow(/interpolat/)
  })

  it('parses Char as one Unicode scalar and rejects extra scalars', () => {
    expect(execute("'a'").value).toEqual({ type: 'char', value: 'a' })
    expect(execute("'é'").value).toEqual({ type: 'char', value: 'é' })
    expect(execute("'\\n'").value).toEqual({ type: 'char', value: '\n' })
    expect(() => execute("'ab'")).toThrow(ZeeError)
    expect(() => execute("''")).toThrow(ZeeError)
  })

  it('reports byte len and byte index, and forbids assigning through a String', () => {
    expect(
      execute(`
        const name: String = "é"
        (name.len, name[0])
      `).value,
    ).toEqual({
      type: 'tuple',
      items: [
        { type: 'usize', value: 2n },
        { type: 'u8', value: 0xc3 },
      ],
    })
    expect(() =>
      execute(`
        var name = "zee"
        name[0] = 1u8
      `),
    ).toThrow(/String index/)
  })

  it('reports isEmpty as byte-empty (ZEE-18)', () => {
    expect(execute('"".isEmpty()').value).toEqual({ type: 'bool', value: true })
    expect(execute('"zee".isNotEmpty()').value).toEqual({ type: 'bool', value: true })
  })

  it('iterates Unicode scalars with for-in, not bytes', () => {
    expect(
      execute(`
        var n = 0
        var last: Char = 'x'
        for c in "aé" {
          n = n + 1
          last = c
        }
        (n, last)
      `).value,
    ).toEqual({
      type: 'tuple',
      items: [
        { type: 'i32', value: 2 },
        { type: 'char', value: 'é' },
      ],
    })
  })

  it('strips the opening newline and closing indent from a raw block', () => {
    expect(
      execute(`const blob = ${fence}
line one
line two
${fence}
blob`).value,
    ).toEqual({ type: 'string', value: 'line one\nline two' })

    expect(
      execute(`const blob = ${fence}
    line one
    line two
    ${fence}
blob`).value,
    ).toEqual({ type: 'string', value: 'line one\nline two' })
  })

  it('ignores an optional raw-block label and does not interpolate', () => {
    expect(
      execute(`const blob = ${fence}sql
select {name}
${fence}
blob`).value,
    ).toEqual({ type: 'string', value: 'select {name}' })
  })

  it('decodes String.fromBytes and returns err on invalid UTF-8', () => {
    expect(
      execute(`
        const buf: u8[] = [72u8, 105u8]
        const (s, err) = String.fromBytes(buf)
        match err {
          None => s
          _ => panic("unexpected")
        }
      `).value,
    ).toEqual({ type: 'string', value: 'Hi' })

    expect(
      execute(`
        const buf: u8[] = [255u8]
        const (s, err) = String.fromBytes(buf)
        (s, (err ?: panic("missing")).message())
      `).value,
    ).toEqual({
      type: 'tuple',
      items: [
        { type: 'string', value: '' },
        { type: 'string', value: 'invalid UTF-8' },
      ],
    })
  })

  it('treats String and Char as Eq + Hash + Ord', () => {
    expect(execute("'a' == 'a'").value).toEqual({ type: 'bool', value: true })
    expect(execute("'a' < 'b'").value).toEqual({ type: 'bool', value: true })
    expect(execute("'a' <===> 'a'").value).toEqual({ type: 'i32', value: 0 })
    expect(
      execute(`
        const m: Map<Char, i32> = { 'a': 1 }
        m['a']
      `).value,
    ).toEqual({ type: 'option', tag: 'some', value: { type: 'i32', value: 1 } })
  })

  it('interpolates inside panic and aborts with Never', () => {
    expect(() => execute('const name = "zee"\npanic(`missing {name}`)')).toThrow(PanicError)
    expect(() => execute('const name = "zee"\npanic(`missing {name}`)')).toThrow(/missing zee/)
  })

  it('runs examples/strings.zee', () => {
    expect(executeFile(join(examples, 'strings.zee')).stdout).toBe('hello, zee\n')
  })
})
