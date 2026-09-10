'use strict'

const path = require('node:path')
const fs = require('node:fs')

/**
 * @param {'run' | 'check'} subcommand
 * @param {string} file
 * @param {string | undefined} workspaceRoot
 * @param {(path: string) => boolean} [exists]
 * @returns {{ command: string, args: string[], cwd: string }}
 */
function resolveZeeCli(subcommand, file, workspaceRoot, exists = fs.existsSync) {
  const cwd = workspaceRoot || path.dirname(file)
  if (workspaceRoot) {
    const cliTs = path.join(workspaceRoot, 'src/cli.ts')
    const tsx = path.join(workspaceRoot, 'node_modules/tsx/dist/cli.mjs')
    if (exists(cliTs) && exists(tsx)) {
      return {
        command: process.execPath,
        args: [tsx, cliTs, subcommand, file],
        cwd: workspaceRoot,
      }
    }
  }
  return { command: 'zee', args: [subcommand, file], cwd }
}

/**
 * @param {{ command: string, args: string[] }} resolved
 */
function formatShellCommand(resolved) {
  return [resolved.command, ...resolved.args].map((part) => JSON.stringify(part)).join(' ')
}

module.exports = { resolveZeeCli, formatShellCommand }
