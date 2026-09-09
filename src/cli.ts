#!/usr/bin/env node
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { ZeeError, VERSION } from './error.ts'
import { executeFile, ZeeSession, checkSource } from './zee.ts'
import { readFileSync } from 'node:fs'

function usage(): string {
  return `Zee ${VERSION} — strongly typed language

Usage:
  zee                 Start a REPL
  zee run <file>      Run a .zee file
  zee check <file>    Type-check without running
  zee help            Show this help
  zee version         Print the version
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

  if (command === 'run') {
    const file = argv[1]
    if (!file) {
      stderr('missing file path')
      return 1
    }
    const result = executeFile(file, { print: (text) => stdout.write(text) })
    return result.exitCode
  }

  if (command === 'check') {
    const file = argv[1]
    if (!file) {
      stderr('missing file path')
      return 1
    }
    checkSource(readFileSync(file, 'utf8'), file)
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
