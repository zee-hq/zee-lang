import { describe, expect, it } from 'vitest'
import { parse } from '../src/parser.ts'
import { checkSource, execute } from '../src/zee.ts'

describe('doc comments (ZEE-11 / §0d)', () => {
  it('merges consecutive /// onto the next declaration', () => {
    const program = parse(`
      /// Opens path.
      ///
      /// Example uses \`{name}\`.
      pub fn open(path: String) -> String { path }
    `)
    const fn = program.stmts[0]
    expect(fn?.kind).toBe('fn')
    if (fn?.kind !== 'fn') return
    expect(fn.doc).toBe('Opens path.\n\nExample uses `{name}`.')
    expect(fn.name).toBe('open')
  })

  it('attaches /// to fields and methods', () => {
    const program = parse(`
      struct Point {
        /// Horizontal.
        const x: i32
        /// Vertical.
        const y: i32
        /// Length from origin.
        fn mag(self) -> i32 { self.x }
      }
    `)
    const decl = program.stmts[0]
    expect(decl?.kind).toBe('structDecl')
    if (decl?.kind !== 'structDecl') return
    expect(decl.fields[0]?.doc).toBe('Horizontal.')
    expect(decl.fields[1]?.doc).toBe('Vertical.')
    expect(decl.methods[0]?.doc).toBe('Length from origin.')
  })

  it('stores //! as inner docs on the file', () => {
    const program = parse(`
      //! HTTP client for the Zee stdlib.

      fn open() {}
    `)
    expect(program.innerDoc).toBe('HTTP client for the Zee stdlib.')
    expect(program.units[0]?.innerDoc).toBe('HTTP client for the Zee stdlib.')
  })

  it('does not treat // or /** as docs', () => {
    const program = parse(`
      // not a doc
      fn f() {}
      /** also not a doc */
      fn g() {}
    `)
    const f = program.stmts[0]
    const g = program.stmts[1]
    expect(f?.kind).toBe('fn')
    expect(g?.kind).toBe('fn')
    if (f?.kind === 'fn') expect(f.doc).toBeUndefined()
    if (g?.kind === 'fn') expect(g.doc).toBeUndefined()
  })

  it('errors when /// has no following declaration', () => {
    expect(() => parse('/// orphan\n')).toThrow(/declaration/)
    expect(() => parse('/// hanging\n1')).toThrow(/declaration/)
  })

  it('errors when //! is not at the top of the file', () => {
    expect(() => parse('fn f() {}\n//! late')).toThrow(/top of the file/)
  })

  it('type-checks and runs a documented function', () => {
    checkSource(`
      /// Adds one.
      fn inc(n: i32) -> i32 { n + 1 }
    `)
    expect(execute('/// Adds one.\nfn inc(n: i32) -> i32 { n + 1 }\ninc(1)').value).toEqual({
      type: 'i32',
      value: 2,
    })
  })
})
