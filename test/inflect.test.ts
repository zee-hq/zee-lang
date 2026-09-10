import { describe, expect, it } from 'vitest'
import { pluralize } from '../src/inflect.ts'

describe('pluralize (AC-generate-inflect)', () => {
  it('turns a resource name into the layer folder/file stem', () => {
    expect(pluralize('user')).toBe('users')
    expect(pluralize('users')).toBe('users')
    expect(pluralize('city')).toBe('cities')
    expect(pluralize('box')).toBe('boxes')
  })

  it('leaves uncountable module names alone', () => {
    expect(pluralize('http')).toBe('http')
    expect(pluralize('tls')).toBe('tls')
    expect(pluralize('math')).toBe('math')
    expect(pluralize('auth')).toBe('auth')
  })
})
