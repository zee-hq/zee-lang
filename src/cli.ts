#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { cwd, stdin, stdout } from 'node:process'
import { createInterface } from 'node:readline/promises'
import { ZeeError, PanicError, VERSION } from './error.ts'
import {
  controllerKindFromFlags,
  generateAction,
  generateApi,
  generateController,
  generateFeature,
  generateModel,
  generateModule,
  generateRepository,
  generateResource,
  generateService,
  type GeneratedFile,
} from './generate.ts'
import { findDefinition, formatGoto } from './navigate.ts'
import { serveLsp } from './lsp.ts'
import { getPackages, updatePackages } from './pkg.ts'
import { createProject, defaultInitName, findProjectRoot, resolveEntry } from './project.ts'
import { publishPackage, defaultRegistryUrl, isHttpRegistry } from './registry.ts'
import { listenRegistry } from './registry-http.ts'
import { checkPath, executeFile, runPackageTests, ZeeSession } from './zee.ts'

function usage(): string {
  return `Zee ${VERSION} — strongly typed language

Usage:
  zee                 Start a REPL
  zee new <name>                 Create a new project in ./<name>
  zee init [name]                Scaffold a project in the current directory
  zee generate feature <path>        HTTP slice (controller → action → service → …)
  zee generate controller <path>      HTTP in; --api or -i like Laravel
  zee generate resource <path>        HTTP response mapper (not the whole stack)
  zee g feat <path>                   Alias (also: zee g co / act / s / re / repo / mod / api / mo)
  zee get [alias...]             Add catalog aliases and fetch [deps] into .zee/ (honors zee.lock)
  zee update [name...]           Re-resolve deps within current constraints and rewrite zee.lock
  zee publish                    Publish this package to ZEE_REGISTRY or [registry] url
  zee registry                   Serve the HTTP registry (file-backed)
  zee run [file]                 Run a .zee file, or src/main.zee in a project
  zee check [file]               Type-check a file, or the project entry
  zee test                       Run fn test* in *.test.zee under src/
  zee goto <file> <line> <column>
                                 Print the definition at a 1-based position
  zee lsp                        Language server (stdio JSON-RPC)
  zee help                       Show this help
  zee version                    Print the version
`
}

async function main(argv: string[]): Promise<number> {
  const command = argv[0]

  if (command === undefined) {
    await repl()
    return 0
  }

  if (command === 'help' || command === '--help' || command === '-h') {
    stdout.write(usage())
    return 0
  }

  if (command === 'version' || command === '--version' || command === '-v') {
    stdout.write(`${VERSION}\n`)
    return 0
  }

  if (command === 'new') {
    const name = argv[1]
    if (!name) {
      stderr('missing package name')
      return 1
    }
    const created = createProject({ name, parentDir: cwd(), mode: 'new' })
    stdout.write(`created ${created.name} at ${created.root}\n`)
    stdout.write(`  cd ${created.name} && zee run\n`)
    return 0
  }

  if (command === 'generate' || command === 'g') {
    return generateCommand(argv.slice(1))
  }

  if (command === 'init') {
    const name = argv[1] ?? defaultInitName(cwd())
    const created = createProject({ name, parentDir: cwd(), mode: 'init' })
    stdout.write(`created package ${created.name} in ${created.root}\n`)
    stdout.write('  zee run\n')
    return 0
  }

  if (command === 'get') {
    const root = findProjectRoot(cwd())
    if (!root) {
      stderr('run zee get inside a Zee project')
      return 1
    }
    const got = getPackages(root, argv.slice(1))
    stdout.write(`got ${got.packages.length} package(s)\n`)
    return 0
  }

  if (command === 'update') {
    const root = findProjectRoot(cwd())
    if (!root) {
      stderr('run zee update inside a Zee project')
      return 1
    }
    const updated = updatePackages(root, argv.slice(1))
    if (updated.changes.length === 0) {
      stdout.write('up to date\n')
      return 0
    }
    for (const change of updated.changes) {
      stdout.write(`updated ${change.name} ${change.from} -> ${change.to}\n`)
    }
    return 0
  }

  if (command === 'publish') {
    const root = findProjectRoot(cwd())
    if (!root) {
      stderr('run zee publish inside a Zee project')
      return 1
    }
    const published = publishPackage(root)
    stdout.write(`published ${published.name}@${published.version}\n`)
    stdout.write(`  ${published.dest}\n`)
    return 0
  }

  if (command === 'registry') {
    return registryCommand(argv.slice(1))
  }

  if (command === 'run') {
    const file = resolveEntry(cwd(), argv[1])
    const result = executeFile(file, { print: (text) => stdout.write(text) })
    return result.exitCode
  }

  if (command === 'check') {
    const file = resolveEntry(cwd(), argv[1])
    checkPath(file)
    stdout.write(`ok: ${file}\n`)
    return 0
  }

  if (command === 'test') {
    const root = findProjectRoot(cwd())
    if (!root) {
      stderr('run zee test inside a Zee project')
      return 1
    }
    const result = runPackageTests(root, { print: (text) => stdout.write(text) })
    return result.exitCode
  }

  if (command === 'goto') {
    const file = resolveEntry(cwd(), argv[1])
    const line = Number(argv[2])
    const column = Number(argv[3])
    if (!Number.isInteger(line) || !Number.isInteger(column) || line < 1 || column < 1) {
      stderr('usage: zee goto <file> <line> <column>')
      return 1
    }
    const hit = findDefinition({
      source: readFileSync(file, 'utf8'),
      file,
      line,
      column,
    })
    if (!hit) return 1
    stdout.write(`${formatGoto(hit)}\n`)
    return 0
  }

  if (command === 'lsp') {
    await serveLsp(stdin, stdout)
    return 0
  }

  if (command.endsWith('.zee')) {
    const result = executeFile(command, { print: (text) => stdout.write(text) })
    return result.exitCode
  }

  stderr(`unknown command \`${command}\`\n${usage()}`)
  return 1
}

