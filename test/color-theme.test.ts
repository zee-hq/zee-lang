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
