import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from '../src/parser.ts'
import { createProject } from '../src/project.ts'
import { execute, executePath } from '../src/zee.ts'

const temps: string[] = []

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zee-iface-'))
  temps.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('interface and implements (AC-interface)', () => {
  it('parses interface, implements after the name, and UFCS methods', () => {
    const program = parse(`
      interface Closeable {
        fn close(var self)
      }
      struct File implements Closeable {
        const path: String
      }
      fn close(var self: File) { }
    `)
    expect(program.stmts.map((stmt) => stmt.kind)).toEqual(['interfaceDecl', 'structDecl', 'fn'])
    const iface = program.stmts[0]
    expect(iface?.kind).toBe('interfaceDecl')
    if (iface?.kind !== 'interfaceDecl') return
    expect(iface.name).toBe('Closeable')
    expect(iface.sealed).toBe(false)
    expect(iface.methods).toHaveLength(1)
    expect(iface.methods[0]?.name).toBe('close')
    expect(iface.methods[0]?.mutating).toBe(true)

    const file = program.stmts[1]
    expect(file?.kind).toBe('structDecl')
    if (file?.kind !== 'structDecl') return
    expect(file.implements).toEqual(['Closeable'])
  })

  it('parses implements after the struct body and inline methods', () => {
    const program = parse(`
      interface Errorish {
        fn message(self) -> String
      }
      data struct Fail {
        const text: String
      } implements Errorish {
        fn message(self) -> String { self.text }
      }
    `)
    const decl = program.stmts[1]
    expect(decl?.kind).toBe('structDecl')
    if (decl?.kind !== 'structDecl') return
    expect(decl.implements).toEqual(['Errorish'])
    expect(decl.methods).toHaveLength(1)
    expect(decl.methods[0]?.name).toBe('message')
  })

  it('calls an interface method on an existential value', () => {
    expect(
      execute(`
        interface Closeable {
          fn close(var self)
        }
        class File implements Closeable {
          var closed: bool
          const path: String
        }
        fn close(var self: File) {
          self.closed = true
        }
        fn shut(var x: Closeable) {
          x.close()
        }
        var f = File { closed: false, path: "a.txt" }
        shut(f)
        f.closed
      `).value,
    ).toEqual({ type: 'bool', value: true })
  })

  it('rejects a coincidental method that does not implement', () => {
    expect(() =>
      execute(`
        interface Closeable {
          fn close(var self)
        }
        struct File {
          const path: String
        }
        fn close(var self: File) { }
        fn shut(x: Closeable) { }
        shut(File { path: "a.txt" })
      `),
    ).toThrow(/does not implement|expected Closeable/)
  })

  it('rejects implements when a required method is missing', () => {
    expect(() =>
      execute(`
        interface Closeable {
          fn close(var self)
        }
        struct File implements Closeable {
          const path: String
        }
      `),
    ).toThrow(/does not implement|missing method/)
  })

  it('rejects fields and default bodies on an interface', () => {
    expect(() =>
      execute(`
        interface Closeable {
          const path: String
        }
      `),
    ).toThrow(/methods only|field/)
    expect(() =>
      execute(`
        interface Closeable {
          fn close(var self) { }
        }
      `),
    ).toThrow(/default/)
  })

  it('matches a sealed interface exhaustively', () => {
    expect(
      execute(`
        sealed interface Event { }
        data struct Click { const x: i32 } implements Event
        data struct Key { const code: i32 } implements Event
        fn label(e: Event) -> String {
          match e {
            Click { x } => "click"
            Key { code } => "key"
          }
        }
        label(Click { x: 3 })
      `).value,
    ).toEqual({ type: 'string', value: 'click' })
  })

  it('rejects a non-exhaustive match on a sealed interface', () => {
    expect(() =>
      execute(`
        sealed interface Event { }
        data struct Click { const x: i32 } implements Event
        data struct Key { const code: i32 } implements Event
        fn label(e: Event) -> String {
          match e {
            Click { x } => "click"
          }
        }
        label(Click { x: 1 })
      `),
    ).toThrow(/exhaustive/)
  })

  it('rejects implementing a sealed interface from another module', () => {
    const root = createProject({ name: 'events', parentDir: scratch(), mode: 'new' }).root
    mkdirSync(join(root, 'src/ev'), { recursive: true })
    writeFileSync(join(root, 'src/ev/ev.zee'), 'pub sealed interface Event { }\n')
    writeFileSync(
      join(root, 'src/main.zee'),
      `
        import ev.Event
        data struct Click { const x: i32 } implements Event
        fn main() { }
      `,
    )
    expect(() => executePath(join(root, 'src/main.zee'))).toThrow(/sealed|this module/)
  })

  it('narrows with `is` in an if', () => {
    expect(
      execute(`
        interface Closeable {
          fn close(var self)
        }
        struct File implements Closeable {
          const path: String
        }
        fn close(var self: File) { }
        fn nameOf(x: Closeable) -> String {
          if x is File {
            x.path
          } else {
            "other"
          }
        }
        nameOf(File { path: "a.txt" })
      `).value,
    ).toEqual({ type: 'string', value: 'a.txt' })
  })
})
