import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createProject } from '../src/project.ts'
import { parseCreateArgv, parseProjectKind, scaffoldProjectKind } from '../src/scaffold.ts'
import { executeFile } from '../src/zee.ts'

const temps: string[] = []

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zee-kind-'))
  temps.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function project(kind: Parameters<typeof scaffoldProjectKind>[1], name = 'shop') {
  const created = createProject({ name, parentDir: scratch(), mode: 'new' })
  scaffoldProjectKind(created.root, kind)
  return created
}

describe('parseCreateArgv (AC-new-kind)', () => {
  it('defaults to bin', () => {
    expect(parseCreateArgv(['hello'])).toEqual({ name: 'hello', kind: 'bin' })
  })

  it('reads --kind after the name', () => {
    expect(parseCreateArgv(['shop', '--kind', 'api'])).toEqual({ name: 'shop', kind: 'api' })
  })

  it('reads --kind=web before the name', () => {
    expect(parseCreateArgv(['--kind=web', 'shop'])).toEqual({ name: 'shop', kind: 'web' })
  })

  it('rejects an unknown kind', () => {
    expect(() => parseProjectKind('nest')).toThrow(/unknown --kind/)
  })

  it('rejects a missing --kind value', () => {
    expect(() => parseCreateArgv(['shop', '--kind'])).toThrow(/missing value for --kind/)
  })
})

describe('zee new --kind (AC-new-kind)', () => {
  it('bin stays a single main with no users or ui modules', () => {
    const created = project('bin', 'hello')
    expect(existsSync(join(created.root, 'src/modules/users'))).toBe(false)
    expect(existsSync(join(created.root, 'src/ui'))).toBe(false)
    expect(executeFile(created.entry).stdout).toBe('hello, hello\n')
  })

  it('api writes an HTTP feature slice and no ui module', () => {
    const created = project('api')
    const controller = readFileSync(join(created.root, 'src/modules/users/users.controller.zee'), 'utf8')
    expect(controller).toContain('fn index()')
    expect(existsSync(join(created.root, 'src/ui'))).toBe(false)
    expect(readFileSync(join(created.root, 'zee.toml'), 'utf8')).toMatch(/description = ".*API/)
    expect(existsSync(join(created.root, 'src/bootstrap/main.zee'))).toBe(true)
    expect(existsSync(join(created.root, 'src/main.zee'))).toBe(false)
    expect(readFileSync(join(created.root, 'zee.toml'), 'utf8')).toContain('entry = "src/bootstrap/main.zee"')
    expect(readFileSync(join(created.root, 'src/bootstrap/main.zee'), 'utf8')).toMatch(/Composition root/)
    expect(executeFile(join(created.root, 'src/bootstrap/main.zee')).stdout).toBe('hello, shop\n')
  })

  it('service is an API slice marked as a process', () => {
    const created = project('service', 'billing')
    expect(existsSync(join(created.root, 'src/modules/users/users.controller.zee'))).toBe(true)
    expect(existsSync(join(created.root, 'src/ui'))).toBe(false)
    expect(readFileSync(join(created.root, 'zee.toml'), 'utf8')).toMatch(/process/)
  })

  it('web writes the ui module and no HTTP slice', () => {
    const created = project('web')
    expect(existsSync(join(created.root, 'src/ui/ui.module.zee'))).toBe(true)
    expect(readFileSync(join(created.root, 'src/ui/ui.view.zee'), 'utf8')).toMatch(/gap/i)
    expect(existsSync(join(created.root, 'src/modules/users'))).toBe(false)
  })

  it('monolith keeps HTTP and ui in one package', () => {
    const created = project('monolith')
    expect(existsSync(join(created.root, 'src/modules/users/users.controller.zee'))).toBe(true)
    expect(existsSync(join(created.root, 'src/ui/ui.module.zee'))).toBe(true)
    expect(readFileSync(join(created.root, 'src/bootstrap/main.zee'), 'utf8')).toMatch(/Composition root/)
    expect(executeFile(join(created.root, 'src/bootstrap/main.zee')).stdout).toBe('hello, shop\n')
  })
})
