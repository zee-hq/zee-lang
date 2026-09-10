import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { execute, executeFile, ZeeSession } from '../src/zee.ts'

const examples = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples')

describe('interpreter', () => {
  it('evaluates arithmetic and comparisons', () => {
    expect(execute('1 + 2 * 3').value).toEqual({ type: 'i32', value: 7 })
    expect(execute('10 / 4').value).toEqual({ type: 'i32', value: 2 })
    expect(execute('2 < 3').value).toEqual({ type: 'bool', value: true })
  })

  it('concatenates strings without coercing numbers', () => {
    expect(execute('"ze" + "e"').value).toEqual({ type: 'string', value: 'zee' })
  })

  it('runs recursive functions and prints', () => {
    const result = execute(`
      fn factorial(n: i32) -> i32 {
        if n <= 1 { 1 } else { n * factorial(n - 1) }
      }

      fn main() {
        println(str(factorial(5)))
      }
    `)
    expect(result.stdout).toBe('120\n')
  })

  it('uses main return value as exit code', () => {
    const result = execute('fn main() -> i32 { 7 }')
    expect(result.exitCode).toBe(7)
  })

  it('runs examples/hello.zee', () => {
    const result = executeFile(join(examples, 'hello.zee'))
    expect(result.stdout).toBe('hello, zee\n')
  })

  it('runs examples/factorial.zee', () => {
    const result = executeFile(join(examples, 'factorial.zee'))
    expect(result.stdout).toBe('120\n')
  })

  it('runs examples/greet.zee', () => {
    const result = executeFile(join(examples, 'greet.zee'))
    expect(result.stdout).toBe('hello, zee\n')
  })

  it('keeps lets and functions in the REPL session', () => {
    const session = new ZeeSession()
    session.eval('const x = 40')
    session.eval('fn add(a: i32, b: i32) -> i32 { a + b }')
    const result = session.eval('add(x, 2)')
    expect(result.display).toBe('42')
  })
})

describe('examples', () => {
  it('hello source is stable', () => {
    expect(readFileSync(join(examples, 'hello.zee'), 'utf8')).toContain('hello, zee')
  })
})
