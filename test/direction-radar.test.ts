import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const direction = readFileSync(join(import.meta.dirname, '../docs/DIRECTION.md'), 'utf8')

describe('radar §9 closed (ZEE-13)', () => {
  it('records stand-in construction and hand-wired main as the language', () => {
    expect(direction).toMatch(/33\.\s+\*\*Construction\*\*/)
    expect(direction).toMatch(/34\.\s+\*\*Composition\*\*/)
    expect(direction).toContain('## 9. Radar (closed)')
    expect(direction).not.toContain('## 9. Radar (not closed)')
    expect(direction).toContain('No `new`')
    expect(direction).toContain('No `@Inject`')
    expect(direction).toContain('`main` is the composition root')
  })

  it('defines the collection and emptiness catalogs without a second grammar', () => {
    expect(direction).toMatch(/35\.\s+\*\*Collection methods\*\*/)
    expect(direction).toMatch(/36\.\s+\*\*Emptiness\*\*/)
    expect(direction).toContain('### 8f. Collection methods')
    expect(direction).toContain('### 8g. Emptiness, blank, none')
    expect(direction).toContain('`forEach`')
    expect(direction).toContain('`any`')
    expect(direction).toContain('`isEmpty`')
    expect(direction).toMatch(/37\.\s+\*\*Project kinds\*\*/)
    expect(direction).toContain('--kind bin|api|web|monolith|service')
    expect(direction).toMatch(/38\.\s+\*\*JSON\*\*/)
    expect(direction).toContain('json.encode')
    expect(direction).toContain('json.decode')
  })
})
