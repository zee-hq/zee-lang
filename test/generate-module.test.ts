import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ZeeError } from '../src/error.ts'
import {
  controllerKindFromFlags,
  generateController,
  generateModule,
  generateResource,
  generateService,
} from '../src/generate.ts'
import { createProject } from '../src/project.ts'
import { checkSource } from '../src/zee.ts'

const temps: string[] = []

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zee-'))
  temps.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function project(): string {
  return createProject({ name: 'app', parentDir: scratch(), mode: 'new' }).root
}

function assertChecks(file: string): void {
  expect(() => checkSource(readFileSync(file, 'utf8'), file)).not.toThrow()
}

describe('zee generate module (AC-generate-module)', () => {
  it('scaffolds src/<name>/<name>.module.zee like Nest', () => {
    const root = project()
    const created = generateModule({ cwd: root, path: 'http' })

    expect(created.dir).toBe(join(root, 'src/http'))
    expect(created.file).toBe(join(root, 'src/http/http.module.zee'))
    expect(created.importPath).toBe('http')
    expect(readFileSync(created.file, 'utf8')).toContain('module http')
    assertChecks(created.file)
  })

  it('pluralizes a resource name: user → users', () => {
    const root = project()
    const created = generateModule({ cwd: root, path: 'user' })
    expect(created.dir).toBe(join(root, 'src/users'))
    expect(created.file).toBe(join(root, 'src/users/users.module.zee'))
    expect(created.importPath).toBe('users')
  })

  it('nests folders for a path and names the file after the last segment', () => {
    const root = project()
    const created = generateModule({ cwd: root, path: 'http/tls' })

    expect(created.dir).toBe(join(root, 'src/http/tls'))
    expect(created.file).toBe(join(root, 'src/http/tls/tls.module.zee'))
    expect(created.importPath).toBe('http.tls')
    expect(existsSync(join(root, 'src/http/tls/tls.module.zee'))).toBe(true)
  })

  it('pluralizes only the last nested segment', () => {
    const root = project()
    const created = generateModule({ cwd: root, path: 'admin/user' })
    expect(created.dir).toBe(join(root, 'src/admin/users'))
    expect(created.file).toBe(join(root, 'src/admin/users/users.module.zee'))
    expect(created.importPath).toBe('admin.users')
  })

  it('finds zee.toml walking up from cwd', () => {
    const root = project()
    const created = generateModule({ cwd: join(root, 'src'), path: 'math' })
    expect(created.file).toBe(join(root, 'src/math/math.module.zee'))
  })

  it('refuses to run outside a Zee project', () => {
    expect(() => generateModule({ cwd: scratch(), path: 'http' })).toThrow(ZeeError)
    expect(() => generateModule({ cwd: scratch(), path: 'http' })).toThrow(/not a Zee project/)
  })

  it('refuses an invalid module path', () => {
    const root = project()
    expect(() => generateModule({ cwd: root, path: 'Http' })).toThrow(/invalid module name/)
    expect(() => generateModule({ cwd: root, path: 'src/http' })).toThrow(/relative to src/)
    expect(() => generateModule({ cwd: root, path: '../http' })).toThrow(/invalid module name/)
    expect(() => generateModule({ cwd: root, path: 'user-profile' })).toThrow(/invalid module name/)
  })

  it('refuses a file/folder clash with src/<name>.zee', () => {
    const root = project()
    writeFileSync(join(root, 'src/http.zee'), 'fn hello() {}\n')
    expect(() => generateModule({ cwd: root, path: 'http' })).toThrow(/file vs folder/)
  })

  it('refuses to overwrite an existing module file', () => {
    const root = project()
    generateModule({ cwd: root, path: 'http' })
    expect(() => generateModule({ cwd: root, path: 'http' })).toThrow(/already exists/)
  })

  it('allows generating into an existing directory that has no .module.zee', () => {
    const root = project()
    mkdirSync(join(root, 'src/http'))
    writeFileSync(join(root, 'src/http/client.zee'), 'fn connect() {}\n')
    const created = generateModule({ cwd: root, path: 'http' })
    expect(created.file).toBe(join(root, 'src/http/http.module.zee'))
    expect(existsSync(join(root, 'src/http/client.zee'))).toBe(true)
  })
})

describe('zee generate controller (AC-generate-controller)', () => {
  it('writes Nest-style users.controller.zee from `user`', () => {
    const root = project()
    const created = generateController({ cwd: root, path: 'user' })
    expect(created.file).toBe(join(root, 'src/users/users.controller.zee'))
    expect(readFileSync(created.file, 'utf8')).toContain('users.controller')
    assertChecks(created.file)
  })

  it('scaffolds Laravel --api resource methods', () => {
    const root = project()
    const created = generateController({ cwd: root, path: 'user', kind: 'api' })
    const source = readFileSync(created.file, 'utf8')
    expect(source).toContain('fn index()')
    expect(source).toContain('fn store()')
    expect(source).toContain('fn show(id: i32)')
    expect(source).toContain('fn update(id: i32)')
    expect(source).toContain('fn destroy(id: i32)')
    expect(source).not.toContain('fn create()')
    expect(source).not.toContain('fn edit()')
    assertChecks(created.file)
  })

  it('scaffolds Laravel -i / --invokable as invoke()', () => {
    const root = project()
    const created = generateController({ cwd: root, path: 'user', kind: 'invokable' })
    const source = readFileSync(created.file, 'utf8')
    expect(source).toContain('fn invoke()')
    expect(source).not.toContain('fn index()')
    assertChecks(created.file)
  })

  it('refuses --api together with --invokable', () => {
    expect(() => controllerKindFromFlags({ api: true, invokable: true })).toThrow(
      /--api.*invokable|invokable.*--api/,
    )
  })

  it('refuses to overwrite an existing controller', () => {
    const root = project()
    generateController({ cwd: root, path: 'user' })
    expect(() => generateController({ cwd: root, path: 'user' })).toThrow(/already exists/)
  })
})

describe('zee generate service (AC-generate-service)', () => {
  it('writes Nest-style users.service.zee', () => {
    const root = project()
    const created = generateService({ cwd: root, path: 'user' })
    expect(created.file).toBe(join(root, 'src/users/users.service.zee'))
    expect(readFileSync(created.file, 'utf8')).toContain('users.service')
    assertChecks(created.file)
  })
})

describe('zee generate resource (AC-generate-resource)', () => {
  it('creates the Nest trio: module + controller + service', () => {
    const root = project()
    const created = generateResource({ cwd: root, path: 'user', kind: 'api' })
    expect(created.module.file).toBe(join(root, 'src/users/users.module.zee'))
    expect(created.controller.file).toBe(join(root, 'src/users/users.controller.zee'))
    expect(created.service.file).toBe(join(root, 'src/users/users.service.zee'))
    expect(readFileSync(created.controller.file, 'utf8')).toContain('fn index()')
    assertChecks(created.module.file)
    assertChecks(created.controller.file)
    assertChecks(created.service.file)
  })
})
