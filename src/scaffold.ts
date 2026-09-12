import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ZeeError } from './error.ts'
import { generateFeature, generateModule } from './generate.ts'

export const PROJECT_KINDS = ['bin', 'api', 'web', 'monolith', 'service'] as const

export type ProjectKind = (typeof PROJECT_KINDS)[number]

export interface CreateArgv {
  name?: string
  kind: ProjectKind
}

const KIND_SET = new Set<string>(PROJECT_KINDS)

export function parseProjectKind(raw: string): ProjectKind {
  if (!KIND_SET.has(raw)) {
    throw new ZeeError(
      `unknown --kind \`${raw}\` (use ${PROJECT_KINDS.join(', ')})`,
      1,
      1,
      'zee',
    )
  }
  return raw as ProjectKind
}

/** `zee new` / `zee init` argv after the command. */
export function parseCreateArgv(argv: string[]): CreateArgv {
  let kind: ProjectKind = 'bin'
  let name: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--kind') {
      const value = argv[++i]
      if (!value) throw new ZeeError('missing value for --kind', 1, 1, 'zee')
      kind = parseProjectKind(value)
      continue
    }
    if (arg.startsWith('--kind=')) {
      kind = parseProjectKind(arg.slice('--kind='.length))
      continue
    }
    if (arg.startsWith('-')) {
      throw new ZeeError(`unknown flag \`${arg}\``, 1, 1, 'zee')
    }
    if (name) throw new ZeeError('unexpected extra argument', 1, 1, 'zee')
    name = arg
  }
  return { name, kind }
}

/** Layer files after `zee.toml` exists. One package. HTTP is `import http`; UI stays a gap. */
export function scaffoldProjectKind(root: string, kind: ProjectKind): void {
  if (kind === 'bin') return
  if (kind === 'api' || kind === 'service' || kind === 'monolith') {
    generateFeature({ cwd: root, path: 'user', kind: 'api' })
  }
  if (kind === 'web' || kind === 'monolith') {
    generateModule({ cwd: root, path: 'ui' })
    writeFileSync(join(root, 'src/ui/ui.view.zee'), uiViewSource())
  }
  writeKindDescription(root, kind)
  if (kind === 'api' || kind === 'service' || kind === 'monolith') {
    moveEntryToBootstrap(root)
    return
  }
  annotateMain(root)
}

function writeKindDescription(root: string, kind: ProjectKind): void {
  const file = join(root, 'zee.toml')
  const current = readFileSync(file, 'utf8')
  if (current.includes('description =')) return
  const description = kindDescription(kind)
  writeFileSync(file, current.replace(/\n$/, `\ndescription = "${description}"\n`))
}

function kindDescription(kind: ProjectKind): string {
  if (kind === 'api') {
    return 'Zee API (HTTP slice; main wires). Runtime HTTP is import http.'
  }
  if (kind === 'service') {
    return 'Zee process (one HTTP slice; main wires). Not a mesh.'
  }
  if (kind === 'web') {
    return 'Zee UI package. UI runtime is a language gap.'
  }
  return 'Zee monolith (HTTP + UI modules in one package). main wires. HTTP/UI runtimes are language gaps.'
}

function annotateMain(root: string): void {
  const file = join(root, 'src/main.zee')
  const current = readFileSync(file, 'utf8')
  if (current.includes('Composition root')) return
  writeFileSync(
    file,
    `//! Composition root. main wires adapters by hand. No language container.\n${current}`,
  )
}

function moveEntryToBootstrap(root: string): void {
  const from = join(root, 'src/main.zee')
  const dir = join(root, 'src/bootstrap')
  const to = join(dir, 'main.zee')
  mkdirSync(dir, { recursive: true })
  const current = readFileSync(from, 'utf8')
  const body = current.includes('Composition root')
    ? current
    : `//! Composition root. main wires adapters by hand. No language container.\n${current}`
  writeFileSync(to, body)
  unlinkSync(from)
  const toml = join(root, 'zee.toml')
  writeFileSync(toml, readFileSync(toml, 'utf8').replace('entry = "src/main.zee"', 'entry = "src/bootstrap/main.zee"'))
}

function uiViewSource(): string {
  return `//! UI adapter (borda). Zee UI runtime is a language gap.
// Domain stays in other modules. Import: import ui
`
}
