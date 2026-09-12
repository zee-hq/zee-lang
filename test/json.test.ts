import { describe, expect, it } from 'vitest'
import { execute } from '../src/zee.ts'

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
