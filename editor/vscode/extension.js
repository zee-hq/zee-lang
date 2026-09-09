const vscode = require('vscode')
const path = require('node:path')

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('zee.runFile', () => runZee('run')),
    vscode.commands.registerCommand('zee.checkFile', () => runZee('check')),
  )
}

/**
 * @param {'run' | 'check'} subcommand
 */
async function runZee(subcommand) {
  const editor = vscode.window.activeTextEditor
  if (!editor) {
    vscode.window.showErrorMessage('Open a .zee file first.')
    return
  }
  if (editor.document.isDirty) {
    await editor.document.save()
  }
  const file = editor.document.uri.fsPath
  const terminal = vscode.window.createTerminal({ name: 'Zee' })
  terminal.show()
  terminal.sendText(buildCommand(subcommand, file))
}

/**
 * @param {'run' | 'check'} subcommand
 * @param {string} file
 */
function buildCommand(subcommand, file) {
  const quoted = JSON.stringify(file)
  return `zee ${subcommand} ${quoted} || npx --yes tsx "${cliPath()}" ${subcommand} ${quoted}`
}

function cliPath() {
  return path.resolve(__dirname, '../../src/cli.ts')
}

function deactivate() {}

module.exports = { activate, deactivate }
