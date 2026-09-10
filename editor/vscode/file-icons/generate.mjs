import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Explorer-only. UI chrome stays ink / signal / amber. */
export const PALETTE = {
  ink: '#0B0E14',
  paper: '#FAFAF8',
  muted: '#8B93A1',
  signal: '#14E0B4',
  azure: '#4C8DFF',
  violet: '#8B7CFF',
  mint: '#3DDC97',
  coral: '#FF6B6B',
  sky: '#38BDF8',
  ice: '#7DD3FC',
  orchid: '#C084FC',
  amber: '#F5A623',
  lime: '#A3E635',
  aqua: '#2EC4B6',
  pine: '#0FAE8C',
  rose: '#F472B6',
  ember: '#F97316',
  moss: '#65A30D',
  honey: '#CA8A04',
  indigo: '#6366F1',
}

/**
 * One role → two explorer icons (Z / flask+Z), still three files on disk
 * so `.spec.zee` maps without a third shape.
 * VS Code walks suffixes from the first remaining dot:
 * `users.module.spec.zee` → `module.spec.zee` → `spec.zee` → `zee`.
 * `foo_test.zee` has one dot, so it stays the generic `.zee` icon.
 */
export const KINDS = [
  { id: 'zee', color: PALETTE.signal, stem: null },
  { id: 'module', color: PALETTE.pine, stem: 'module' },
  { id: 'controller', color: PALETTE.azure, stem: 'controller' },
  { id: 'action', color: PALETTE.ember, stem: 'action' },
  { id: 'service', color: PALETTE.violet, stem: 'service' },
  { id: 'resource', color: PALETTE.aqua, stem: 'resource' },
  { id: 'repository', color: PALETTE.moss, stem: 'repository' },
  { id: 'model', color: PALETTE.honey, stem: 'model' },
  { id: 'api', color: PALETTE.indigo, stem: 'api' },
  { id: 'struct', color: PALETTE.mint, stem: 'struct' },
  { id: 'class', color: PALETTE.coral, stem: 'class' },
  { id: 'data', color: PALETTE.sky, stem: 'data' },
  { id: 'enum', color: PALETTE.orchid, stem: 'enum' },
  { id: 'interface', color: PALETTE.ice, stem: 'interface' },
  { id: 'newtype', color: PALETTE.rose, stem: 'newtype' },
  { id: 'error', color: PALETTE.amber, stem: 'error' },
]

export const VARIANTS = ['source', 'spec', 'test']

/** Syntax scopes: same hex as the file icon for that kind. */
export const SYNTAX = [
  { id: 'class', scope: 'entity.name.type.class.zee', color: PALETTE.coral },
  { id: 'struct', scope: 'entity.name.type.struct.zee', color: PALETTE.mint },
  { id: 'enum', scope: 'entity.name.type.enum.zee', color: PALETTE.orchid },
  { id: 'interface', scope: 'entity.name.type.interface.zee', color: PALETTE.ice },
  { id: 'newtype', scope: 'entity.name.type.newtype.zee', color: PALETTE.rose },
  { id: 'data', scope: 'entity.name.type.data.zee', color: PALETTE.sky },
]

export function tokenColors() {
  return [
    { scope: 'comment', settings: { foreground: PALETTE.muted } },
    { scope: 'string', settings: { foreground: '#7FD9C4' } },
    { scope: 'constant.numeric', settings: { foreground: PALETTE.ice } },
    { scope: 'keyword.declaration.zee', settings: { foreground: PALETTE.signal } },
    { scope: 'keyword.control.zee', settings: { foreground: PALETTE.signal } },
    { scope: 'keyword.control.panic.zee', settings: { foreground: PALETTE.amber } },
    { scope: 'keyword.operator.zee', settings: { foreground: PALETTE.muted } },
    { scope: 'variable.language.zee', settings: { foreground: PALETTE.muted } },
    { scope: 'constant.language.zee', settings: { foreground: PALETTE.signal } },
    { scope: 'support.type.zee', settings: { foreground: PALETTE.signal } },
    { scope: 'support.function.builtin.zee', settings: { foreground: PALETTE.violet } },
    { scope: 'entity.name.function.zee', settings: { foreground: PALETTE.azure } },
    ...SYNTAX.map((item) => ({
      scope: item.scope,
      settings: { foreground: item.color, fontStyle: 'bold' },
    })),
  ]
}

