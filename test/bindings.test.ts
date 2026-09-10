import { describe, expect, it } from 'vitest'
import { ZeeError } from '../src/error.ts'
import { execute } from '../src/zee.ts'

describe('bindings const/var (AC-const-var)', () => {
  it('infers const and does not allow assignment', () => {
    expect(execute('const x = 40\nconst y = 2\nx + y').value).toEqual({ type: 'i32', value: 42 })
    expect(() => execute('const x = 1\nx = 2')).toThrow(/cannot assign to const `x`/)
  })

  it('allows assignment to var', () => {
    expect(execute('var x = 1\nx = 2\nx').value).toEqual({ type: 'i32', value: 2 })
  })

  it('rejects assigning the wrong type to var', () => {
    expect(() => execute('var x = 1\nx = "zee"')).toThrow(ZeeError)
  })

  it('rejects assignment to an unknown name', () => {
    expect(() => execute('x = 1')).toThrow(/undefined name/)
  })
})
