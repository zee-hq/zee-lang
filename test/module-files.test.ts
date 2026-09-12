import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ZeeError } from '../src/error.ts'
import { createProject, listPackageSources } from '../src/project.ts'
import { checkPath, executePath, runPackageTests } from '../src/zee.ts'

const temps: string[] = []

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zee-mod-'))
  temps.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('same-package files (AC-root-module)', () => {
  it('lets src/main.zee call a function defined in src/greet.zee without import', () => {
    const created = createProject({ name: 'mod', parentDir: scratch(), mode: 'new' })
    writeFileSync(
      join(created.root, 'src/greet.zee'),
      'internal fn greet(name: String) -> String {\n  "hello, " + name\n}\n',
    )
    writeFileSync(
      join(created.root, 'src/main.zee'),
      'fn main() {\n  println(greet("zee"))\n}\n',
    )

    const result = executePath(created.entry)
    expect(result.stdout).toBe('hello, zee\n')
  })

  it('does not expose unmarked names from a nested module (src/http/*.zee)', () => {
    const created = createProject({ name: 'mod', parentDir: scratch(), mode: 'new' })
    mkdirSync(join(created.root, 'src/http'))
    writeFileSync(join(created.root, 'src/http/hidden.zee'), 'fn hidden() { println("no") }\n')
    writeFileSync(join(created.root, 'src/main.zee'), 'fn main() {\n  hidden()\n}\n')

    expect(() => executePath(created.entry)).toThrow(/undefined name `hidden`/)
  })

  it('rejects a file and folder with the same name under src/', () => {
    const created = createProject({ name: 'mod', parentDir: scratch(), mode: 'new' })
    writeFileSync(join(created.root, 'src/http.zee'), 'fn ping() {}\n')
    mkdirSync(join(created.root, 'src/http'))
    writeFileSync(join(created.root, 'src/http/client.zee'), 'fn client() {}\n')

    expect(() => executePath(created.entry)).toThrow(ZeeError)
    expect(() => executePath(created.entry)).toThrow(/file vs folder clash/)
  })

  it('type-checks the whole root module', () => {
    const created = createProject({ name: 'mod', parentDir: scratch(), mode: 'new' })
    writeFileSync(join(created.root, 'src/util.zee'), 'internal fn add(a: i32, b: i32) -> i32 { a + b }\n')
    writeFileSync(join(created.root, 'src/main.zee'), 'fn main() {\n  println(str(add(1, 2)))\n}\n')
    expect(() => checkPath(created.entry)).not.toThrow()
  })

  it('treats src/modules/users as module users, not modules.users', () => {
    const created = createProject({ name: 'mod', parentDir: scratch(), mode: 'new' })
    mkdirSync(join(created.root, 'src/modules/users'), { recursive: true })
    writeFileSync(
      join(created.root, 'src/modules/users/users.zee'),
      'pub fn ping() -> String { "ok" }\n',
    )
    writeFileSync(
      join(created.root, 'src/main.zee'),
      'import users\n\nfn main() {\n  println(users.ping())\n}\n',
    )
    expect(executePath(created.entry).stdout).toBe('ok\n')
  })

  it('rejects .zee files sitting directly in src/modules/', () => {
    const created = createProject({ name: 'mod', parentDir: scratch(), mode: 'new' })
    mkdirSync(join(created.root, 'src/modules'))
    writeFileSync(join(created.root, 'src/modules/orphan.zee'), 'fn ping() {}\n')
    expect(() => executePath(created.entry)).toThrow(/src\/modules/)
  })

  it('maps src/bootstrap + src/shared/config + src/modules/users as an HTTP app', () => {
    const created = createProject({ name: 'mod', parentDir: scratch(), mode: 'new' })
    mkdirSync(join(created.root, 'src/bootstrap'), { recursive: true })
    mkdirSync(join(created.root, 'src/shared/config'), { recursive: true })
    mkdirSync(join(created.root, 'src/modules/users'), { recursive: true })
    writeFileSync(
      join(created.root, 'src/shared/config/ping.zee'),
      'pub fn ping() -> String { "ok" }\n',
    )
    writeFileSync(
      join(created.root, 'src/modules/users/users.zee'),
      'pub fn name() -> String { "users" }\n',
    )
    const entry = join(created.root, 'src/bootstrap/main.zee')
    writeFileSync(
      entry,
      'import shared.config.ping\nimport users\n\nfn main() {\n  println(ping() + users.name())\n}\n',
    )
    expect(executePath(entry).stdout).toBe('okusers\n')
  })

  it('maps test/modules/users to module users, not test.users', () => {
    const created = createProject({ name: 'mod', parentDir: scratch(), mode: 'new' })
    mkdirSync(join(created.root, 'src/modules/users'), { recursive: true })
    mkdirSync(join(created.root, 'test/modules/users'), { recursive: true })
    writeFileSync(
      join(created.root, 'src/modules/users/users.zee'),
      'pub fn ping() -> String { "ok" }\n',
    )
    writeFileSync(
      join(created.root, 'test/modules/users/users.test.zee'),
      'fn testPing() {\n  expect(ping()).toBe("ok")\n}\n',
    )
    const testFile = listPackageSources(created.root).find((item) => item.file.endsWith('users.test.zee'))
    expect(testFile?.module).toBe('users')
    const result = runPackageTests(created.root)
    expect(result.failed).toBe(0)
    expect(result.reports.some((item) => item.name === 'testPing')).toBe(true)
  })

  it('rejects .zee files sitting directly in test/', () => {
    const created = createProject({ name: 'mod', parentDir: scratch(), mode: 'new' })
    mkdirSync(join(created.root, 'test'))
    writeFileSync(join(created.root, 'test/orphan.zee'), 'fn ping() {}\n')
    expect(() => executePath(created.entry)).toThrow(/`test\/`/)
  })
})
