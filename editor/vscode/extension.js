const vscode = require('vscode')
const { spawn } = require('node:child_process')
const { parseCliDiagnostics } = require('./diagnostics.cjs')
const { resolveZeeCli, formatShellCommand } = require('./cli.cjs')

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  const diagnostics = vscode.languages.createDiagnosticCollection('zee')
  context.subscriptions.push(diagnostics)

  const checkDocument = (document) => {
    if (document.languageId !== 'zee') return
    void lintDocument(document, diagnostics)
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('zee.runFile', () => runInTerminal('run')),
    vscode.commands.registerCommand('zee.checkFile', async () => {
      const editor = vscode.window.activeTextEditor
      if (!editor) {
        vscode.window.showErrorMessage('Open a .zee file first.')
        return
      }
      await lintDocument(editor.document, diagnostics)
    }),
    vscode.languages.registerDefinitionProvider('zee', {
      provideDefinition(document, position) {
        return definitionAt(document, position)
      },
    }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (vscode.workspace.getConfiguration('zee').get('checkOnSave', true)) {
        checkDocument(document)
      }
    }),
    vscode.workspace.onDidOpenTextDocument(checkDocument),
    vscode.workspace.onDidCloseTextDocument((document) => diagnostics.delete(document.uri)),
  )

  for (const document of vscode.workspace.textDocuments) {
    checkDocument(document)
  }
}

/**
 * @param {vscode.TextDocument} document
 * @param {vscode.DiagnosticCollection} collection
 */
async function lintDocument(document, collection) {
  if (document.languageId !== 'zee') return
  if (document.isDirty) await document.save()
  const file = document.uri.fsPath
  const workspaceRoot = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath
  const cli = resolveZeeCli('check', file, workspaceRoot)
  try {
    const output = await spawnCapture(cli)
    const parsed = parseCliDiagnostics(`${output.stderr}\n${output.stdout}`)
    collection.set(
      document.uri,
      parsed.map((item) => toDiagnostic(document, item)),
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    vscode.window.showErrorMessage(`Zee check failed: ${message}`)
  }
}

/**
 * @param {vscode.TextDocument} document
 * @param {{ line: number, column: number, message: string, severity: 'error' | 'panic' }} item
 */
function toDiagnostic(document, item) {
  const line = Math.min(Math.max(item.line - 1, 0), Math.max(document.lineCount - 1, 0))
  const column = Math.max(item.column - 1, 0)
  const range = new vscode.Range(line, column, line, column + 1)
  const diagnostic = new vscode.Diagnostic(range, item.message, vscode.DiagnosticSeverity.Error)
  diagnostic.source = item.severity === 'panic' ? 'zee panic' : 'zee'
  return diagnostic
}

/**
 * @param {vscode.TextDocument} document
 * @param {vscode.Position} position
 */
async function definitionAt(document, position) {
  if (document.languageId !== 'zee') return undefined
  if (document.isDirty) await document.save()
  const file = document.uri.fsPath
  const workspaceRoot = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath
  const cli = resolveZeeCli('goto', file, workspaceRoot)
  cli.args.push(String(position.line + 1), String(position.character + 1))
  try {
    const output = await spawnCapture(cli)
    const hit = parseGoto(output.stdout)
    if (!hit) return undefined
    return new vscode.Location(
      vscode.Uri.file(hit.file),
      new vscode.Position(Math.max(hit.line - 1, 0), Math.max(hit.column - 1, 0)),
    )
  } catch {
    return undefined
  }
}

/**
 * @param {string} text
 * @returns {{ file: string, line: number, column: number } | undefined}
 */
function parseGoto(text) {
  const line = text
    .trim()
    .split('\n')
    .filter(Boolean)
    .at(-1)
  if (!line) return undefined
  try {
    const hit = JSON.parse(line)
    if (typeof hit.file !== 'string' || typeof hit.line !== 'number' || typeof hit.column !== 'number') {
      return undefined
    }
    return hit
  } catch {
    return undefined
  }
}

/**
 * @param {string} subcommand
 */
async function runInTerminal(subcommand) {
  const editor = vscode.window.activeTextEditor
  if (!editor) {
    vscode.window.showErrorMessage('Open a .zee file first.')
    return
  }
  if (editor.document.isDirty) await editor.document.save()
  const file = editor.document.uri.fsPath
  const workspaceRoot = vscode.workspace.getWorkspaceFolder(editor.document.uri)?.uri.fsPath
  const terminal =
    vscode.window.terminals.find((item) => item.name === 'Zee') ??
    vscode.window.createTerminal({ name: 'Zee' })
  terminal.show()
  terminal.sendText(formatShellCommand(resolveZeeCli(subcommand, file, workspaceRoot)))
}

/**
 * @param {{ command: string, args: string[], cwd: string }} resolved
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
function spawnCapture(resolved) {
  return new Promise((resolve, reject) => {
    const child = spawn(resolved.command, resolved.args, {
      cwd: resolved.cwd,
      env: process.env,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', () => resolve({ stdout, stderr }))
  })
}

function deactivate() {}

module.exports = { activate, deactivate }
