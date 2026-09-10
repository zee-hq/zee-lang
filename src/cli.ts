#!/usr/bin/env node
import { cwd, stdin, stdout } from 'node:process'
import { createInterface } from 'node:readline/promises'
import { ZeeError, PanicError, VERSION } from './error.ts'
import { generateController, generateModule, generateResource, generateService, controllerKindFromFlags } from './generate.ts'
import { createProject, defaultInitName, resolveEntry } from './project.ts'
import { checkPath, executeFile, ZeeSession } from './zee.ts'

function usage(): string {
  return `Zee ${VERSION} — strongly typed language

Usage:
  zee                 Start a REPL
  zee new <name>                 Create a new project in ./<name>
  zee init [name]                Scaffold a project in the current directory
  zee generate module <path>          Nest module (user → src/users/users.module.zee)
  zee generate controller <path>      Nest controller; --api or -i like Laravel
  zee generate service <path>         Nest service
  zee generate resource <path>        Module + controller + service
  zee g module <path>                 Alias (also: zee g m / mo / co / s / res)
  zee run [file]                 Run a .zee file, or src/main.zee in a project
  zee check [file]               Type-check a file, or the project entry
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

  if (command.endsWith('.zee')) {
    const result = executeFile(command, { print: (text) => stdout.write(text) })
    return result.exitCode
  }

  stderr(`unknown command \`${command}\`\n${usage()}`)
  return 1
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
  if (isModuleSchematic(parsed.schematic)) {
    const created = generateModule({ cwd: cwdNow, path: parsed.path })
    stdout.write(`created module ${created.importPath}\n`)
    stdout.write(`  ${created.file}\n`)
    return 0
  }
  if (isControllerSchematic(parsed.schematic)) {
    const created = generateController({
      cwd: cwdNow,
      path: parsed.path,
      kind: controllerKindFromFlags(parsed),
    })
    stdout.write(`created controller ${created.importPath}\n`)
    stdout.write(`  ${created.file}\n`)
    return 0
  }
  if (isServiceSchematic(parsed.schematic)) {
    const created = generateService({ cwd: cwdNow, path: parsed.path })
    stdout.write(`created service ${created.importPath}\n`)
    stdout.write(`  ${created.file}\n`)
    return 0
  }
  if (isResourceSchematic(parsed.schematic)) {
    const created = generateResource({
      cwd: cwdNow,
      path: parsed.path,
      kind: controllerKindFromFlags(parsed),
    })
    stdout.write(`created resource ${created.module.importPath}\n`)
    stdout.write(`  ${created.module.file}\n`)
    stdout.write(`  ${created.controller.file}\n`)
    stdout.write(`  ${created.service.file}\n`)
    return 0
  }
  stderr(`unknown schematic \`${parsed.schematic}\`\n${generateUsage()}`)
  return 1
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

function isServiceSchematic(name: string): boolean {
  return name === 'service' || name === 's'
}

function isResourceSchematic(name: string): boolean {
  return name === 'resource' || name === 'res' || name === 'r'
}

function generateUsage(): string {
  return `Usage:
  zee generate module <name>           src/<plural>/<plural>.module.zee
  zee generate controller <name>       src/<plural>/<plural>.controller.zee
  zee generate controller <name> --api Laravel API (index/store/show/update/destroy)
  zee generate controller <name> -i    Laravel invokable (invoke)
  zee generate service <name>          src/<plural>/<plural>.service.zee
  zee generate resource <name> [--api|-i]

Examples:
  zee generate module user             → src/users/users.module.zee
  zee generate controller user --api   → src/users/users.controller.zee
  zee g co user -i
  zee g resource user --api            → module + controller + service
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
