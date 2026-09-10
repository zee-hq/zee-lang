import { describe, expect, it } from 'vitest'
import { ZeeError } from '../src/error.ts'
import { execute } from '../src/zee.ts'

describe('tuples (AC-tuple-go-err)', () => {
  it('builds a tuple, reads .0 / .1, and annotates the type', () => {
    expect(execute('const pair: (i32, String) = (1, "zee")\npair.0').value).toEqual({
      type: 'i32',
      value: 1,
    })
    expect(execute('const pair = (1, "zee")\npair.1').value).toEqual({
      type: 'string',
      value: 'zee',
    })
  })

  it('treats (T) as grouping and () as Unit, not 1-tuples', () => {
    expect(execute('const x: i32 = (40)\nx').value).toEqual({ type: 'i32', value: 40 })
    expect(execute('()').value).toEqual({ type: 'unit' })
    expect(() => execute('const x: (i32) = 1')).not.toThrow()
  })

  it('destructures with const/var and discards with _', () => {
    expect(
      execute(`
        fn divmod(a: i32, b: i32) -> (i32, i32) {
          (a / b, a % b)
        }
        const (q, r) = divmod(10, 3)
        q * 10 + r
      `).value,
    ).toEqual({ type: 'i32', value: 31 })

    expect(
      execute(`
        fn divmod(a: i32, b: i32) -> (i32, i32) {
          (a / b, a % b)
        }
        const (_, r) = divmod(10, 3)
        r
      `).value,
    ).toEqual({ type: 'i32', value: 1 })
  })

  it('rejects arity mismatch and out-of-range index', () => {
    expect(() => execute('const (a, b) = (1, 2, 3)')).toThrow(ZeeError)
    expect(() => execute('const pair = (1, 2)\npair.2')).toThrow(/tuple index/)
  })

  it('checks err != None on a Go-style (T, Option<Error>) return', () => {
    const result = execute(`
      fn read(path: String) -> (String, Option<Error>) {
        if path == "" {
          return ("", Some(error("empty")))
        }
        (path, None)
      }

      fn main() {
        const (body, err) = read("notes.txt")
        if err != None {
          println("failed")
          return
        }
        println(body)
      }
    `)
    expect(result.stdout).toBe('notes.txt\n')

    const failed = execute(`
      fn read(path: String) -> (String, Option<Error>) {
        if path == "" {
          return ("", Some(error("empty")))
        }
        (path, None)
      }
      const (body, err) = read("")
      if err != None { "failed" } else { body }
    `)
    expect(failed.value).toEqual({ type: 'string', value: 'failed' })
  })
})
