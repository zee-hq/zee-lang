import { describe, expect, it } from 'vitest'
import { execute } from '../src/zee.ts'

describe('bitwise and wrap (ZEE-10 / §4)', () => {
  it('does & | ^ ~ on the same integer type', () => {
    expect(execute('0b1010u8 & 0b0010u8').value).toEqual({ type: 'u8', value: 2 })
    expect(execute('0b1010u8 | 0b0100u8').value).toEqual({ type: 'u8', value: 14 })
    expect(execute('0b1010u8 ^ 0b0011u8').value).toEqual({ type: 'u8', value: 9 })
    expect(execute('~0u8').value).toEqual({ type: 'u8', value: 255 })
    expect(execute('~0i8').value).toEqual({ type: 'i8', value: -1 })
  })

  it('shifts: signed >> is arithmetic, unsigned is logical, no >>>', () => {
    expect(execute('1i32 << 1').value).toEqual({ type: 'i32', value: 2 })
    expect(execute('(-128i8) >> 1').value).toEqual({ type: 'i8', value: -64 })
    expect(execute('128u8 >> 1').value).toEqual({ type: 'u8', value: 64 })
    expect(execute('1u8 << 1u8').value).toEqual({ type: 'u8', value: 2 })
    expect(() => execute('1 >>> 1')).toThrow()
    expect(() => execute('1i32 << 1i32')).toThrow(/shift|u32|unsigned/)
  })

  it('panics when a language shift does not fit or the count is too wide', () => {
    expect(() => execute('64i8 << 1')).toThrow(/overflow/)
    expect(() => execute('1i8 << 8')).toThrow(/shift/)
    expect(() => execute('1u8 >> 8')).toThrow(/shift/)
  })

  it('applies bitwise compounds on var and refuses them on float, bool, and String', () => {
    expect(
      execute(`
        var flags = 0b1010u8
        flags &= 0b0011u8
        flags
      `).value,
    ).toEqual({ type: 'u8', value: 2 })
    expect(
      execute(`
        var n = 1i32
        n <<= 1
        n
      `).value,
    ).toEqual({ type: 'i32', value: 2 })
    expect(() => execute('1.0 & 1.0')).toThrow(/not defined/)
    expect(() => execute('true | false')).toThrow(/not defined/)
    expect(() => execute('"a" ^ "b"')).toThrow(/not defined/)
    expect(() => execute('~true')).toThrow(/not defined/)
  })

  it('keeps language + as overflow panic and wrap.add as two’s complement wrap', () => {
    expect(() => execute('120i8 + 10i8')).toThrow(/overflow/)
    expect(execute('wrap.add(120i8, 10i8)').value).toEqual({ type: 'i8', value: -126 })
    expect(execute('wrap.sub(-128i8, 1i8)').value).toEqual({ type: 'i8', value: 127 })
    expect(execute('wrap.mul(16i8, 16i8)').value).toEqual({ type: 'i8', value: 0 })
    expect(execute('wrap.shl(1i8, 7i8)').value).toEqual({ type: 'i8', value: -128 })
    expect(execute('wrap.shl(1i8, 8i8)').value).toEqual({ type: 'i8', value: 1 })
    expect(() => execute('wrap.add(1.0, 1.0)')).toThrow(/int/)
  })
})
