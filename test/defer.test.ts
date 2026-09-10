import { describe, expect, it } from 'vitest'
import { PanicError, ZeeError } from '../src/error.ts'
import { execute } from '../src/zee.ts'

describe('defer (AC-defer)', () => {
  it('runs on normal return, last registered first', () => {
    const result = execute(`
      fn f() {
        defer println("first")
        defer println("second")
      }
      f()
    `)
    expect(result.stdout).toBe('second\nfirst\n')
  })

  it('runs on early return', () => {
    const result = execute(`
      fn f() -> i32 {
        defer println("bye")
        return 1
        println("no")
      }
      f()
    `)
    expect(result.stdout).toBe('bye\n')
    expect(result.value).toEqual({ type: 'i32', value: 1 })
  })

  it('in a loop runs once per iteration at function exit', () => {
    const result = execute(`
      fn f() {
        for i in 0..3 {
          defer println(str(i))
        }
      }
      f()
    `)
    expect(result.stdout).toBe('2\n1\n0\n')
  })

  it('gives a lambda its own defer stack', () => {
    const result = execute(`
      fn apply(f: () -> i32) -> i32 {
        f()
      }
      fn f() {
        defer println("outer")
        const n = apply() {
          defer println("inner")
          1
        }
      }
      f()
    `)
    expect(result.stdout).toBe('inner\nouter\n')
  })

  it('is an error outside of a function', () => {
    expect(() => execute('defer println("x")')).toThrow(ZeeError)
    expect(() => execute('defer println("x")')).toThrow(/defer/)
  })

  it('runs before panic aborts', () => {
    expect(() =>
      execute(`
        fn f() {
          defer println("cleanup")
          panic("boom")
        }
        f()
      `),
    ).toThrow(PanicError)

    const result = tryExecute(`
      fn f() {
        defer println("cleanup")
        panic("boom")
      }
      f()
    `)
    expect(result.stdout).toBe('cleanup\n')
    expect(result.error).toBeInstanceOf(PanicError)
    expect(result.error?.message).toMatch(/boom/)
  })

  it('evaluates deferred call arguments now', () => {
    const result = execute(`
      fn show(n: i32) {
        println(str(n))
      }
      fn f() {
        var x = 1
        defer show(x)
        x = 2
      }
      f()
    `)
    expect(result.stdout).toBe('1\n')
  })

  it('runs on language faults inside a function', () => {
    const result = tryExecute(`
      fn f() {
        defer println("cleanup")
        const overflowed = 120i8 + 10i8
      }
      f()
    `)
    expect(result.stdout).toBe('cleanup\n')
    expect(result.error).toBeInstanceOf(ZeeError)
    expect(result.error?.message).toMatch(/overflow/)
  })
})

function tryExecute(source: string): { stdout: string; error: Error | undefined } {
  let stdout = ''
  try {
    const result = execute(source, { print: (text) => { stdout += text } })
    return { stdout: result.stdout, error: undefined }
  } catch (error) {
    return { stdout, error: error instanceof Error ? error : new Error(String(error)) }
  }
}
