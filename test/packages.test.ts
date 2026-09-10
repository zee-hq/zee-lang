import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getPackages, parseLockfile } from '../src/pkg.ts'
import { createProject, parseManifest } from '../src/project.ts'
import { checkPath, executePath } from '../src/zee.ts'

const temps: string[] = []

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zee-pkg-'))
  temps.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function write(root: string, rel: string, source: string): void {
  const full = join(root, rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, source)
}

function addPathDep(appRoot: string, name: string, relPath: string): void {
  const file = join(appRoot, 'zee.toml')
  const current = readFileSync(file, 'utf8')
  writeFileSync(file, `${current}\n[deps]\n${name} = { path = "${relPath}" }\n`)
}

function libWithPing(parent: string, name = 'json'): string {
  const created = createProject({ name, parentDir: parent, mode: 'new' })
  write(created.root, 'src/lib.zee', 'pub fn ping() -> String { "pong" }\n')
  return created.root
}

describe('zee.toml [deps] (AC-ZEE-4)', () => {
  it('parses path, git, and SemVer specs', () => {
    const manifest = parseManifest(`
[package]
name = "app"
version = "0.1.0"
entry = "src/main.zee"

[deps]
json = { path = "../json" }
http = { git = "https://example.com/http.git", tag = "1.2.0" }
cataloged = { lib = "json" }
future = "1.2"
`)
    expect(manifest.deps.get('json')).toEqual({ kind: 'path', path: '../json' })
    expect(manifest.deps.get('http')).toEqual({
      kind: 'git',
      git: 'https://example.com/http.git',
      tag: '1.2.0',
    })
    expect(manifest.deps.get('cataloged')).toEqual({ kind: 'lib', lib: 'json' })
    expect(manifest.deps.get('future')).toEqual({ kind: 'version', version: '1.2' })
  })

  it('refuses a SemVer dep because there is no registry yet', () => {
    const parent = scratch()
    const app = createProject({ name: 'app', parentDir: parent, mode: 'new' })
    write(app.root, 'zee.toml', `[package]\nname = "app"\nversion = "0.1.0"\nentry = "src/main.zee"\n\n[deps]\njson = "1.2"\n`)
    expect(() => getPackages(app.root)).toThrow(/registry/)
  })
})

