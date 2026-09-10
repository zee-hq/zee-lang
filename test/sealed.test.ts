import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ZeeError } from '../src/error.ts'
import { createProject } from '../src/project.ts'
import { execute, executePath } from '../src/zee.ts'

const temps: string[] = []

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zee-sealed-'))
  temps.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

const SHAPE = `
  sealed struct Shape {
    data struct Circle {
      const r: i32
    }
    data struct Rect {
      const w: i32
      const h: i32
    }
  }
`

describe('sealed struct (AC-sealed-variants)', () => {
  it('constructs a nested variant and matches by tag with field bindings', () => {
    expect(
      execute(`
        ${SHAPE}
        const shape = Shape.Circle { r: 3 }
        match shape {
          Shape.Circle { r } => r * r
          Shape.Rect { w, h } => w * h
        }
      `).value,
    ).toEqual({ type: 'i32', value: 9 })
  })

  it('uses destructured bindings in the arm body', () => {
    expect(
      execute(`
        ${SHAPE}
        const shape = Shape.Rect { w: 4, h: 5 }
        match shape {
          Shape.Circle { r } => r
          Shape.Rect { w, h } => w * h
        }
      `).value,
    ).toEqual({ type: 'i32', value: 20 })
  })

  it('rejects a non-exhaustive sealed match', () => {
    expect(() =>
      execute(`
        ${SHAPE}
        match Shape.Circle { r: 1 } {
          Shape.Circle { r } => r
        }
      `),
    ).toThrow(ZeeError)
    expect(() =>
      execute(`
        ${SHAPE}
        match Shape.Circle { r: 1 } {
          Shape.Circle { r } => r
        }
      `),
    ).toThrow(/exhaustive/)
  })

  it('rejects an unknown variant in match', () => {
    expect(() =>
      execute(`
        ${SHAPE}
        match Shape.Circle { r: 1 } {
          Shape.Circle { r } => r
          Shape.Triangle { r } => r
        }
      `),
    ).toThrow(/variant|unknown/)
  })

  it('allows _ on a sealed match', () => {
    expect(
      execute(`
        ${SHAPE}
        match Shape.Rect { w: 2, h: 3 } {
          Shape.Circle { r } => r
          _ => 0
        }
      `).value,
    ).toEqual({ type: 'i32', value: 0 })
  })

  it('compares data variants by tag and fields', () => {
    expect(
      execute(`
        ${SHAPE}
        Shape.Circle { r: 3 } == Shape.Circle { r: 3 }
      `).value,
    ).toEqual({ type: 'bool', value: true })
    expect(
      execute(`
        ${SHAPE}
        Shape.Circle { r: 3 } == Shape.Circle { r: 4 }
      `).value,
    ).toEqual({ type: 'bool', value: false })
    expect(
      execute(`
        ${SHAPE}
        Shape.Circle { r: 3 } == Shape.Rect { w: 3, h: 1 }
      `).value,
    ).toEqual({ type: 'bool', value: false })
  })

  it('does not require the outer sealed type to be data in order to match', () => {
    expect(
      execute(`
        sealed struct Box {
          struct Wrap {
            const n: i32
          }
          struct Empty {
          }
        }
        match Box.Wrap { n: 7 } {
          Box.Wrap { n } => n
          Box.Empty { } => 0
        }
      `).value,
    ).toEqual({ type: 'i32', value: 7 })
  })

  it('rejects == on a sealed type whose variants are not data', () => {
    expect(() =>
      execute(`
        sealed struct Box {
          struct Wrap {
            const n: i32
          }
        }
        Box.Wrap { n: 1 } == Box.Wrap { n: 1 }
      `),
    ).toThrow(/not defined/)
  })

  it('rejects === on a sealed struct', () => {
    expect(() =>
      execute(`
        sealed struct Shape {
          data struct Circle {
            const r: i32
          }
        }
        Shape.Circle { r: 1 } === Shape.Circle { r: 1 }
      `),
    ).toThrow(/class/)
  })

  it('lets an importer construct and match pub sealed variants', () => {
    const created = createProject({ name: 'sealedvis', parentDir: scratch(), mode: 'new' })
    mkdirSync(join(created.root, 'src/geom'))
    writeFileSync(
      join(created.root, 'src/geom/shape.zee'),
      `pub sealed struct Shape {
  data struct Circle {
    const r: i32
  }
  data struct Rect {
    const w: i32
    const h: i32
  }
}
`,
    )
    writeFileSync(
      join(created.root, 'src/main.zee'),
      `import geom.Shape
fn main() {
  const shape = Shape.Circle { r: 3 }
  println(str(match shape {
    Shape.Circle { r } => r * r
    Shape.Rect { w, h } => w * h
  }))
}
`,
    )
    expect(executePath(created.entry).stdout).toBe('9\n')
  })
})
