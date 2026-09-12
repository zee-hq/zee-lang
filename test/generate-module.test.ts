import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ZeeError } from '../src/error.ts'
import {
  controllerKindFromFlags,
  generateAction,
  generateApi,
  generateController,
  generateFeature,
  generateModel,
  generateModule,
  generateRepository,
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
  it('scaffolds src/modules/<name>/<name>.module.zee', () => {
    const root = project()
    const created = generateModule({ cwd: root, path: 'http' })

    expect(created.dir).toBe(join(root, 'src/modules/http'))
    expect(created.file).toBe(join(root, 'src/modules/http/http.module.zee'))
    expect(created.importPath).toBe('http')
    expect(readFileSync(created.file, 'utf8')).toContain('module http')
    assertChecks(created.file)
  })

  it('pluralizes a resource name: user → users', () => {
    const root = project()
    const created = generateModule({ cwd: root, path: 'user' })
    expect(created.dir).toBe(join(root, 'src/modules/users'))
    expect(created.file).toBe(join(root, 'src/modules/users/users.module.zee'))
    expect(created.importPath).toBe('users')
  })

  it('nests folders for a path and names the file after the last segment', () => {
    const root = project()
    const created = generateModule({ cwd: root, path: 'http/tls' })

    expect(created.dir).toBe(join(root, 'src/modules/http/tls'))
    expect(created.file).toBe(join(root, 'src/modules/http/tls/tls.module.zee'))
    expect(created.importPath).toBe('http.tls')
    expect(existsSync(join(root, 'src/modules/http/tls/tls.module.zee'))).toBe(true)
  })

  it('pluralizes only the last nested segment', () => {
    const root = project()
    const created = generateModule({ cwd: root, path: 'admin/user' })
    expect(created.dir).toBe(join(root, 'src/modules/admin/users'))
    expect(created.file).toBe(join(root, 'src/modules/admin/users/users.module.zee'))
    expect(created.importPath).toBe('admin.users')
  })

  it('finds zee.toml walking up from cwd', () => {
    const root = project()
    const created = generateModule({ cwd: join(root, 'src'), path: 'math' })
    expect(created.file).toBe(join(root, 'src/modules/math/math.module.zee'))
  })

  it('refuses to run outside a Zee project', () => {
    expect(() => generateModule({ cwd: scratch(), path: 'http' })).toThrow(ZeeError)
    expect(() => generateModule({ cwd: scratch(), path: 'http' })).toThrow(/not a Zee project/)
  })

  it('refuses an invalid module path', () => {
    const root = project()
    expect(() => generateModule({ cwd: root, path: 'Http' })).toThrow(/invalid module name/)
    expect(() => generateModule({ cwd: root, path: 'src/http' })).toThrow(/relative to src/)
    expect(() => generateModule({ cwd: root, path: 'modules/users' })).toThrow(/relative to src\/modules/)
    expect(() => generateModule({ cwd: root, path: '../http' })).toThrow(/invalid module name/)
    expect(() => generateModule({ cwd: root, path: 'user-profile' })).toThrow(/invalid module name/)
  })

  it('refuses a file/folder clash with src/modules.zee', () => {
    const root = project()
    writeFileSync(join(root, 'src/modules.zee'), 'fn hello() {}\n')
    expect(() => generateModule({ cwd: root, path: 'http' })).toThrow(/file vs folder/)
  })

  it('refuses to overwrite an existing module file', () => {
    const root = project()
    generateModule({ cwd: root, path: 'http' })
    expect(() => generateModule({ cwd: root, path: 'http' })).toThrow(/already exists/)
  })

  it('allows generating into an existing directory that has no .module.zee', () => {
    const root = project()
    mkdirSync(join(root, 'src/modules/http'), { recursive: true })
    writeFileSync(join(root, 'src/modules/http/client.zee'), 'fn connect() {}\n')
    const created = generateModule({ cwd: root, path: 'http' })
    expect(created.file).toBe(join(root, 'src/modules/http/http.module.zee'))
    expect(existsSync(join(root, 'src/modules/http/client.zee'))).toBe(true)
  })

  it('writes bootstrap/shared/ui at src root, not under src/modules/', () => {
    const root = project()
    const bootstrap = generateModule({ cwd: root, path: 'bootstrap' })
    const shared = generateModule({ cwd: root, path: 'shared' })
    const ui = generateModule({ cwd: root, path: 'ui' })
    expect(bootstrap.file).toBe(join(root, 'src/bootstrap/bootstrap.module.zee'))
    expect(shared.file).toBe(join(root, 'src/shared/shared.module.zee'))
    expect(ui.file).toBe(join(root, 'src/ui/ui.module.zee'))
    expect(existsSync(join(root, 'src/modules/bootstrap'))).toBe(false)
    expect(existsSync(join(root, 'src/modules/shared'))).toBe(false)
    expect(existsSync(join(root, 'src/modules/ui'))).toBe(false)
  })
})

