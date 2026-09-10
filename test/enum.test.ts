import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ZeeError } from '../src/error.ts'
import { createProject } from '../src/project.ts'
import { execute, executePath } from '../src/zee.ts'

const temps: string[] = []

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zee-enum-'))
  temps.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('enum (AC-enum-variants)', () => {
  it('constructs a variant by nested name, not a string', () => {
    expect(
      execute(`
        enum Status {
          Ready
          Failed
        }
        const s = Status.Ready
        s == Status.Ready
      `).value,
    ).toEqual({ type: 'bool', value: true })
  })

  it('compares variants with Eq and is not a String', () => {
    expect(
      execute(`
        enum Status {
          Ready
          Failed
        }
        Status.Ready == Status.Failed
      `).value,
    ).toEqual({ type: 'bool', value: false })
    expect(() =>
      execute(`
        enum Status {
          Ready
        }
        Status.Ready == "Ready"
      `),
    ).toThrow(/not defined|expected/)
  })

  it('matches exhaustively without _ when every variant is covered', () => {
    expect(
      execute(`
        enum Status {
          Ready
          Failed
        }
        const s = Status.Ready
        match s {
          Status.Ready => "ok"
          Status.Failed => "no"
        }
      `).value,
    ).toEqual({ type: 'string', value: 'ok' })
  })

  it('rejects a non-exhaustive enum match', () => {
    expect(() =>
      execute(`
        enum Status {
          Ready
          Failed
        }
        match Status.Ready {
          Status.Ready => "ok"
        }
      `),
    ).toThrow(ZeeError)
    expect(() =>
      execute(`
        enum Status {
          Ready
          Failed
        }
        match Status.Ready {
          Status.Ready => "ok"
        }
      `),
    ).toThrow(/exhaustive/)
  })

  it('allows _ as a default arm', () => {
    expect(
      execute(`
        enum Status {
          Ready
          Failed
        }
        match Status.Failed {
          Status.Ready => "ok"
          _ => "no"
        }
      `).value,
    ).toEqual({ type: 'string', value: 'no' })
  })

  it('combines enum variants with |', () => {
    expect(
      execute(`
        enum Status {
          Ready
          Failed
        }
        fn label(s: Status) -> String {
          match s {
            Status.Ready | Status.Failed => "done"
          }
        }
        label(Status.Failed)
      `).value,
    ).toEqual({ type: 'string', value: 'done' })
  })

  it('orders variants by declaration with < and <===>', () => {
    expect(
      execute(`
        enum Status {
          Ready
          Failed
        }
        Status.Ready < Status.Failed
      `).value,
    ).toEqual({ type: 'bool', value: true })
    expect(
      execute(`
        enum Status {
          Ready
          Failed
        }
        Status.Ready <===> Status.Failed
      `).value,
    ).toEqual({ type: 'i32', value: -1 })
    expect(
      execute(`
        enum Status {
          Ready
          Failed
        }
        Status.Failed >= Status.Ready
      `).value,
    ).toEqual({ type: 'bool', value: true })
  })

  it('imports a pub enum and matches it from another module', () => {
    const created = createProject({ name: 'enumvis', parentDir: scratch(), mode: 'new' })
    mkdirSync(join(created.root, 'src/status'))
    writeFileSync(
      join(created.root, 'src/status/status.zee'),
      `pub enum Status {
  Ready
  Failed
}
`,
    )
    writeFileSync(
      join(created.root, 'src/main.zee'),
      `import status.Status
fn main() {
  const s = Status.Ready
  println(match s {
    Status.Ready => "ok"
    Status.Failed => "no"
  })
}
`,
    )
    expect(executePath(created.entry).stdout).toBe('ok\n')
  })
})