export function buildColorTheme(mode) {
  const dark = mode === 'dark'
  const bg = dark ? PALETTE.ink : PALETTE.paper
  const fg = dark ? '#F2F1ED' : PALETTE.ink
  const surface = dark ? '#141922' : '#F1EEE7'
  const border = dark ? '#232A36' : '#E1DDD3'
  return {
    name: dark ? 'Zee Dark' : 'Zee Light',
    type: dark ? 'dark' : 'light',
    colors: {
      'editor.background': bg,
      'editor.foreground': fg,
      'editorLineNumber.foreground': PALETTE.muted,
      'editorLineNumber.activeForeground': fg,
      'editorCursor.foreground': PALETTE.signal,
      'editor.selectionBackground': dark ? '#14E0B433' : '#14E0B433',
      'editor.lineHighlightBackground': dark ? '#141922' : '#F1EEE7',
      'editorError.foreground': PALETTE.amber,
      'editorWarning.foreground': PALETTE.amber,
      'focusBorder': PALETTE.signal,
      'foreground': fg,
      'sideBar.background': surface,
      'sideBar.foreground': fg,
      'sideBar.border': border,
      'activityBar.background': bg,
      'activityBar.foreground': PALETTE.signal,
      'activityBar.inactiveForeground': PALETTE.muted,
      'statusBar.background': bg,
      'statusBar.foreground': fg,
      'statusBar.debuggingBackground': PALETTE.amber,
      'statusBar.debuggingForeground': PALETTE.ink,
      'titleBar.activeBackground': bg,
      'titleBar.activeForeground': fg,
      'tab.activeBackground': bg,
      'tab.inactiveBackground': surface,
      'tab.activeForeground': fg,
      'tab.inactiveForeground': PALETTE.muted,
      'tab.border': border,
      'panel.background': bg,
      'panel.border': border,
      'terminal.background': bg,
      'terminal.foreground': fg,
      'list.activeSelectionBackground': dark ? '#14E0B422' : '#14E0B433',
      'list.activeSelectionForeground': fg,
      'list.hoverBackground': dark ? '#141922' : '#F1EEE7',
      'input.background': surface,
      'input.border': border,
      'button.background': PALETTE.signal,
      'button.foreground': PALETTE.ink,
      'badge.background': PALETTE.signal,
      'badge.foreground': PALETTE.ink,
    },
    tokenColors: tokenColors(),
  }
}

export function iconFileName(kindId, variant) {
  if (variant === 'source') return `zee-${kindId}.z.svg`
  return `zee-${kindId}-${variant}.svg`
}

