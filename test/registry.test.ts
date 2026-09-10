import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getPackages } from '../src/pkg.ts'
import { createProject } from '../src/project.ts'
import { publishPackage } from '../src/registry.ts'
import { executePath } from '../src/zee.ts'

const temps: string[] = []

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zee-reg-'))
  temps.push(dir)
  return dir
}

afterEach(() => {
  delete process.env.ZEE_REGISTRY
  delete process.env.ZEE_REGISTRY_TOKEN
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

describe('zee publish + SemVer get (AC-ZEE-5)', () => {
  it('publishes a package then resolves json = "1.2" from the registry', () => {
    const parent = scratch()
    const registry = join(parent, 'registry')
    process.env.ZEE_REGISTRY = registry

    const lib = createProject({ name: 'json', parentDir: parent, mode: 'new' })
    write(lib.root, 'zee.toml', `[package]\nname = "json"\nversion = "1.2.1"\nentry = "src/main.zee"\n`)
    write(lib.root, 'src/lib.zee', 'pub fn ping() -> String { "pong" }\n')
    publishPackage(lib.root)

    const app = createProject({ name: 'app', parentDir: parent, mode: 'new' })
    write(
      app.root,
      'zee.toml',
      `[package]\nname = "app"\nversion = "0.1.0"\nentry = "src/main.zee"\n\n[deps]\njson = "1.2"\n`,
    )
    write(app.root, 'src/main.zee', 'import json.ping\nfn main() {\n  println(ping())\n}\n')

    const got = getPackages(app.root)
    expect(got.packages[0]?.name).toBe('json')
    expect(got.packages[0]?.version).toBe('1.2.1')
    expect(got.packages[0]?.source).toBe('registry')
    expect(existsSync(join(app.root, '.zee/json/src/lib.zee'))).toBe(true)
    expect(executePath(join(app.root, 'src/main.zee')).stdout).toBe('pong\n')
  })

  it('refuses to overwrite a published version', () => {
    const parent = scratch()
    process.env.ZEE_REGISTRY = join(parent, 'registry')
    const lib = createProject({ name: 'json', parentDir: parent, mode: 'new' })
    write(lib.root, 'zee.toml', `[package]\nname = "json"\nversion = "1.0.0"\nentry = "src/main.zee"\n`)
    publishPackage(lib.root)
    expect(() => publishPackage(lib.root)).toThrow(/already published/)
  })

  it('refuses publish when version is missing', () => {
    const parent = scratch()
    process.env.ZEE_REGISTRY = join(parent, 'registry')
    const lib = createProject({ name: 'json', parentDir: parent, mode: 'new' })
    write(lib.root, 'zee.toml', `[package]\nname = "json"\nentry = "src/main.zee"\n`)
    expect(() => publishPackage(lib.root)).toThrow(/version/)
  })

  it('uses [registry] url in zee.toml as a private registry', () => {
    const parent = scratch()
    const registry = join(parent, 'private-reg')
    const lib = createProject({ name: 'json', parentDir: parent, mode: 'new' })
    write(lib.root, 'zee.toml', `[package]\nname = "json"\nversion = "1.0.0"\nentry = "src/main.zee"\n`)
    write(lib.root, 'src/lib.zee', 'pub fn ping() -> String { "ok" }\n')
    process.env.ZEE_REGISTRY = registry
    publishPackage(lib.root)
    delete process.env.ZEE_REGISTRY

    const app = createProject({ name: 'app', parentDir: parent, mode: 'new' })
    write(
      app.root,
      'zee.toml',
      `[package]\nname = "app"\nversion = "0.1.0"\nentry = "src/main.zee"\n\n[registry]\nurl = "${registry}"\n\n[deps]\njson = "1.0.0"\n`,
    )
    write(app.root, 'src/main.zee', 'import json.ping\nfn main() {\n  println(ping())\n}\n')
    expect(getPackages(app.root).packages[0]?.version).toBe('1.0.0')
    expect(executePath(join(app.root, 'src/main.zee')).stdout).toBe('ok\n')
  })

  it('publishes to ~/.zee/registry when no url is set', () => {
    const parent = scratch()
    process.env.ZEE_HOME = parent
    const lib = createProject({ name: 'json', parentDir: parent, mode: 'new' })
    write(lib.root, 'zee.toml', `[package]\nname = "json"\nversion = "1.0.0"\nentry = "src/main.zee"\n`)
    const published = publishPackage(lib.root)
    expect(published.dest).toBe(join(parent, '.zee/registry/packages/json/1.0.0'))
    expect(existsSync(join(published.dest, 'zee.toml'))).toBe(true)
  })

  it('requires a token to publish over http', () => {
    const parent = scratch()
    const lib = createProject({ name: 'json', parentDir: parent, mode: 'new' })
    write(lib.root, 'zee.toml', `[package]\nname = "json"\nversion = "1.0.0"\nentry = "src/main.zee"\n`)
    process.env.ZEE_REGISTRY = 'https://registry.example.test'
    expect(() => publishPackage(lib.root)).toThrow(/TOKEN/)
  })
})
