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
      'action',
      'service',
      'resource',
      'repository',
      'model',
      'api',
      'struct',
      'class',
      'data',
      'enum',
      'interface',
      'newtype',
      'error',
    ])
  })

  it('maps layer and type-role suffixes, plus spec/test compounds', () => {
    expect(theme.fileExtensions['module.zee']).toBe('_module')
    expect(theme.fileExtensions['module.spec.zee']).toBe('_module_spec')
    expect(theme.fileExtensions['module.test.zee']).toBe('_module_test')
    expect(theme.fileExtensions['controller.zee']).toBe('_controller')
    expect(theme.fileExtensions['action.zee']).toBe('_action')
    expect(theme.fileExtensions['service.zee']).toBe('_service')
    expect(theme.iconDefinitions._service.iconPath).toBe('./zee-service.z.svg')
    expect(theme.fileExtensions['repository.zee']).toBe('_repository')
    expect(theme.fileExtensions['model.zee']).toBe('_model')
    expect(theme.fileExtensions['api.zee']).toBe('_api')
    expect(theme.fileExtensions['class.zee']).toBe('_class')
    expect(theme.fileExtensions['class.spec.zee']).toBe('_class_spec')
    expect(theme.fileExtensions['struct.test.zee']).toBe('_struct_test')
    expect(theme.fileExtensions['spec.zee']).toBe('_zee_spec')
    expect(theme.fileExtensions['test.zee']).toBe('_zee_test')
    expect(theme.fileNames['main.zee']).toBe('_zee_main')
    expect(theme.fileNames['main.test.zee']).toBe('_zee_main_test')
    expect(theme.fileNames['zee.toml']).toBe('_zee_toml')
    // languageIds for Zee would paint every .zee as generic Z and hide role colors (AC-file-icons).
    expect(theme.languageIds?.zee).toBeUndefined()
    expect(buildTheme().languageIds?.zee).toBeUndefined()
  })

  it('uses Catppuccin mocha icons for other languages (AC-file-icons-catppuccin)', () => {
    expect(theme.fileExtensions.ts).toBe('_c_typescript')
    expect(theme.fileExtensions.js).toBe('_c_javascript')
    expect(theme.fileExtensions.py).toBe('_c_python')
    expect(theme.fileExtensions.rs).toBe('_c_rust')
    expect(theme.fileExtensions.go).toBe('_c_go')
    expect(theme.languageIds.typescript).toBe('_c_typescript')
    expect(theme.iconDefinitions._c_typescript.iconPath).toBe('./catppuccin/mocha/typescript.svg')
    expect(existsSync(join(iconsDir, 'catppuccin/mocha/typescript.svg'))).toBe(true)
    expect(existsSync(join(iconsDir, 'catppuccin/LICENSE'))).toBe(true)
    expect(theme.fileExtensions['controller.zee']).toBe('_controller')
    expect(theme.fileNames['zee.toml']).toBe('_zee_toml')
  })

  it('keeps icons for non-Zee files a Zee project always has (AC-file-icons)', () => {
    expect(theme.fileNames['libs.toml']).toBe('_zee_toml')
    expect(theme.fileNames['zee.lock']).toBe('_lock')
    expect(theme.fileNames['.gitignore']).toBe('_c_git')
    expect(theme.fileExtensions.json).toBe('_c_json')
    expect(theme.fileExtensions.md).toBe('_c_markdown')
    expect(buildTheme().fileNames['.gitignore']).toBe('_c_git')
  })

  it('keeps source and spec as a colored Z, tests as flask+Z (AC-file-icons-z)', () => {
    const z = 'M24,26 L76,26 L24,74 L76,74'
    const flask = 'l-8.49 8.48'
    for (const kind of KINDS) {
      const source = readFileSync(join(iconsDir, iconFileName(kind.id, 'source')), 'utf8')
      const spec = readFileSync(join(iconsDir, iconFileName(kind.id, 'spec')), 'utf8')
      const test = readFileSync(join(iconsDir, iconFileName(kind.id, 'test')), 'utf8')
      expect(source).toContain(kind.color)
      expect(source).toContain(z)
      expect(source).not.toContain(flask)
      expect(spec).toBe(source)
      expect(test).toContain(kind.color)
      expect(test).toContain(flask)
      expect(test).toContain(z)
      expect(source).not.toContain(PALETTE.lime)
    }
  })

  it('paints test files as a flask with a Z, like Catppuccin typescript-test (AC-file-icons-test-flask)', () => {
    const flask = 'l-8.49 8.48'
    const z = 'M24,26 L76,26 L24,74 L76,74'
    const generic = readFileSync(join(iconsDir, 'zee-zee-test.svg'), 'utf8')
    expect(generic).toContain(PALETTE.signal)
    expect(generic).toContain(flask)
    expect(generic).toContain(z)
    const controller = readFileSync(join(iconsDir, 'zee-controller-test.svg'), 'utf8')
    expect(controller).toContain(PALETTE.azure)
    expect(controller).toContain(flask)
    const archived = readFileSync(join(iconsDir, 'page/zee-zee-test.svg'), 'utf8')
    expect(archived).toContain('M16.5 17.5 h3.1 M18 17.5 v3.4')
  })

  it('keeps unique role glyphs only in the archived page set (AC-file-icons-glyph)', () => {
    const leaf = 'M6 2 H14.5 L19 6.5'
    const z = 'M24,26 L76,26 L24,74 L76,74'
    const controller = readFileSync(join(iconsDir, iconFileName('controller', 'source')), 'utf8')
    expect(controller).not.toContain(leaf)
    expect(controller).toContain(z)
    expect(controller).not.toContain('M2.2 12 H7')
    const archived = readFileSync(join(iconsDir, 'page/zee-controller.svg'), 'utf8')
    expect(archived).toContain(leaf)
    expect(archived).toContain('M2.2 12 H7')
    expect(existsSync(join(iconsDir, 'page/zee-action.svg'))).toBe(true)
  })

  it('uses Catppuccin folders by default and a signal Z on .zee (AC-file-icons-folder)', () => {
    expect(theme.folder).toBe('_c_folder')
    expect(theme.folderExpanded).toBe('_c_folder_open')
    expect(theme.rootFolder).toBe('_c_root')
    expect(theme.rootFolderExpanded).toBe('_c_root_open')
    expect(theme.folderNames['.zee']).toBe('_zee_folder')
    expect(theme.folderNamesExpanded['.zee']).toBe('_zee_folder_open')
    expect(theme.iconDefinitions._c_folder.iconPath).toBe('./catppuccin/mocha/_folder.svg')
    const closed = readFileSync(join(iconsDir, 'zee-folder.svg'), 'utf8')
    const opened = readFileSync(join(iconsDir, 'zee-folder-open.svg'), 'utf8')
    for (const svg of [closed, opened]) {
      expect(svg).toContain('#cdd6f4')
      expect(svg).toContain(PALETTE.signal)
      expect(svg).toContain('M24,26 L76,26 L24,74 L76,74')
      expect(svg).toContain('scale(0.125)')
    }
    expect(closed).toContain('M4.5 4.5H12')
    expect(opened).toContain('m1.87 8')
  })

  it('ships every iconPath in the theme', () => {
    expect(buildTheme().fileExtensions).toEqual(theme.fileExtensions)
    for (const def of Object.values(theme.iconDefinitions)) {
      expect(existsSync(join(iconsDir, def.iconPath))).toBe(true)
    }
  })
})
