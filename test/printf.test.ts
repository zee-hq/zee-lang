import { describe, expect, it } from 'vitest'
import { ZeeError } from '../src/error.ts'
import { execute } from '../src/zee.ts'

describe('printf (ZEE-19)', () => {
  it('formats %s %d %b and %% without adding a newline', () => {
    const result = execute(`
      fn main() {
        printf("hello, %s %d %b %%", "zee", 42, true)
      }
    `)
    expect(result.stdout).toBe('hello, zee 42 true %')
  })

  it('writes a newline only when the format contains one', () => {
    const result = execute(`
      fn main() {
        printf("n=%d\\n", 7)
      }
    `)
    expect(result.stdout).toBe('n=7\n')
  })

  it('returns the formatted string from sprintf', () => {
    expect(execute('sprintf("%s-%d", "a", 1)').value).toEqual({
      type: 'string',
      value: 'a-1',
    })
  })

  it('rejects a missing or extra argument', () => {
    expect(() => execute('printf("%s")')).toThrow(ZeeError)
    expect(() => execute('printf("%s", "a", "b")')).toThrow(ZeeError)
  })
})