describe('zee generate controller (AC-generate-controller)', () => {
  it('writes users.controller.zee from `user`', () => {
    const root = project()
    const created = generateController({ cwd: root, path: 'user' })
    expect(created.file).toBe(join(root, 'src/modules/users/users.controller.zee'))
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
  it('writes users.service.zee', () => {
    const root = project()
    const created = generateService({ cwd: root, path: 'user' })
    expect(created.file).toBe(join(root, 'src/modules/users/users.service.zee'))
    expect(readFileSync(created.file, 'utf8')).toContain('users.service')
    assertChecks(created.file)
  })
})

describe('zee generate resource (AC-generate-resource)', () => {
  it('writes only the HTTP response mapper users.resource.zee', () => {
    const root = project()
    const created = generateResource({ cwd: root, path: 'user' })
    expect(created.file).toBe(join(root, 'src/modules/users/users.resource.zee'))
    expect(readFileSync(created.file, 'utf8')).toContain('users.resource')
    expect(existsSync(join(root, 'src/modules/users/users.module.zee'))).toBe(false)
    expect(existsSync(join(root, 'src/modules/users/users.controller.zee'))).toBe(false)
    expect(existsSync(join(root, 'src/modules/users/users.service.zee'))).toBe(false)
    assertChecks(created.file)
  })
})

describe('zee generate action / repository / model / api (AC-generate-layers)', () => {
  it('writes each layer file next to the controller', () => {
    const root = project()
    const action = generateAction({ cwd: root, path: 'user' })
    const repository = generateRepository({ cwd: root, path: 'user' })
    const model = generateModel({ cwd: root, path: 'user' })
    const api = generateApi({ cwd: root, path: 'user' })
    expect(action.file).toBe(join(root, 'src/modules/users/users.action.zee'))
    expect(repository.file).toBe(join(root, 'src/modules/users/users.repository.zee'))
    expect(model.file).toBe(join(root, 'src/modules/users/users.model.zee'))
    expect(api.file).toBe(join(root, 'src/modules/users/users.api.zee'))
    expect(readFileSync(action.file, 'utf8')).toContain('users.action')
    expect(readFileSync(repository.file, 'utf8')).toContain('users.repository')
    expect(readFileSync(model.file, 'utf8')).toContain('users.model')
    expect(readFileSync(api.file, 'utf8')).toContain('users.api')
    assertChecks(action.file)
    assertChecks(repository.file)
    assertChecks(model.file)
    assertChecks(api.file)
  })
})

describe('zee generate feature (AC-generate-feature)', () => {
  it('scaffolds the HTTP slice: controller → action → service → resource | repository → api | model', () => {
    const root = project()
    const created = generateFeature({ cwd: root, path: 'user', kind: 'api' })
    expect(created.module.file).toBe(join(root, 'src/modules/users/users.module.zee'))
    expect(created.controller.file).toBe(join(root, 'src/modules/users/users.controller.zee'))
    expect(created.action.file).toBe(join(root, 'src/modules/users/users.action.zee'))
    expect(created.service.file).toBe(join(root, 'src/modules/users/users.service.zee'))
    expect(created.resource.file).toBe(join(root, 'src/modules/users/users.resource.zee'))
    expect(created.repository.file).toBe(join(root, 'src/modules/users/users.repository.zee'))
    expect(created.model.file).toBe(join(root, 'src/modules/users/users.model.zee'))
    expect(created.api.file).toBe(join(root, 'src/modules/users/users.api.zee'))
    expect(readFileSync(created.controller.file, 'utf8')).toContain('fn index()')
    assertChecks(created.module.file)
    assertChecks(created.controller.file)
    assertChecks(created.action.file)
    assertChecks(created.service.file)
    assertChecks(created.resource.file)
    assertChecks(created.repository.file)
    assertChecks(created.model.file)
    assertChecks(created.api.file)
    expect(() => generateFeature({ cwd: root, path: 'user' })).toThrow(/already exists/)
  })
})
