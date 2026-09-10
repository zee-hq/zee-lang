import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  KINDS,
  PALETTE,
  VARIANTS,
  buildTheme,
  iconFileName,
} from '../editor/vscode/file-icons/generate.mjs'

const iconsDir = join(import.meta.dirname, '../editor/vscode/file-icons')
const theme = JSON.parse(readFileSync(join(iconsDir, 'zee-icon-theme.json'), 'utf8'))

describe('file icon kinds', () => {
  it('gives every role a unique color and source/spec/test variants', () => {
    const colors = KINDS.map((kind) => kind.color)
    expect(new Set(colors).size).toBe(KINDS.length)
    expect(VARIANTS).toEqual(['source', 'spec', 'test'])
    expect(KINDS.map((kind) => kind.id)).toEqual([
      'zee',
      'module',
      'controller',
      'service',
      'resource',
      'struct',
      'class',
      'data',
      'enum',
      'interface',
      'newtype',
      'error',
    ])
  })

  it('maps Nest-style and type-role suffixes, plus spec/test compounds', () => {
    expect(theme.fileExtensions['module.zee']).toBe('_module')
    expect(theme.fileExtensions['module.spec.zee']).toBe('_module_spec')
    expect(theme.fileExtensions['module.test.zee']).toBe('_module_test')
    expect(theme.fileExtensions['controller.zee']).toBe('_controller')
    expect(theme.fileExtensions['class.zee']).toBe('_class')
    expect(theme.fileExtensions['class.spec.zee']).toBe('_class_spec')
    expect(theme.fileExtensions['struct.test.zee']).toBe('_struct_test')
    expect(theme.fileExtensions['spec.zee']).toBe('_zee_spec')
    expect(theme.fileExtensions['test.zee']).toBe('_zee_test')
    expect(theme.fileNames['main.zee']).toBe('_zee_main')
    expect(theme.fileNames['main.test.zee']).toBe('_zee_main_test')
    expect(theme.fileNames['zee.toml']).toBe('_zee_toml')
    // languageIds would paint every .zee as generic Z and hide role colors (AC-file-icons).
    expect(theme.languageIds).toBeUndefined()
    expect(buildTheme().languageIds).toBeUndefined()
  })

  it('keeps icons for non-Zee files a Zee project always has (AC-file-icons)', () => {
    expect(theme.file).toBe('_file')
    expect(theme.fileNames['.env']).toBe('_env')
    expect(theme.fileNames['.env.local']).toBe('_env')
    expect(theme.fileNames['.gitignore']).toBe('_gitignore')
    expect(theme.fileNames['libs.toml']).toBe('_zee_toml')
    expect(theme.fileNames['zee.lock']).toBe('_lock')
    expect(theme.fileExtensions.toml).toBe('_zee_toml')
    expect(theme.fileExtensions.json).toBe('_json')
    expect(theme.fileExtensions.md).toBe('_md')
    expect(theme.fileExtensions.lock).toBe('_lock')
    expect(buildTheme().file).toBe('_file')
    expect(buildTheme().fileNames['.gitignore']).toBe('_gitignore')
  })

  it('keeps source glyphs in the kind color, spec teal-checked, test lime-T', () => {
    for (const kind of KINDS) {
      const source = readFileSync(join(iconsDir, iconFileName(kind.id, 'source')), 'utf8')
      const spec = readFileSync(join(iconsDir, iconFileName(kind.id, 'spec')), 'utf8')
      const test = readFileSync(join(iconsDir, iconFileName(kind.id, 'test')), 'utf8')
      expect(source).toContain(kind.color)
      expect(spec).toContain(kind.color)
      expect(spec).toContain(PALETTE.signal)
      expect(spec).toContain('M16.2 19 L17.4 20.3 L19.9 17.5')
      expect(test).toContain(kind.color)
      expect(test).toContain(PALETTE.lime)
      expect(test).toContain('M16.5 17.5 h3.1 M18 17.5 v3.4')
      expect(source).not.toContain(PALETTE.lime)
    }
  })

  it('ships every iconPath in the theme', () => {
    expect(buildTheme().fileExtensions).toEqual(theme.fileExtensions)
    for (const def of Object.values(theme.iconDefinitions)) {
      expect(existsSync(join(iconsDir, def.iconPath))).toBe(true)
    }
  })
})
