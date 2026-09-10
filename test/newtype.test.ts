import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from '../src/parser.ts'
import { createProject } from '../src/project.ts'
import { execute, executePath } from '../src/zee.ts'

const temps: string[] = []

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zee-newtype-'))
  temps.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('type alias and newtype (AC-type-newtype)', () => {
  it('parses type and newtype declarations', () => {
    const program = parse(`
      type Handler = (i32) -> i32
      type Table<K, V> = Map<K, List<V>>
      pub newtype UserId = i32
    `)
    expect(program.stmts.map((stmt) => stmt.kind)).toEqual(['typeAliasDecl', 'typeAliasDecl', 'newtypeDecl'])
    const alias = program.stmts[0]
    expect(alias?.kind).toBe('typeAliasDecl')
    if (alias?.kind !== 'typeAliasDecl') return
    expect(alias.name).toBe('Handler')
    expect(alias.typeParams).toEqual([])
    expect(alias.aliased.kind).toBe('fn')

    const generic = program.stmts[1]
    expect(generic?.kind).toBe('typeAliasDecl')
    if (generic?.kind !== 'typeAliasDecl') return
    expect(generic.typeParams).toEqual(['K', 'V'])

    const nt = program.stmts[2]
    expect(nt?.kind).toBe('newtypeDecl')
    if (nt?.kind !== 'newtypeDecl') return
    expect(nt.name).toBe('UserId')
    expect(nt.visibility).toBe('pub')
  })

  it('treats type alias as interchangeable with the inner type', () => {
    expect(
      execute(`
        type Handler = (i32) -> i32
        const double: Handler = { x -> x * 2 }
        const also: (i32) -> i32 = double
        also(21)
      `).value,
    ).toEqual({ type: 'i32', value: 42 })
  })

  it('wraps and unwraps a newtype with Name(x) / T(name)', () => {
    expect(
      execute(`
        newtype UserId = i32
        const id = UserId(40)
        const n: i32 = i32(id)
        n
      `).value,
    ).toEqual({ type: 'i32', value: 40 })
  })

  it('unwraps a String newtype with String(name)', () => {
    expect(
      execute(`
        newtype Email = String
        const e = Email("a@b.com")
        String(e)
      `).value,
    ).toEqual({ type: 'string', value: 'a@b.com' })
  })

  it('compares newtypes with Eq of the inner type', () => {
    expect(
      execute(`
        newtype UserId = i32
        const id = UserId(40)
        (id == UserId(40), id != UserId(41))
      `).value,
    ).toEqual({
      type: 'tuple',
      items: [
        { type: 'bool', value: true },
        { type: 'bool', value: true },
      ],
    })
  })

  it('uses a Hash newtype as a Map key', () => {
    expect(
      execute(`
        newtype UserId = i32
        var names: Map<UserId, String> = {}
        names[UserId(40)] = "ana"
        names[UserId(40)]
      `).value,
    ).toEqual({ type: 'option', tag: 'some', value: { type: 'string', value: 'ana' } })
  })

  it('uses a String newtype as a Map key', () => {
    expect(
      execute(`
        newtype Email = String
        var inbox: Map<Email, i32> = {}
        inbox[Email("a@b.com")] = 1
        inbox[Email("a@b.com")]
      `).value,
    ).toEqual({ type: 'option', tag: 'some', value: { type: 'i32', value: 1 } })
  })

  it('rejects mixing a newtype with its inner type', () => {
    expect(() =>
      execute(`
        newtype UserId = i32
        const id = UserId(40)
        const n: i32 = id
      `),
    ).toThrow(/expected i32, got/)
    expect(() =>
      execute(`
        newtype UserId = i32
        const id = UserId(40)
        id == 40
      `),
    ).toThrow(/expected UserId, got i32|not defined/)
  })

  it('rejects arithmetic, concat, and index on a newtype wrapper', () => {
    expect(() =>
      execute(`
        newtype UserId = i32
        const id = UserId(40)
        id + 1
      `),
    ).toThrow(/not defined/)
    expect(() =>
      execute(`
        newtype Email = String
        const e = Email("a")
        e + "b"
      `),
    ).toThrow(/not defined/)
    expect(() =>
      execute(`
        newtype Email = String
        const e = Email("ab")
        e[0usize]
      `),
    ).toThrow(/index requires/)
  })

  it('expands a generic type alias', () => {
    expect(
      execute(`
        type Table<K, V> = Map<K, List<V>>
        var t: Table<i32, String> = {}
        t[1] = ["a"]
        t[1]
      `).value,
    ).toEqual({
      type: 'option',
      tag: 'some',
      value: { type: 'list', items: [{ type: 'string', value: 'a' }], elem: { kind: 'string' } },
    })
  })

  it('rejects a cyclic alias', () => {
    expect(() =>
      execute(`
        type A = B
        type B = A
        const x: A = 1
      `),
    ).toThrow(/cyclic/)
  })

  it('rejects a name clash between type and newtype', () => {
    expect(() =>
      execute(`
        newtype UserId = i32
        type UserId = i32
      `),
    ).toThrow(/duplicate/)
  })

  it('hides a file-private newtype from another module', () => {
    const root = createProject({ name: 'ids', parentDir: scratch(), mode: 'new' }).root
    mkdirSync(join(root, 'src/ids'), { recursive: true })
    writeFileSync(join(root, 'src/ids/ids.zee'), 'newtype UserId = i32\n')
    writeFileSync(
      join(root, 'src/main.zee'),
      'import ids.UserId\nfn main() {\n  println(str(i32(UserId(1))))\n}\n',
    )
    expect(() => executePath(join(root, 'src/main.zee'))).toThrow(/internal|not exported/)
  })

  it('imports a pub newtype', () => {
    const root = createProject({ name: 'ids', parentDir: scratch(), mode: 'new' }).root
    mkdirSync(join(root, 'src/ids'), { recursive: true })
    writeFileSync(join(root, 'src/ids/ids.zee'), 'pub newtype UserId = i32\n')
    writeFileSync(
      join(root, 'src/main.zee'),
      'import ids.UserId\nfn main() {\n  println(str(i32(UserId(40))))\n}\n',
    )
    expect(executePath(join(root, 'src/main.zee')).stdout).toBe('40\n')
  })
})