describe('zee get path deps (AC-ZEE-4)', () => {
  it('writes a stable lockfile with content hash', () => {
    const parent = scratch()
    libWithPing(parent)
    const app = createProject({ name: 'app', parentDir: parent, mode: 'new' })
    addPathDep(app.root, 'json', '../json')

    const first = getPackages(app.root)
    expect(existsSync(join(app.root, 'zee.lock'))).toBe(true)
    const lockText = readFileSync(join(app.root, 'zee.lock'), 'utf8')
    const lock = parseLockfile(lockText)
    expect(lock.packages[0]?.name).toBe('json')
    expect(lock.packages[0]?.source).toBe('path')
    expect(lock.packages[0]?.path).toBe('.zee/json')
    expect(lock.packages[0]?.hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(first.packages[0]?.root).toBe(join(app.root, '.zee/json'))
    expect(existsSync(join(app.root, '.zee/json/zee.toml'))).toBe(true)

    const again = getPackages(app.root)
    expect(readFileSync(join(app.root, 'zee.lock'), 'utf8')).toBe(lockText)
    expect(again.packages[0]?.hash).toBe(lock.packages[0]?.hash)
  })

  it('imports and runs a pub fn from a path dependency', () => {
    const parent = scratch()
    libWithPing(parent)
    const app = createProject({ name: 'app', parentDir: parent, mode: 'new' })
    addPathDep(app.root, 'json', '../json')
    write(app.root, 'src/main.zee', 'import json.ping\nfn main() {\n  println(ping())\n}\n')
    getPackages(app.root)
    expect(executePath(join(app.root, 'src/main.zee')).stdout).toBe('pong\n')
  })

  it('binds import json to the package root module', () => {
    const parent = scratch()
    libWithPing(parent)
    const app = createProject({ name: 'app', parentDir: parent, mode: 'new' })
    addPathDep(app.root, 'json', '../json')
    write(app.root, 'src/main.zee', 'import json\nfn main() {\n  println(json.ping())\n}\n')
    getPackages(app.root)
    expect(executePath(join(app.root, 'src/main.zee')).stdout).toBe('pong\n')
  })

  it('fails when import is neither a local module nor a [deps] name', () => {
    const parent = scratch()
    const app = createProject({ name: 'app', parentDir: parent, mode: 'new' })
    write(app.root, 'src/main.zee', 'import json.ping\nfn main() {\n  ping()\n}\n')
    expect(() => checkPath(join(app.root, 'src/main.zee'))).toThrow(/unknown module|not in \[deps\]/)
  })

  it('does not export internal names from a dependency', () => {
    const parent = scratch()
    const lib = createProject({ name: 'json', parentDir: parent, mode: 'new' })
    write(lib.root, 'src/lib.zee', 'internal fn ping() -> String { "pong" }\n')
    const app = createProject({ name: 'app', parentDir: parent, mode: 'new' })
    addPathDep(app.root, 'json', '../json')
    write(app.root, 'src/main.zee', 'import json.ping\nfn main() {\n  ping()\n}\n')
    getPackages(app.root)
    expect(() => executePath(join(app.root, 'src/main.zee'))).toThrow(/internal|not exported/)
  })

  it('resolves transitive path deps and rejects a package cycle', () => {
    const parent = scratch()
    const util = createProject({ name: 'util', parentDir: parent, mode: 'new' })
    write(util.root, 'src/lib.zee', 'pub fn n() -> i32 { 1 }\n')
    const json = createProject({ name: 'json', parentDir: parent, mode: 'new' })
    addPathDep(json.root, 'util', '../util')
    write(json.root, 'src/lib.zee', 'import util.n\npub fn ping() -> i32 { n() }\n')
    const app = createProject({ name: 'app', parentDir: parent, mode: 'new' })
    addPathDep(app.root, 'json', '../json')
    write(app.root, 'src/main.zee', 'import json.ping\nfn main() {\n  println(str(ping()))\n}\n')
    getPackages(app.root)
    expect(executePath(join(app.root, 'src/main.zee')).stdout).toBe('1\n')

    addPathDep(util.root, 'json', '../json')
    expect(() => getPackages(app.root)).toThrow(/cycle/)
  })

  it('rejects two packages with the same name and different contents', () => {
    const parent = scratch()
    const jsonA = createProject({ name: 'json', parentDir: join(parent, 'a'), mode: 'new' })
    write(jsonA.root, 'src/lib.zee', 'pub fn ping() -> String { "a" }\n')
    const jsonB = createProject({ name: 'json', parentDir: join(parent, 'b'), mode: 'new' })
    write(jsonB.root, 'src/lib.zee', 'pub fn ping() -> String { "b" }\n')
    const left = createProject({ name: 'left', parentDir: parent, mode: 'new' })
    addPathDep(left.root, 'json', '../a/json')
    const app = createProject({ name: 'app', parentDir: parent, mode: 'new' })
    write(
      app.root,
      'zee.toml',
      `[package]\nname = "app"\nversion = "0.1.0"\nentry = "src/main.zee"\n\n[deps]\nleft = { path = "../left" }\njson = { path = "../b/json" }\n`,
    )
    expect(() => getPackages(app.root)).toThrow(/same name|incompatible/)
  })

  it('rejects a local module that collides with a dep name', () => {
    const parent = scratch()
    libWithPing(parent)
    const app = createProject({ name: 'app', parentDir: parent, mode: 'new' })
    addPathDep(app.root, 'json', '../json')
    write(app.root, 'src/json/mod.zee', 'pub fn local() {}\n')
    write(app.root, 'src/main.zee', 'fn main() {}\n')
    getPackages(app.root)
    expect(() => checkPath(join(app.root, 'src/main.zee'))).toThrow(/clash|collide/)
  })
})

describe('zee get git deps (AC-ZEE-4)', () => {
  it('clones a tagged git package and imports it', () => {
    const parent = scratch()
    const lib = libWithPing(parent)
    execFileSync('git', ['init', '-b', 'main'], { cwd: lib, stdio: 'pipe' })
    execFileSync('git', ['config', 'user.email', 'zee@example.com'], { cwd: lib, stdio: 'pipe' })
    execFileSync('git', ['config', 'user.name', 'Zee'], { cwd: lib, stdio: 'pipe' })
    execFileSync('git', ['add', '.'], { cwd: lib, stdio: 'pipe' })
    execFileSync('git', ['commit', '-m', 'init'], { cwd: lib, stdio: 'pipe' })
    execFileSync('git', ['tag', '1.0.0'], { cwd: lib, stdio: 'pipe' })

    const app = createProject({ name: 'app', parentDir: parent, mode: 'new' })
    write(
      app.root,
      'zee.toml',
      `[package]\nname = "app"\nversion = "0.1.0"\nentry = "src/main.zee"\n\n[deps]\njson = { git = "${lib}", tag = "1.0.0" }\n`,
    )
    write(app.root, 'src/main.zee', 'import json.ping\nfn main() {\n  println(ping())\n}\n')
    getPackages(app.root)
    expect(existsSync(join(app.root, '.zee/json'))).toBe(true)
    expect(executePath(join(app.root, 'src/main.zee')).stdout).toBe('pong\n')
  })
})

describe('libs.toml catalog (AC-ZEE-4)', () => {
  it('zee get json adds the alias and fetches from the workspace catalog', () => {
    const parent = scratch()
    libWithPing(parent)
    write(parent, 'libs.toml', `[libraries]\njson = { path = "json" }\n`)
    const app = createProject({ name: 'app', parentDir: parent, mode: 'new' })
    getPackages(app.root, ['json'])
    expect(readFileSync(join(app.root, 'zee.toml'), 'utf8')).toMatch(/json = \{ lib = "json" \}/)
    expect(existsSync(join(app.root, '.zee/json/src/lib.zee'))).toBe(true)
    write(app.root, 'src/main.zee', 'import json.ping\nfn main() {\n  println(ping())\n}\n')
    expect(executePath(join(app.root, 'src/main.zee')).stdout).toBe('pong\n')
  })

  it('resolves version.ref like Gradle', () => {
    const parent = scratch()
    const lib = libWithPing(parent)
    execFileSync('git', ['init', '-b', 'main'], { cwd: lib, stdio: 'pipe' })
    execFileSync('git', ['config', 'user.email', 'zee@example.com'], { cwd: lib, stdio: 'pipe' })
    execFileSync('git', ['config', 'user.name', 'Zee'], { cwd: lib, stdio: 'pipe' })
    execFileSync('git', ['add', '.'], { cwd: lib, stdio: 'pipe' })
    execFileSync('git', ['commit', '-m', 'init'], { cwd: lib, stdio: 'pipe' })
    execFileSync('git', ['tag', '1.0.0'], { cwd: lib, stdio: 'pipe' })
    write(
      parent,
      'libs.toml',
      `[versions]\njson = "1.0.0"\n\n[libraries]\njson = { git = "${lib}", version.ref = "json" }\n`,
    )
    const app = createProject({ name: 'app', parentDir: parent, mode: 'new' })
    getPackages(app.root, ['json'])
    write(app.root, 'src/main.zee', 'import json.ping\nfn main() {\n  println(ping())\n}\n')
    expect(executePath(join(app.root, 'src/main.zee')).stdout).toBe('pong\n')
  })

  it('refuses an unknown catalog alias', () => {
    const parent = scratch()
    write(parent, 'libs.toml', `[libraries]\njson = { path = "json" }\n`)
    const app = createProject({ name: 'app', parentDir: parent, mode: 'new' })
    expect(() => getPackages(app.root, ['nope'])).toThrow(/unknown library/)
  })
})