async function registryCommand(argv: string[]): Promise<number> {
  const parsed = parseRegistryArgv(argv)
  if (parsed.help) {
    stdout.write(
      `Usage: zee registry [--root <path>] [--token <token>] [--host <host>] [--port <n>]\n`,
    )
    return 0
  }
  const token = parsed.token ?? process.env.ZEE_REGISTRY_TOKEN?.trim()
  if (!token) {
    stderr('zee registry needs --token or ZEE_REGISTRY_TOKEN')
    return 1
  }
  const root = parsed.root ?? defaultRegistryUrl()
  if (isHttpRegistry(root)) {
    stderr('zee registry --root must be a file path')
    return 1
  }
  const store = root.startsWith('file://') ? root.slice('file://'.length) : root
  const { url, close } = await listenRegistry({
    root: store,
    token,
    host: parsed.host,
    port: parsed.port ?? 0,
  })
  stdout.write(`listening ${url}\n`)
  await new Promise<void>((resolve) => {
    const stop = () => {
      process.off('SIGINT', stop)
      process.off('SIGTERM', stop)
      void close().finally(() => resolve())
    }
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
  })
  return 0
}

function parseRegistryArgv(argv: string[]): {
  root?: string
  token?: string
  host?: string
  port?: number
  help: boolean
} {
  let root: string | undefined
  let token: string | undefined
  let host: string | undefined
  let port: number | undefined
  let help = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--help' || arg === '-h') {
      help = true
      continue
    }
    const next = (): string => {
      const value = argv[++i]
      if (!value || value.startsWith('-')) {
        throw new ZeeError(`missing value for ${arg}`, 1, 1, 'zee registry')
      }
      return value
    }
    if (arg === '--root') root = next()
    else if (arg === '--token') token = next()
    else if (arg === '--host') host = next()
    else if (arg === '--port') {
      const raw = next()
      const n = Number(raw)
      if (!Number.isInteger(n) || n < 0) {
        throw new ZeeError(`invalid --port ${raw}`, 1, 1, 'zee registry')
      }
      port = n
    } else {
      throw new ZeeError(`unknown flag \`${arg}\``, 1, 1, 'zee registry')
    }
  }
  return { root, token, host, port, help }
}

function generateCommand(argv: string[]): number {
  const parsed = parseGenerateArgv(argv)
  if (!parsed.schematic || parsed.help || parsed.schematic === 'help') {
    stdout.write(generateUsage())
    return parsed.help || parsed.schematic === 'help' ? 0 : 1
  }
  if (parsed.unknownFlags.length > 0) {
    stderr(`unknown flag \`${parsed.unknownFlags[0]}\`\n${generateUsage()}`)
    return 1
  }
  if (!parsed.path) {
    stderr(`missing name (example: zee generate ${parsed.schematic} user)`)
    return 1
  }

  const cwdNow = cwd()
  const options = { cwd: cwdNow, path: parsed.path }
  const controllerFlags = isControllerSchematic(parsed.schematic) || isFeatureSchematic(parsed.schematic)
  if ((parsed.api || parsed.invokable) && !controllerFlags) {
    stderr('`--api` and `-i` apply to controller and feature only')
    return 1
  }

  if (isFeatureSchematic(parsed.schematic)) {
    const created = generateFeature({ ...options, kind: controllerKindFromFlags(parsed) })
    stdout.write(`created feature ${created.module.importPath}\n`)
    for (const file of featureFiles(created)) stdout.write(`  ${file}\n`)
    return 0
  }
  if (isModuleSchematic(parsed.schematic)) return createdOne('module', generateModule(options))
  if (isControllerSchematic(parsed.schematic)) {
    return createdOne(
      'controller',
      generateController({ ...options, kind: controllerKindFromFlags(parsed) }),
    )
  }
  if (isActionSchematic(parsed.schematic)) return createdOne('action', generateAction(options))
  if (isServiceSchematic(parsed.schematic)) return createdOne('service', generateService(options))
  if (isResourceSchematic(parsed.schematic)) return createdOne('resource', generateResource(options))
  if (isRepositorySchematic(parsed.schematic)) return createdOne('repository', generateRepository(options))
  if (isModelSchematic(parsed.schematic)) return createdOne('model', generateModel(options))
  if (isApiSchematic(parsed.schematic)) return createdOne('api', generateApi(options))
  stderr(`unknown schematic \`${parsed.schematic}\`\n${generateUsage()}`)
  return 1
}

