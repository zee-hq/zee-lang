import { describe, expect, it } from 'vitest'
import { execute } from '../src/zee.ts'

describe('getenv builtin (AC-env-getenv)', () => {
  it('returns Some from process env and None when absent', () => {
    expect(execute('getenv("ZEE_TEST_KEY")', { processEnv: { ZEE_TEST_KEY: 'ok' } }).value).toEqual({
      type: 'option',
      tag: 'some',
      value: { type: 'string', value: 'ok' },
    })
    expect(execute('getenv("ZEE_TEST_ABSENT")', { processEnv: {} }).value).toEqual({
      type: 'option',
      tag: 'none',
    })
  })
})