const GLYPHS = {
  module: `<rect x="3.5" y="3.5" width="17" height="17" rx="3.5"/>
    <circle cx="8.5" cy="8.5" r="1.3" fill="COLOR" stroke="none"/>
    <circle cx="15.5" cy="8.5" r="1.3" fill="COLOR" stroke="none"/>
    <circle cx="12" cy="15.5" r="1.3" fill="COLOR" stroke="none"/>
    <line x1="8.5" y1="8.5" x2="12" y2="15.5"/>
    <line x1="15.5" y1="8.5" x2="12" y2="15.5"/>`,
  controller: `<rect x="7" y="6" width="10" height="12" rx="2"/>
    <path d="M2.2 12 H7"/>
    <path d="M17 12 H21.8"/>
    <path d="M4.6 9.6 L2.2 12 L4.6 14.4"/>
    <path d="M19.4 9.6 L21.8 12 L19.4 14.4"/>`,
  action: `<path d="M13.2 3.8 L6.2 13.2 H11.4 L10.8 20.2 L17.8 10.8 H12.6 Z"/>`,
  service: `<polygon points="12,4 19,8 19,16 12,20 5,16 5,8"/>
    <circle cx="12" cy="12" r="2.1" fill="COLOR" stroke="none"/>`,
  resource: `<rect x="4" y="4" width="16" height="16" rx="3"/>
    <line x1="7" y1="9" x2="17" y2="9"/>
    <line x1="7" y1="12.5" x2="17" y2="12.5"/>
    <line x1="7" y1="16" x2="13" y2="16"/>`,
  repository: `<ellipse cx="12" cy="6.2" rx="7.2" ry="2.6"/>
    <path d="M4.8 6.2 V17.6 C4.8 19 8 20.4 12 20.4 C16 20.4 19.2 19 19.2 17.6 V6.2"/>
    <path d="M4.8 12 C4.8 13.4 8 14.8 12 14.8 C16 14.8 19.2 13.4 19.2 12"/>`,
  model: `<rect x="4" y="5" width="16" height="14" rx="1.6"/>
    <line x1="4" y1="9.2" x2="20" y2="9.2"/>
    <line x1="4" y1="13.4" x2="20" y2="13.4"/>
    <line x1="10" y1="5" x2="10" y2="19"/>`,
  api: `<circle cx="7.5" cy="12" r="3.1"/>
    <path d="M10.6 12 H19.4"/>
    <path d="M16.6 8.8 L20.2 12 L16.6 15.2"/>`,
  struct: `<rect x="4" y="4" width="16" height="16" rx="2.5"/>
    <line x1="4" y1="9" x2="20" y2="9"/>
    <line x1="7.5" y1="13" x2="16.5" y2="13"/>
    <line x1="7.5" y1="16.5" x2="14" y2="16.5"/>`,
  class: `<rect x="5" y="5" width="11" height="11" rx="2"/>
    <rect x="8" y="8" width="11" height="11" rx="2"/>`,
  data: `<rect x="3.5" y="6" width="13" height="13" rx="2"/>
    <rect x="7.5" y="3.5" width="13" height="13" rx="2"/>`,
  enum: `<rect x="6.5" y="4" width="12" height="4.3" rx="2"/>
    <rect x="6.5" y="9.85" width="12" height="4.3" rx="2" fill="COLOR" fill-opacity="0.18"/>
    <rect x="6.5" y="15.7" width="12" height="4.3" rx="2"/>`,
  interface: `<rect x="4" y="4" width="16" height="16" rx="3" stroke-dasharray="3 2.6"/>
    <line x1="20" y1="12" x2="22.2" y2="12"/>
    <circle cx="22.4" cy="12" r="1.1" fill="COLOR" stroke="none"/>`,
  newtype: `<rect x="4" y="6" width="11" height="12" rx="2"/>
    <rect x="9" y="6" width="11" height="12" rx="2"/>`,
  error: `<path d="M12 3.5 L21 20.2 H3 Z"/>
    <line x1="12" y1="9" x2="12" y2="14.2"/>
    <circle cx="12" cy="17.2" r="0.9" fill="COLOR" stroke="none"/>`,
  toml: `<circle cx="12" cy="12" r="7.2"/>
    <circle cx="12" cy="12" r="2.4" fill="COLOR" stroke="none"/>
    <line x1="12" y1="4.8" x2="12" y2="7.2"/>
    <line x1="12" y1="16.8" x2="12" y2="19.2"/>
    <line x1="4.8" y1="12" x2="7.2" y2="12"/>
    <line x1="16.8" y1="12" x2="19.2" y2="12"/>`,
  env: `<circle cx="8.2" cy="12" r="3.1"/>
    <path d="M11.2 12 H19.5"/>
    <path d="M16.4 9.4 V14.6"/>
    <path d="M19.5 10.2 V13.8"/>`,
  gitignore: `<circle cx="8.5" cy="16.5" r="2.4"/>
    <circle cx="8.5" cy="7.5" r="2.4"/>
    <circle cx="16.5" cy="12" r="2.4"/>
    <line x1="8.5" y1="9.9" x2="8.5" y2="14.1"/>
    <line x1="10.4" y1="8.4" x2="14.4" y2="10.8"/>
    <line x1="10.4" y1="15.6" x2="14.4" y2="13.2"/>`,
  lock: `<rect x="7" y="11" width="10" height="8.5" rx="1.6"/>
    <path d="M9.2 11 V8.6 A2.8 2.8 0 0 1 14.8 8.6 V11"/>`,
  json: `<path d="M9 6 C6.5 6 6.5 12 9 12 C6.5 12 6.5 18 9 18"/>
    <path d="M15 6 C17.5 6 17.5 12 15 12 C17.5 12 17.5 18 15 18"/>`,
  md: `<line x1="6.5" y1="8" x2="17.5" y2="9"/>
    <line x1="6.5" y1="12" x2="17.5" y2="12"/>
    <line x1="6.5" y1="16" x2="14" y2="16"/>`,
}

