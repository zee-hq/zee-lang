import { describe, expect, it } from 'vitest'
import { ZeeError } from '../src/error.ts'
import { execute } from '../src/zee.ts'

describe('type checker', () => {
  it('rejects adding i32 to String', () => {
    expect(() => execute('1 + "zee"')).toThrow(ZeeError)
    expect(() => execute('1 + "zee"')).toThrow(/operator `\+` is not defined/)
  })

  it('rejects if branches with different types', () => {
    expect(() => execute('if true { 1 } else { "no" }')).toThrow(/different types/)
  })

  it('rejects if-value without else', () => {
    expect(() => execute('let x = if true { 1 }')).toThrow(/missing `else`/)
  })

  it('accepts local inference for let', () => {
    expect(execute('let x = 40\nlet y = 2\nx + y').value).toEqual({ type: 'i32', value: 42 })
  })
})
