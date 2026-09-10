import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createProject } from '../src/project.ts'
import { checkPath, executePath } from '../src/zee.ts'

const temps: string[] = []

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zee-vis-'))
  temps.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function project(): string {
  return createProject({ name: 'mod', parentDir: scratch(), mode: 'new' }).root
}

function write(root: string, rel: string, source: string): void {
  const full = join(root, rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, source)
}

describe('modules and visibility (AC-modules)', () => {
  it('lets the same directory see internal names without import', () => {
    const root = project()
    write(root, 'src/greet.zee', 'internal fn greet(name: String) -> String {\n  "hello, " + name\n}\n')
    write(root, 'src/main.zee', 'fn main() {\n  println(greet("zee"))\n}\n')
    expect(executePath(join(root, 'src/main.zee')).stdout).toBe('hello, zee\n')
  })

  it('hides unmarked names from a sibling file', () => {
    const root = project()
    write(root, 'src/hidden.zee', 'fn secret() -> i32 { 1 }\n')
    write(root, 'src/main.zee', 'fn main() {\n  println(str(secret()))\n}\n')
    expect(() => executePath(join(root, 'src/main.zee'))).toThrow(/undefined name `secret`/)
  })

  it('imports a pub name from another directory', () => {
    const root = project()
    write(root, 'src/http/client.zee', 'pub fn get() -> String { "ok" }\n')
    write(
      root,
      'src/main.zee',
      'import http.get\nfn main() {\n  println(get())\n}\n',
    )
    expect(executePath(join(root, 'src/main.zee')).stdout).toBe('ok\n')
  })

  it('binds a module with import http and calls http.fn()', () => {
    const root = project()
    write(root, 'src/http/client.zee', 'pub fn get() -> String { "ok" }\n')
    write(
      root,
      'src/main.zee',
      'import http\nfn main() {\n  println(http.get())\n}\n',
    )
    expect(executePath(join(root, 'src/main.zee')).stdout).toBe('ok\n')
  })

  it('imports several names and rename with as', () => {
    const root = project()
    write(
      root,
      'src/http/api.zee',
      'pub fn ping() -> i32 { 1 }\npub fn pong() -> i32 { 2 }\n',
    )
    write(
      root,
      'src/main.zee',
      `import http.{ping, pong as pongAlias}
fn main() {
  println(str(ping() + pongAlias()))
}
`,
    )
    expect(executePath(join(root, 'src/main.zee')).stdout).toBe('3\n')
  })

  it('imports a pub struct and rejects a private field', () => {
    const root = project()
    write(
      root,
      'src/http/client.zee',
      `pub struct Client {
  pub const host: String
  var secret: i32
}
pub fn make() -> Client {
  Client { host: "h", secret: 1 }
}
`,
    )
    write(
      root,
      'src/main.zee',
      `import http
fn main() {
  const c = http.make()
  println(c.host)
}
`,
    )
    expect(executePath(join(root, 'src/main.zee')).stdout).toBe('h\n')
    write(
      root,
      'src/main.zee',
      `import http
fn main() {
  const c = http.make()
  println(str(c.secret))
}
`,
    )
    expect(() => executePath(join(root, 'src/main.zee'))).toThrow(/private|undefined|field/)
  })

  it('does not make fields public just because the struct is pub', () => {
    const root = project()
    write(
      root,
      'src/http/client.zee',
      `pub struct Client {
  const host: String
}
pub fn make() -> Client {
  Client { host: "h" }
}
`,
    )
    write(
      root,
      'src/main.zee',
      `import http.Client
import http.make
fn main() {
  const c = make()
  println(c.host)
}
`,
    )
    expect(() => executePath(join(root, 'src/main.zee'))).toThrow(/private|undefined|field/)
  })

  it('rejects an import cycle', () => {
    const root = project()
    write(root, 'src/a/a.zee', 'import b\n')
    write(root, 'src/b/b.zee', 'import a\n')
    write(root, 'src/main.zee', 'import a\nfn main() {}\n')
    expect(() => checkPath(join(root, 'src/main.zee'))).toThrow(/cycle/)
  })

  it('rejects a file and folder with the same name', () => {
    const root = project()
    write(root, 'src/http.zee', 'pub fn ping() {}\n')
    write(root, 'src/http/client.zee', 'pub fn client() {}\n')
    expect(() => executePath(join(root, 'src/main.zee'))).toThrow(/file vs folder clash/)
  })

  it('rejects importing an internal name from another module', () => {
    const root = project()
    write(root, 'src/http/client.zee', 'internal fn get() -> String { "ok" }\n')
    write(root, 'src/main.zee', 'import http.get\nfn main() {\n  get()\n}\n')
    expect(() => executePath(join(root, 'src/main.zee'))).toThrow(/internal|not exported|undefined/)
  })
})