function zMark(color, compact) {
  const transform = compact
    ? 'translate(8.6,10.2) scale(0.11)'
    : 'translate(12,12) scale(0.24) translate(-50,-50)'
  return `<g transform="${transform}"><path d="M24,26 L76,26 L24,74 L76,74" stroke="${color}" stroke-width="16" stroke-linecap="square" stroke-linejoin="miter" fill="none"/></g>`
}

function glyphMarkup(kindId, color, compact) {
  if (kindId === 'file') return ''
  if (kindId === 'zee' || kindId === 'main') return zMark(color, compact)
  const raw = GLYPHS[kindId]
  if (!raw) throw new Error(`missing glyph ${kindId}`)
  const transform = compact ? 'transform="translate(6.4,8.6) scale(0.48)" ' : ''
  return `<g ${transform}fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${raw.replaceAll('COLOR', color)}</g>`
}

function leafMarkup(color) {
  return `  <path d="M6 2 H14.5 L19 6.5 V21 A1 1 0 0 1 18 22 H6 A1 1 0 0 1 5 21 V3 A1 1 0 0 1 6 2 Z" fill="${color}" fill-opacity="0.16" stroke="${color}" stroke-width="1.4"/>
  <path d="M14.5 2 V6.5 H19 Z" fill="${color}" fill-opacity="0.4" stroke="${color}" stroke-width="1.4" stroke-linejoin="round"/>`
}

function specBadge() {
  return `<circle cx="18" cy="19" r="4.2" fill="${PALETTE.paper}"/>
  <circle cx="18" cy="19" r="3.9" fill="${PALETTE.signal}"/>
  <path d="M16.2 19 L17.4 20.3 L19.9 17.5" stroke="${PALETTE.ink}" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
}

function testBadge() {
  return `<circle cx="18" cy="19" r="4.2" fill="${PALETTE.paper}"/>
  <circle cx="18" cy="19" r="3.9" fill="${PALETTE.lime}"/>
  <path d="M16.5 17.5 h3.1 M18 17.5 v3.4" stroke="${PALETTE.ink}" stroke-width="1.35" fill="none" stroke-linecap="round"/>`
}

/** Catppuccin typescript-test: flask + language mark. Ours is flask + Z. */
function flaskWithZ(color) {
  return `  <g transform="translate(0.35,0.15) scale(1.18)" fill="none" stroke="${color}" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round">
    <path d="M9.5.5 l6 6"/>
    <path d="M12 7.5 H5"/>
    <path d="M10.22 1.75 l-8.49 8.48 a2.5 2.5 0 1 0 3.54 3.54 L6.05 13.05"/>
    <path d="M12.05 7.05 L13.78 5.32"/>
  </g>
  <g transform="translate(18.15,18.05) scale(0.132) translate(-50,-50)">
    <path d="M24,26 L76,26 L24,74 L76,74" stroke="${color}" stroke-width="16" stroke-linecap="square" stroke-linejoin="miter" fill="none"/>
  </g>`
}

export function svgFor(kindId, color, variant, style = 'glyph') {
  if (style === 'glyph' && kindId !== 'file') {
    const inner = variant === 'test' ? flaskWithZ(color) : `  ${zMark(color, false)}`
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
${inner}
</svg>
`
  }
  const badge = variant === 'spec' ? specBadge() : variant === 'test' ? testBadge() : ''
  const body =
    style === 'page' || kindId === 'file'
      ? `${leafMarkup(color)}
  ${glyphMarkup(kindId, color, true)}`
      : `  ${glyphMarkup(kindId, color, false)}`
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
${body}
  ${badge}
