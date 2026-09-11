'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

/**
 * @param {string} subcommand
 * @param {string | undefined} file
 * @param {string | undefined} workspaceRoot
 * @param {(path: string) => boolean} [exists]
 * @param {string} [execPath]
 * @returns {{ command: string, args: string[], cwd: string }}
 */
function resolveZeeCli(subcommand, file, workspaceRoot, exists = fs.existsSync, execPath = process.execPath) {
  const cwd = workspaceRoot || (file ? path.dirname(file) : process.cwd())
  const extra = file ? [file] : []
  if (workspaceRoot) {
    const cliTs = path.join(workspaceRoot, 'src/cli.ts')
    const tsx = path.join(workspaceRoot, 'node_modules/tsx/dist/cli.mjs')
    if (exists(cliTs) && exists(tsx)) {
      return {
        command: resolveNodeCommand(execPath, exists),
        args: [tsx, cliTs, subcommand, ...extra],
        cwd: workspaceRoot,
      }
    }
  }
  return { command: 'zee', args: [subcommand, ...extra], cwd }
}

/**
 * Extension hosts run as Electron. Spawning that binary as `zee lsp` never
 * answers JSON-RPC, so hover stays on "Loading…".
 *
 * @param {string} execPath
 * @param {(path: string) => boolean} exists
 */
function resolveNodeCommand(execPath, exists) {
  if (isNodeBinary(execPath)) return execPath
  const nvmDir = process.env.NVM_DIR || path.join(os.homedir(), '.nvm')
  const aliasFile = path.join(nvmDir, 'alias', 'default')
  if (exists(aliasFile)) {
    try {
      const alias = fs.readFileSync(aliasFile, 'utf8').trim()
      const version = alias.startsWith('v') ? alias : `v${alias}`
      const candidate = path.join(nvmDir, 'versions', 'node', version, 'bin', 'node')
      if (exists(candidate)) return candidate
    } catch {
      // PATH `node` below
    }
  }
  return 'node'
}

/**
 * @param {string} execPath
 */
function isNodeBinary(execPath) {
  const base = path.basename(execPath).replace(/\.exe$/i, '').toLowerCase()
  return base === 'node'
}

/**
 * @param {{ command: string, args: string[] }} resolved
 */
function formatShellCommand(resolved) {
  return [resolved.command, ...resolved.args].map((part) => JSON.stringify(part)).join(' ')
}

module.exports = { resolveZeeCli, formatShellCommand, resolveNodeCommand }
