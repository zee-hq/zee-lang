import { describe, expect, it } from 'vitest'
import { execute } from '../src/zee.ts'

describe('integer widths and redim (AC-int-redim)', () => {
  it('lets unsuffixed literals take the expected integer type when they fit', () => {
    expect(execute('const x: u8 = 255\nx').value).toEqual({ type: 'u8', value: 255 })
    expect(execute('const n = 40\nn').value).toEqual({ type: 'i32', value: 40 })
    expect(execute('const len: usize = 40\nlen').value).toEqual({ type: 'usize', value: 40n })
    expect(() => execute('const y: u8 = 256')).toThrow(/does not fit/)
  })

  it('accepts suffixes, hex, binary, and digit separators', () => {
    expect(execute('40u8').value).toEqual({ type: 'u8', value: 40 })
    expect(execute('const x: u8 = 0xFF\nx').value).toEqual({ type: 'u8', value: 255 })
    expect(execute('0b1010').value).toEqual({ type: 'i32', value: 10 })
    expect(execute('1_000').value).toEqual({ type: 'i32', value: 1000 })
  })

  it('redims a var to a wider integer on the same signedness ladder', () => {
    expect(
      execute(`
        var x: i8 = 1
        redim x: i32
        x + 40
      `).value,
    ).toEqual({ type: 'i32', value: 41 })
  })

  it('rejects redim across signedness and redim of const', () => {
    expect(() => execute('var x: i32 = 1\nredim x: u32')).toThrow(/signedness|ladder|unsigned/)
    expect(() => execute('const x: i8 = 1\nredim x: i32')).toThrow(/const/)
    expect(() => execute('var x: i32 = 1\nredim x: i8')).toThrow(/narrow/)
  })

  it('rejects mixed arithmetic and widens with T(x)', () => {
    expect(() => execute('const a: i32 = 1\nconst b: i64 = 2\na + b')).toThrow(/not defined/)
    expect(() =>
      execute(`
        const n: i32 = 40
        i8(n)
      `),
    ).toThrow(/narrow/)
    expect(
      execute(`
        const n: i32 = 40
        i64(n) + 2i64
      `).value,
    ).toEqual({ type: 'i64', value: 42n })
  })

  it('narrows with narrow<T> and panics on overflow', () => {
    expect(execute('narrow<u8>(255)').value).toEqual({
      type: 'option',
      tag: 'some',
      value: { type: 'u8', value: 255 },
    })
    expect(execute('narrow<u8>(256)').value).toEqual({ type: 'option', tag: 'none' })
    expect(() => execute('120i8 + 10i8')).toThrow(/overflow/)
  })
})
