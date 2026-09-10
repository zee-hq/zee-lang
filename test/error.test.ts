import { describe, expect, it } from 'vitest'
import { execute } from '../src/zee.ts'

describe('stdlib Error interface (AC-error-interface)', () => {
  it('constructs error("…") and reads message()', () => {
    expect(execute('error("empty").message()').value).toEqual({ type: 'string', value: 'empty' })
  })

  it('keeps Option<Error> and err != None working', () => {
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

  it('builds Fail as a data struct that implements Error', () => {
    expect(
      execute(`
        const e: Error = Fail { text: "missing file" }
        e.message()
      `).value,
    ).toEqual({ type: 'string', value: 'missing file' })
  })
})
