import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createProject } from '../src/project.ts'
import { execute, executePath } from '../src/zee.ts'

const temps: string[] = []
const JSON_LIB = join(fileURLToPath(new URL('.', import.meta.url)), '../libs/json')

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zee-json-'))
  temps.push(dir)
  return dir
}

function write(root: string, rel: string, source: string): void {
  const full = join(root, rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, source)
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

const ROW = `
  pub data struct UserRow {
    pub const id: i32
    pub const name: String
  }
`

describe('jsonEncode / jsonDecode builtins (AC-json)', () => {
  it('encodes a data struct and a list compactly', () => {
    expect(
      execute(`
        ${ROW}
        jsonEncode(UserRow { id: 1, name: "ada" })
      `).value,
    ).toEqual({ type: 'string', value: '{"id":1,"name":"ada"}' })
    expect(
      execute(`
        ${ROW}
        jsonEncode([UserRow { id: 1, name: "ada" }, UserRow { id: 2, name: "grace" }])
      `).value,
    ).toEqual({ type: 'string', value: '[{"id":1,"name":"ada"},{"id":2,"name":"grace"}]' })
  })

  it('encodes None as JSON null and Some as the inner value', () => {
    expect(
      execute(`
        const n: Option<i32> = None
        jsonEncode(n)
      `).value,
    ).toEqual({ type: 'string', value: 'null' })
    expect(execute('jsonEncode(Some(3))').value).toEqual({ type: 'string', value: '3' })
  })

  it('decodes a data struct and reports invalid JSON as err', () => {
    expect(
      execute(`
        ${ROW}
        const (row, err) = jsonDecode<UserRow>("{\\"id\\":1,\\"name\\":\\"ada\\"}")
        (err.isNone(), row.id, row.name)
      `).value,
    ).toEqual({
      type: 'tuple',
      items: [
        { type: 'bool', value: true },
        { type: 'i32', value: 1 },
        { type: 'string', value: 'ada' },
      ],
    })
    expect(
      execute(`
        ${ROW}
        const (row, err) = jsonDecode<UserRow>("nope")
        (err.isSome(), row.id)
      `).value,
    ).toEqual({
      type: 'tuple',
      items: [
        { type: 'bool', value: true },
        { type: 'i32', value: 0 },
      ],
    })
  })

  it('decodes JSON null to None', () => {
    expect(
      execute(`
        const (n, err) = jsonDecode<Option<i32>>("null")
        (err.isNone(), n.isNone())
      `).value,
    ).toEqual({
      type: 'tuple',
      items: [
        { type: 'bool', value: true },
        { type: 'bool', value: true },
      ],
    })
  })
})

describe('official json package (AC-json-lib)', () => {
  function appWithJson(): string {
    const parent = scratch()
    const app = createProject({ name: 'app', parentDir: parent, mode: 'new' })
    write(
      app.root,
      'zee.toml',
      `[package]\nname = "app"\nversion = "0.1.0"\nentry = "src/main.zee"\n\n[deps]\njson = { path = "${JSON_LIB}" }\n`,
    )
    return app.root
  }

  it('encodes and decodes through import json', () => {
    const root = appWithJson()
    write(
      root,
      'src/main.zee',
      `import json

pub data struct UserRow {
  pub const id: i32
  pub const name: String
}

fn main() {
  const row = UserRow { id: 1, name: "ada" }
  println(json.encode(row))
  const (got, err) = json.decode<UserRow>(json.encode(row))
  if err != None { panic("decode") }
  println(got.name)
}
`,
    )
    expect(executePath(join(root, 'src/main.zee')).stdout).toBe('{"id":1,"name":"ada"}\nada\n')
  })
})