function createdOne(label: string, created: GeneratedFile): number {
  stdout.write(`created ${label} ${created.importPath}\n`)
  stdout.write(`  ${created.file}\n`)
  return 0
}

function featureFiles(created: ReturnType<typeof generateFeature>): string[] {
  return [
    created.module.file,
    created.controller.file,
    created.action.file,
    created.service.file,
    created.resource.file,
    created.repository.file,
    created.model.file,
    created.api.file,
  ]
}

function parseGenerateArgv(argv: string[]): {
  schematic: string | undefined
  path: string | undefined
  api: boolean
  invokable: boolean
  help: boolean
  unknownFlags: string[]
} {
  let schematic: string | undefined
  let path: string | undefined
  let api = false
  let invokable = false
  let help = false
  const unknownFlags: string[] = []
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      help = true
      continue
    }
    if (arg === '--api') {
      api = true
      continue
    }
    if (arg === '-i' || arg === '--invokable') {
      invokable = true
      continue
    }
    if (arg.startsWith('-')) {
      unknownFlags.push(arg)
      continue
    }
    if (!schematic) schematic = arg
    else if (!path) path = arg
  }
  return { schematic, path, api, invokable, help, unknownFlags }
}

function isModuleSchematic(name: string): boolean {
  return name === 'module' || name === 'm' || name === 'mo'
}

function isControllerSchematic(name: string): boolean {
  return name === 'controller' || name === 'co'
}

function isActionSchematic(name: string): boolean {
  return name === 'action' || name === 'act'
}

function isServiceSchematic(name: string): boolean {
  return name === 'service' || name === 's'
}

function isResourceSchematic(name: string): boolean {
  return name === 'resource' || name === 'res' || name === 're'
}

function isRepositorySchematic(name: string): boolean {
  return name === 'repository' || name === 'repo'
}

function isModelSchematic(name: string): boolean {
  return name === 'model' || name === 'mod'
}

function isApiSchematic(name: string): boolean {
  return name === 'api'
}

function isFeatureSchematic(name: string): boolean {
  return name === 'feature' || name === 'feat'
}

function generateUsage(): string {
  return `Usage:
  zee generate feature <name> [--api|-i]   whole HTTP slice
  zee generate controller <name> [--api|-i]
  zee generate action <name>
  zee generate service <name>
  zee generate resource <name>             HTTP mapper (not the stack)
  zee generate repository <name>
  zee generate model <name>
  zee generate api <name>
  zee generate module <name>               DI stub until §9b

Examples:
  zee generate feature user --api
  zee generate controller user --api
  zee g co user -i
  zee g re user                             → src/users/users.resource.zee
`
}

async function repl(): Promise<void> {
  stdout.write(`zee ${VERSION} — type :quit to exit\n`)
  const session = new ZeeSession()
  const rl = createInterface({ input: stdin, output: stdout, prompt: 'zee> ' })
  rl.prompt()
  for await (const line of rl) {
    const trimmed = line.trim()
    if (trimmed === ':quit' || trimmed === ':exit') break
    if (trimmed === ':help') {
      stdout.write('enter Zee code, or :quit to leave\n')
      rl.prompt()
      continue
    }
    try {
      const result = session.eval(line)
      if (result.stdout) stdout.write(result.stdout)
      if (result.display !== undefined) stdout.write(`${result.display}\n`)
    } catch (error) {
      stdout.write(`${formatError(error)}\n`)
    }
    rl.prompt()
  }
  rl.close()
}

function formatError(error: unknown): string {
  if (error instanceof PanicError) return `panic: ${error.message}`
  if (error instanceof ZeeError) return `error: ${error.message}`
  if (error instanceof Error) return `error: ${error.message}`
  return `error: ${String(error)}`
}

function stderr(message: string): void {
  process.stderr.write(`${message}\n`)
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code
  })
  .catch((error) => {
    process.stderr.write(`${formatError(error)}\n`)
    process.exitCode = 1
  })
