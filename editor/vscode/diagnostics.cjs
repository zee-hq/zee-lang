'use strict'

/**
 * Parse `zee check` / `zee run` CLI output into editor diagnostics.
 * Matches `formatError` in src/cli.ts: `error: file:line:column: message`.
 *
 * @param {string} text
 * @returns {Array<{ file: string, line: number, column: number, message: string, severity: 'error' | 'panic' }>}
 */
function parseCliDiagnostics(text) {
  const diagnostics = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue

    const error = line.match(/^error:\s+(.+):(\d+):(\d+):\s+(.*)$/)
    if (error) {
      diagnostics.push({
        file: error[1],
        line: Number(error[2]),
        column: Number(error[3]),
        message: error[4],
        severity: 'error',
      })
      continue
    }

    const panic = line.match(/^panic:\s+(.*)$/)
    if (panic) {
      diagnostics.push({
        file: '',
        line: 1,
        column: 1,
        message: panic[1],
        severity: 'panic',
      })
    }
  }
  return diagnostics
}

module.exports = { parseCliDiagnostics }
