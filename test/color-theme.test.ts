import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { KINDS, PALETTE, SYNTAX, tokenColors } from '../editor/vscode/file-icons/generate.mjs'

const editorRoot = join(import.meta.dirname, '../editor/vscode')
const grammar = JSON.parse(readFileSync(join(editorRoot, 'syntaxes/zee.tmLanguage.json'), 'utf8'))
const dark = JSON.parse(readFileSync(join(editorRoot, 'themes/zee-dark.json'), 'utf8'))
const light = JSON.parse(readFileSync(join(editorRoot, 'themes/zee-light.json'), 'utf8'))
const manifest = JSON.parse(readFileSync(join(editorRoot, 'package.json'), 'utf8'))

describe('Zee color theme', () => {
  it('paints each type name with the same hex as that file icon', () => {
    for (const item of SYNTAX) {
      const kind = KINDS.find((entry) => entry.id === item.id)
      expect(kind, item.id).toBeDefined()
      if (!kind) continue
      expect(item.color).toBe(kind.color)
      expect(JSON.stringify(grammar)).toContain(item.scope)
      const rule = tokenColors().find((rule) => rule.scope === item.scope)
      expect(rule?.settings.foreground).toBe(item.color)
    }
  })

  it('uses coral for class names', () => {
    expect(SYNTAX.find((item) => item.id === 'class')?.color).toBe(PALETTE.coral)
    expect(PALETTE.coral).toBe('#FF6B6B')
  })

  it('paints PascalCase type uses, not only declarations (AC-theme-type-uses)', () => {
    const includes = grammar.patterns.map((pattern: { include: string }) => pattern.include)
    expect(includes).toContain('#typeUses')
    expect(includes.indexOf('#types')).toBeLessThan(includes.indexOf('#typeUses'))
    expect(includes.indexOf('#typeUses')).toBeLessThan(includes.indexOf('#functionCalls'))
    expect(grammar.repository.typeUses.name).toBe('entity.name.type.zee')
    expect(grammar.repository.typeUses.match).toContain('[A-Z]')
    const use = tokenColors().find((rule) => rule.scope === 'entity.name.type.zee')
    const classDecl = tokenColors().find((rule) => rule.scope === 'entity.name.type.class.zee')
    expect(use?.settings.foreground).toBe(PALETTE.coral)
    expect(classDecl?.settings.foreground).toBe(PALETTE.coral)
  })

  it('paints self gray against identifier white (AC-theme-self)', () => {
    expect(grammar.repository.keywords.patterns.some((p: { name?: string }) => p.name === 'variable.language.zee')).toBe(
      true,
    )
    const selfRule = tokenColors().find((rule) => rule.scope === 'variable.language.zee')
    expect(selfRule?.settings.foreground).toBe(PALETTE.dim)
    expect(PALETTE.dim).not.toBe(dark.colors['editor.foreground'])
    expect(PALETTE.dim).toBe('#6B7380')
  })

  it('paints host builtins violet, distinct from user functions (AC-theme-builtins)', () => {
    const includes = grammar.patterns.map((pattern: { include: string }) => pattern.include)
    expect(includes).toContain('#builtins')
    expect(includes).toContain('#functionCalls')
    expect(includes.indexOf('#types')).toBeLessThan(includes.indexOf('#functionCalls'))
    expect(includes.indexOf('#builtins')).toBeLessThan(includes.indexOf('#functionCalls'))
    expect(grammar.repository.builtins.name).toBe('support.function.builtin.zee')
    expect(grammar.repository.functionCalls.name).toBe('entity.name.function.zee')
    expect(grammar.repository.functionCalls.match).toContain('(?=\\()')
    for (const name of ['print', 'println', 'printf', 'sprintf', 'str', 'error', 'getenv', 'envProfile', 'envAppMeta']) {
      expect(grammar.repository.builtins.match, `missing builtin ${name}`).toContain(name)
    }
    const builtin = tokenColors().find((rule) => rule.scope === 'support.function.builtin.zee')
    const userFn = tokenColors().find((rule) => rule.scope === 'entity.name.function.zee')
    expect(builtin?.settings.foreground).toBe(PALETTE.violet)
    expect(userFn?.settings.foreground).toBe(PALETTE.azure)
    expect(builtin?.settings.foreground).not.toBe(userFn?.settings.foreground)
  })

  it('ships dark (ink) and light (paper) with the same token colors', () => {
    expect(dark.colors['editor.background']).toBe(PALETTE.ink)
    expect(light.colors['editor.background']).toBe(PALETTE.paper)
    expect(dark.tokenColors).toEqual(tokenColors())
    expect(light.tokenColors).toEqual(tokenColors())
    expect(dark.colors['editorError.foreground']).toBe(PALETTE.amber)
    expect(existsSync(join(editorRoot, 'themes/zee-dark.json'))).toBe(true)
    expect(manifest.contributes.themes).toEqual([
      {
        id: 'Zee Dark',
        label: 'Zee Dark',
        uiTheme: 'vs-dark',
        path: './themes/zee-dark.json',
      },
      {
        id: 'Zee Light',
        label: 'Zee Light',
        uiTheme: 'vs',
        path: './themes/zee-light.json',
      },
    ])
  })
})
