import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ZeeError } from '../src/error.ts'
import { createProject, findProjectRoot, resolveEntry } from '../src/project.ts'
import { executeFile } from '../src/zee.ts'

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

describe('zee new', () => {
  it('scaffolds a runnable project (AC-new-project)', () => {
    const parent = scratch()
    const created = createProject({ name: 'hello', parentDir: parent, mode: 'new' })

    expect(created.root).toBe(join(parent, 'hello'))
    expect(readFileSync(join(created.root, 'zee.toml'), 'utf8')).toContain('name = "hello"')
    expect(readFileSync(join(created.root, 'src/main.zee'), 'utf8')).toContain('fn main()')
    expect(existsSync(join(created.root, '.gitignore'))).toBe(true)

    const result = executeFile(created.entry)
    expect(result.stdout).toBe('hello, hello\n')
  })

  it('refuses an invalid package name', () => {
    expect(() => createProject({ name: 'My App', parentDir: scratch(), mode: 'new' })).toThrow(
      /invalid package name/,
    )
  })

  it('refuses to overwrite an existing directory', () => {
    const parent = scratch()
    mkdirSync(join(parent, 'hello'))
    expect(() => createProject({ name: 'hello', parentDir: parent, mode: 'new' })).toThrow(
      /already exists/,
    )
  })
})

describe('zee init', () => {
  it('scaffolds the current directory', () => {
    const cwd = scratch()
    const created = createProject({ name: 'from-cwd', parentDir: cwd, mode: 'init' })
    expect(created.root).toBe(cwd)
    expect(existsSync(join(cwd, 'zee.toml'))).toBe(true)
    expect(existsSync(join(cwd, 'src/main.zee'))).toBe(true)
  })

  it('refuses a directory that already has zee.toml', () => {
    const cwd = scratch()
    writeFileSync(join(cwd, 'zee.toml'), '[package]\nname = "x"\n')
    expect(() => createProject({ name: 'x', parentDir: cwd, mode: 'init' })).toThrow(/already a Zee project/)
  })
})

describe('project discovery', () => {
  it('finds zee.toml walking up and resolves src/main.zee', () => {
    const parent = scratch()
    const created = createProject({ name: 'app', parentDir: parent, mode: 'new' })
    const nested = join(created.root, 'src')
    expect(findProjectRoot(nested)).toBe(created.root)
    expect(resolveEntry(nested)).toBe(join(created.root, 'src/main.zee'))
  })

  it('prefers an explicit file over the project entry', () => {
    const parent = scratch()
    const created = createProject({ name: 'app', parentDir: parent, mode: 'new' })
    const extra = join(created.root, 'extra.zee')
    writeFileSync(extra, 'fn main() { println("extra") }\n')
    expect(resolveEntry(created.root, extra)).toBe(extra)
  })

  it('errors when there is no file and no project', () => {
    expect(() => resolveEntry(scratch())).toThrow(ZeeError)
  })
})
