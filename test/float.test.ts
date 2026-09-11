import { describe, expect, it } from 'vitest'
import { execute } from '../src/zee.ts'

describe('floats (ZEE-9 / §0b)', () => {
  it('types unsuffixed 1.0 as f64 and honors f32 / f64 suffixes', () => {
    expect(execute('1.0').value).toEqual({ type: 'f64', value: 1 })
    expect(execute('1.0f32').value).toEqual({ type: 'f32', value: 1 })
    expect(execute('1.0f64').value).toEqual({ type: 'f64', value: 1 })
    expect(execute('const x: f32 = 1.0\nx').value).toEqual({ type: 'f32', value: 1 })
  })

  it('does + - * / only on the same float type', () => {
    expect(execute('1.0 + 2.0 * 3.0').value).toEqual({ type: 'f64', value: 7 })
    expect(execute('10.0 / 4.0').value).toEqual({ type: 'f64', value: 2.5 })
    expect(() => execute('1 + 1.0')).toThrow(/not defined/)
    expect(() => execute('1.0f32 + 1.0f64')).toThrow(/not defined/)
  })

  it('converts int to float with T(x) and float to int with narrow', () => {
    expect(execute('f64(40)').value).toEqual({ type: 'f64', value: 40 })
    expect(execute('f32(40)').value).toEqual({ type: 'f32', value: 40 })
    expect(execute('narrow<i32>(1.9)').value).toEqual({
      type: 'option',
      tag: 'some',
      value: { type: 'i32', value: 1 },
    })
    expect(execute('narrow<i8>(300.0)').value).toEqual({ type: 'option', tag: 'none' })
    expect(execute('narrow<i32>(0.0 / 0.0)').value).toEqual({ type: 'option', tag: 'none' })
  })

  it('uses IEEE equality and refuses Ord and Map keys', () => {
    expect(execute('(0.0 / 0.0) == (0.0 / 0.0)').value).toEqual({ type: 'bool', value: false })
    expect(execute('1.0 == 1.0').value).toEqual({ type: 'bool', value: true })
    expect(() => execute('1.0 < 2.0')).toThrow(/not defined/)
    expect(() => execute('1.0 <===> 2.0')).toThrow(/not defined/)
    expect(() => execute('var m: Map<f64, i32> = {}')).toThrow(/Hash/)
  })

  it('keeps integer overflow as panic and float overflow as IEEE', () => {
    expect(() => execute('120i8 + 10i8')).toThrow(/overflow/)
    expect(execute('1.0 / 0.0').value).toEqual({ type: 'f64', value: Infinity })
  })

  it('does not interpolate floats', () => {
    expect(() => execute('`n {1.0}`')).toThrow(/interpolat/)
  })
})