</svg>
`
}

function folderSvg(open, iconsDir) {
  const mocha = join(iconsDir, 'catppuccin/mocha')
  const baseName = open ? '_folder_open.svg' : '_folder.svg'
  const base = readFileSync(join(mocha, baseName), 'utf8')
  const z = `	<g transform="translate(11.5,12) scale(0.125) translate(-50,-50)">
		<path d="M24,26 L76,26 L24,74 L76,74" stroke="${PALETTE.signal}" stroke-width="16" stroke-linecap="square" stroke-linejoin="miter" fill="none"/>
	</g>
`
  return base.replace(/<\/svg>\s*$/, `${z}</svg>\n`)
}

export function buildTheme() {
  const here = dirname(fileURLToPath(import.meta.url))
  const catppuccin = catppuccinLayer(here)
  const iconDefinitions = {
    ...catppuccin.iconDefinitions,
    _zee_folder: { iconPath: './zee-folder.svg' },
    _zee_folder_open: { iconPath: './zee-folder-open.svg' },
    _zee_toml: { iconPath: './zee-toml.svg' },
    _zee_main: { iconPath: './zee-main.svg' },
    _zee_main_spec: { iconPath: './zee-main-spec.svg' },
    _zee_main_test: { iconPath: './zee-main-test.svg' },
    _file: { iconPath: './zee-file.svg' },
    _lock: { iconPath: './zee-lock.svg' },
  }
  const fileExtensions = { ...catppuccin.fileExtensions }
  for (const kind of KINDS) {
    iconDefinitions[`_${kind.id}`] = { iconPath: `./${iconFileName(kind.id, 'source')}` }
    iconDefinitions[`_${kind.id}_spec`] = { iconPath: `./${iconFileName(kind.id, 'spec')}` }
    iconDefinitions[`_${kind.id}_test`] = { iconPath: `./${iconFileName(kind.id, 'test')}` }
    if (kind.stem === null) {
      fileExtensions.zee = '_zee'
      fileExtensions['spec.zee'] = '_zee_spec'
      fileExtensions['test.zee'] = '_zee_test'
    } else {
      fileExtensions[`${kind.stem}.zee`] = `_${kind.id}`
      fileExtensions[`${kind.stem}.spec.zee`] = `_${kind.id}_spec`
      fileExtensions[`${kind.stem}.test.zee`] = `_${kind.id}_test`
    }
  }
  const fileNames = {
    ...catppuccin.fileNames,
    'main.zee': '_zee_main',
    'main.spec.zee': '_zee_main_spec',
    'main.test.zee': '_zee_main_test',
    'zee.toml': '_zee_toml',
    'libs.toml': '_zee_toml',
    'zee.lock': '_lock',
  }
  if (!fileNames['.env'] && iconDefinitions._c_env) fileNames['.env'] = '_c_env'
  const languageIds = { ...catppuccin.languageIds }
  delete languageIds.zee
  return {
    iconDefinitions,
    fileNames,
    fileExtensions,
    languageIds,
    folderNames: { ...catppuccin.folderNames, '.zee': '_zee_folder' },
    folderNamesExpanded: { ...catppuccin.folderNamesExpanded, '.zee': '_zee_folder_open' },
    file: iconDefinitions._c_file ? '_c_file' : '_file',
    folder: iconDefinitions._c_folder ? '_c_folder' : '_zee_folder',
    folderExpanded: iconDefinitions._c_folder_open ? '_c_folder_open' : '_zee_folder_open',
    rootFolder: iconDefinitions._c_root ? '_c_root' : '_zee_folder',
    rootFolderExpanded: iconDefinitions._c_root_open ? '_c_root_open' : '_zee_folder_open',
  }
}

function catppuccinLayer(iconsDir) {
  const assocPath = join(iconsDir, 'catppuccin/associations.json')
  const mochaDir = join(iconsDir, 'catppuccin/mocha')
  if (!existsSync(assocPath) || !existsSync(mochaDir)) {
    return {
      iconDefinitions: {},
      fileExtensions: {},
      fileNames: {},
      languageIds: {},
      folderNames: {},
      folderNamesExpanded: {},
    }
  }
  const assoc = JSON.parse(readFileSync(assocPath, 'utf8'))
  const iconDefinitions = {}
  for (const file of readdirSync(mochaDir)) {
    if (!file.endsWith('.svg')) continue
    const id = file.slice(0, -4)
    iconDefinitions[`_c_${id}`] = { iconPath: `./catppuccin/mocha/${file}` }
  }
  for (const [alias, fileId] of [
    ['file', '_file'],
    ['folder', '_folder'],
    ['folder_open', '_folder_open'],
    ['root', '_root'],
    ['root_open', '_root_open'],
  ]) {
    const def = iconDefinitions[`_c_${fileId}`]
    if (def) iconDefinitions[`_c_${alias}`] = def
  }
  const fileExtensions = {}
  for (const [ext, name] of Object.entries(assoc.fileExtensions ?? {})) {
    fileExtensions[ext] = `_c_${name}`
  }
  const fileNames = {}
  for (const [name, icon] of Object.entries(assoc.fileNames ?? {})) {
    fileNames[name] = `_c_${icon}`
  }
  const languageIds = {}
  for (const [id, icon] of Object.entries(assoc.languageIds ?? {})) {
    languageIds[id] = `_c_${icon}`
  }
  const folderNames = {}
  const folderNamesExpanded = {}
  for (const [folder, icon] of Object.entries(assoc.folderNames ?? {})) {
    folderNames[folder] = `_c_${icon}`
    folderNamesExpanded[folder] = `_c_${icon}_open`
  }
  return { iconDefinitions, fileExtensions, fileNames, languageIds, folderNames, folderNamesExpanded }
}

function writeIconSet(dir, style) {
  mkdirSync(dir, { recursive: true })
  for (const kind of KINDS) {
    for (const variant of VARIANTS) {
      writeFileSync(join(dir, iconFileName(kind.id, variant)), svgFor(kind.id, kind.color, variant, style))
    }
  }
  writeFileSync(join(dir, 'zee-main.svg'), svgFor('main', PALETTE.signal, 'source', style))
  writeFileSync(join(dir, 'zee-main-spec.svg'), svgFor('main', PALETTE.signal, 'spec', style))
  writeFileSync(join(dir, 'zee-main-test.svg'), svgFor('main', PALETTE.signal, 'test', style))
  writeFileSync(join(dir, 'zee-toml.svg'), svgFor('toml', PALETTE.muted, 'source', style))
  writeFileSync(join(dir, 'zee-file.svg'), svgFor('file', PALETTE.muted, 'source', style))
  writeFileSync(join(dir, 'zee-env.svg'), svgFor('env', PALETTE.lime, 'source', style))
  writeFileSync(join(dir, 'zee-gitignore.svg'), svgFor('gitignore', PALETTE.coral, 'source', style))
  writeFileSync(join(dir, 'zee-lock.svg'), svgFor('lock', PALETTE.amber, 'source', style))
  writeFileSync(join(dir, 'zee-json.svg'), svgFor('json', PALETTE.amber, 'source', style))
  writeFileSync(join(dir, 'zee-md.svg'), svgFor('md', PALETTE.azure, 'source', style))
}

function removeStaleGlyphs(dir) {
  for (const kind of KINDS) {
    const stale = join(dir, `zee-${kind.id}.svg`)
    if (existsSync(stale)) unlinkSync(stale)
  }
}

export function generate(outDir = dirname(fileURLToPath(import.meta.url))) {
  writeIconSet(outDir, 'glyph')
  removeStaleGlyphs(outDir)
  writeIconSet(join(outDir, 'page'), 'page')
  writeFileSync(join(outDir, 'zee-folder.svg'), folderSvg(false, outDir))
  writeFileSync(join(outDir, 'zee-folder-open.svg'), folderSvg(true, outDir))
  writeFileSync(join(outDir, 'zee-icon-theme.json'), `${JSON.stringify(buildTheme(), null, 2)}\n`)
  const themesDir = join(outDir, '../themes')
  mkdirSync(themesDir, { recursive: true })
  writeFileSync(join(themesDir, 'zee-dark.json'), `${JSON.stringify(buildColorTheme('dark'), null, 2)}\n`)
  writeFileSync(join(themesDir, 'zee-light.json'), `${JSON.stringify(buildColorTheme('light'), null, 2)}\n`)
}

const invoked = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (invoked) generate()
