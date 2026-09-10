import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getPackages, parseLockfile, updatePackages } from '../src/pkg.ts'
import { createProject } from '../src/project.ts'
import { publishPackage } from '../src/registry.ts'

const temps: string[] = []

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zee-upd-'))
  temps.push(dir)
  return dir
}

afterEach(() => {
  delete process.env.ZEE_REGISTRY
  delete process.env.ZEE_HOME
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function write(root: string, rel: string, source: string): void {
  const full = join(root, rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, source)
}

function gitInit(lib: string): void {
  execFileSync('git', ['init', '-b', 'main'], { cwd: lib, stdio: 'pipe' })
  execFileSync('git', ['config', 'user.email', 'zee@example.com'], { cwd: lib, stdio: 'pipe' })
  execFileSync('git', ['config', 'user.name', 'Zee'], { cwd: lib, stdio: 'pipe' })
}

function gitCommitTag(lib: string, name: string, version: string, ping: string): void {
  write(lib, 'zee.toml', `[package]\nname = "${name}"\nversion = "${version}"\nentry = "src/main.zee"\n`)
  write(lib, 'src/lib.zee', `pub fn ping() -> String { "${ping}" }\n`)
  execFileSync('git', ['add', '.'], { cwd: lib, stdio: 'pipe' })
  execFileSync('git', ['commit', '-m', version], { cwd: lib, stdio: 'pipe' })
  execFileSync('git', ['tag', version], { cwd: lib, stdio: 'pipe' })
}

function locked(appRoot: string, name: string) {
  return parseLockfile(readFileSync(join(appRoot, 'zee.lock'), 'utf8')).packages.find((pkg) => pkg.name === name)
}

describe('zee get honors zee.lock (AC-ZEE-update)', () => {
  it('keeps a registry pin when a newer matching version is published', () => {
    const parent = scratch()
    process.env.ZEE_REGISTRY = join(parent, 'registry')

    const lib = createProject({ name: 'json', parentDir: parent, mode: 'new' })
    write(lib.root, 'zee.toml', `[package]\nname = "json"\nversion = "1.0.0"\nentry = "src/main.zee"\n`)
    write(lib.root, 'src/lib.zee', 'pub fn ping() -> String { "a" }\n')
    publishPackage(lib.root)

    const app = createProject({ name: 'app', parentDir: parent, mode: 'new' })
    write(
      app.root,
      'zee.toml',
      `[package]\nname = "app"\nversion = "0.1.0"\nentry = "src/main.zee"\n\n[deps]\njson = "1.0"\n`,
    )

    expect(getPackages(app.root).packages[0]?.version).toBe('1.0.0')

    write(lib.root, 'zee.toml', `[package]\nname = "json"\nversion = "1.0.1"\nentry = "src/main.zee"\n`)
    write(lib.root, 'src/lib.zee', 'pub fn ping() -> String { "b" }\n')
    publishPackage(lib.root)

    expect(getPackages(app.root).packages[0]?.version).toBe('1.0.0')
  })
})

describe('zee update (AC-ZEE-update)', () => {
  it('re-resolves a floating registry constraint and rewrites the lock', () => {
    const parent = scratch()
    process.env.ZEE_REGISTRY = join(parent, 'registry')

    const lib = createProject({ name: 'json', parentDir: parent, mode: 'new' })
    write(lib.root, 'zee.toml', `[package]\nname = "json"\nversion = "1.0.0"\nentry = "src/main.zee"\n`)
    write(lib.root, 'src/lib.zee', 'pub fn ping() -> String { "a" }\n')
    publishPackage(lib.root)

    const app = createProject({ name: 'app', parentDir: parent, mode: 'new' })
    write(
      app.root,
      'zee.toml',
      `[package]\nname = "app"\nversion = "0.1.0"\nentry = "src/main.zee"\n\n[deps]\njson = "1.0"\n`,
    )
    getPackages(app.root)

    write(lib.root, 'zee.toml', `[package]\nname = "json"\nversion = "1.0.1"\nentry = "src/main.zee"\n`)
    write(lib.root, 'src/lib.zee', 'pub fn ping() -> String { "b" }\n')
    publishPackage(lib.root)

    const updated = updatePackages(app.root)
    expect(updated.packages[0]?.version).toBe('1.0.1')
    expect(locked(app.root, 'json')?.version).toBe('1.0.1')
    expect(updated.changes).toEqual([{ name: 'json', from: '1.0.0', to: '1.0.1' }])
  })

  it('does not bump an exact SemVer pin', () => {
    const parent = scratch()
    process.env.ZEE_REGISTRY = join(parent, 'registry')

    const lib = createProject({ name: 'json', parentDir: parent, mode: 'new' })
    write(lib.root, 'zee.toml', `[package]\nname = "json"\nversion = "1.0.0"\nentry = "src/main.zee"\n`)
    write(lib.root, 'src/lib.zee', 'pub fn ping() -> String { "a" }\n')
    publishPackage(lib.root)

    const app = createProject({ name: 'app', parentDir: parent, mode: 'new' })
    write(
      app.root,
      'zee.toml',
      `[package]\nname = "app"\nversion = "0.1.0"\nentry = "src/main.zee"\n\n[deps]\njson = "1.0.0"\n`,
    )
    getPackages(app.root)

    write(lib.root, 'zee.toml', `[package]\nname = "json"\nversion = "1.0.1"\nentry = "src/main.zee"\n`)
    publishPackage(lib.root)

    const updated = updatePackages(app.root)
    expect(updated.packages[0]?.version).toBe('1.0.0')
    expect(updated.changes).toEqual([])
  })

  it('picks the latest matching git tag for a floating catalog version', () => {
    const parent = scratch()
    const lib = createProject({ name: 'json', parentDir: parent, mode: 'new' })
    gitInit(lib.root)
    gitCommitTag(lib.root, 'json', '1.0.0', 'a')

    write(
      parent,
      'libs.toml',
      `[versions]\njson = "1.0"\n\n[libraries]\njson = { git = "${lib.root}", version.ref = "json" }\n`,
    )
    const app = createProject({ name: 'app', parentDir: parent, mode: 'new' })
    getPackages(app.root, ['json'])
    expect(locked(app.root, 'json')?.tag).toBe('1.0.0')

    gitCommitTag(lib.root, 'json', '1.0.1', 'b')
    expect(getPackages(app.root).packages[0]?.tag).toBe('1.0.0')

    const updated = updatePackages(app.root)
    expect(updated.packages[0]?.tag).toBe('1.0.1')
    expect(updated.packages[0]?.version).toBe('1.0.1')
    expect(updated.changes).toEqual([{ name: 'json', from: '1.0.0', to: '1.0.1' }])
  })

  it('updates only the named packages', () => {
    const parent = scratch()
    const json = createProject({ name: 'json', parentDir: parent, mode: 'new' })
    gitInit(json.root)
    gitCommitTag(json.root, 'json', '1.0.0', 'json-a')
    const env = createProject({ name: 'env', parentDir: parent, mode: 'new' })
    gitInit(env.root)
    gitCommitTag(env.root, 'env', '1.0.0', 'env-a')

    write(
      parent,
      'libs.toml',
      `[versions]\njson = "1.0"\nenv = "1.0"\n\n[libraries]\njson = { git = "${json.root}", version.ref = "json" }\nenv = { git = "${env.root}", version.ref = "env" }\n`,
    )
    const app = createProject({ name: 'app', parentDir: parent, mode: 'new' })
    getPackages(app.root, ['json', 'env'])

    gitCommitTag(json.root, 'json', '1.0.1', 'json-b')
    gitCommitTag(env.root, 'env', '1.0.1', 'env-b')

    const updated = updatePackages(app.root, ['env'])
    expect(locked(app.root, 'env')?.version).toBe('1.0.1')
    expect(locked(app.root, 'json')?.version).toBe('1.0.0')
    expect(updated.changes).toEqual([{ name: 'env', from: '1.0.0', to: '1.0.1' }])
  })

  it('refuses an unknown update name', () => {
    const parent = scratch()
    const app = createProject({ name: 'app', parentDir: parent, mode: 'new' })
    expect(() => updatePackages(app.root, ['nope'])).toThrow(/unknown dep/)
  })
})
