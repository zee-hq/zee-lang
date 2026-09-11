const vscode = require('vscode')
const { resolveZeeCli, formatShellCommand } = require('./cli.cjs')
const { ZeeLspClient } = require('./lsp-client.cjs')

const SEMANTIC_TOKEN_TYPES = [
  'namespace',
  'type',
  'class',
  'enum',
  'interface',
  'struct',
  'function',
  'variable',
  'keyword',
  'modifier',
  'parameter',
]

/** @type {ZeeLspClient | undefined} */
let client

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  const cli = resolveZeeCli('lsp', undefined, workspaceRoot)
  const lsp = new ZeeLspClient(cli)
  client = lsp
  const diagnostics = vscode.languages.createDiagnosticCollection('zee')
  lsp.onDiagnostics = (uri, items) => {
    diagnostics.set(
      vscode.Uri.parse(uri),
      items.map((item) => toDiagnostic(item)),
    )
  }

  const syncOpen = (document) => {
    if (document.languageId !== 'zee') return
    lsp.didOpen(document.uri.toString(), document.getText())
  }

  void lsp.start().then(
    () => {
      for (const document of vscode.workspace.textDocuments) syncOpen(document)
    },
    (error) => {
      const message = error instanceof Error ? error.message : String(error)
      vscode.window.showErrorMessage(`Zee language server failed: ${message}`)
    },
  )

  const legend = new vscode.SemanticTokensLegend(SEMANTIC_TOKEN_TYPES, [])

  context.subscriptions.push(
    diagnostics,
    { dispose: () => void lsp.stop() },
    vscode.commands.registerCommand('zee.runFile', () => runInTerminal('run')),
    vscode.commands.registerCommand('zee.checkFile', () => runInTerminal('check')),
    vscode.workspace.onDidOpenTextDocument(syncOpen),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.languageId !== 'zee') return
      lsp.didChange(event.document.uri.toString(), event.document.getText())
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      if (document.languageId !== 'zee') return
      lsp.didClose(document.uri.toString())
      diagnostics.delete(document.uri)
    }),
    vscode.languages.registerHoverProvider('zee', {
      async provideHover(document, position) {
        try {
          const result = await lsp.request('textDocument/hover', positionParams(document, position))
          if (!result?.contents?.value) return undefined
          return new vscode.Hover(new vscode.MarkdownString(result.contents.value))
        } catch {
          return undefined
        }
      },
    }),
    vscode.languages.registerCompletionItemProvider(
      'zee',
      {
        async provideCompletionItems(document, position) {
          const items = await lsp.request('textDocument/completion', positionParams(document, position))
          return (items ?? []).map((item) => {
            const completion = new vscode.CompletionItem(item.label, completionKind(item.kind))
            completion.detail = item.detail
            return completion
          })
        },
      },
      '.',
    ),
    vscode.languages.registerDefinitionProvider('zee', {
      async provideDefinition(document, position) {
        const result = await lsp.request('textDocument/definition', positionParams(document, position))
        return result ? locationFromLsp(result) : undefined
      },
    }),
    vscode.languages.registerReferenceProvider('zee', {
      async provideReferences(document, position) {
        const result = await lsp.request('textDocument/references', {
          ...positionParams(document, position),
          context: { includeDeclaration: true },
        })
        return (result ?? []).map(locationFromLsp)
      },
    }),
    vscode.languages.registerSignatureHelpProvider(
      'zee',
      {
        async provideSignatureHelp(document, position) {
          const result = await lsp.request('textDocument/signatureHelp', positionParams(document, position))
          if (!result?.signatures?.length) return undefined
          const help = new vscode.SignatureHelp()
          help.signatures = result.signatures.map((item) => {
            const signature = new vscode.SignatureInformation(item.label)
            signature.parameters = (item.parameters ?? []).map(
              (param) => new vscode.ParameterInformation(param.label),
            )
            return signature
          })
          help.activeSignature = result.activeSignature ?? 0
          help.activeParameter = result.activeParameter ?? 0
          return help
        },
      },
      '(',
    ),
    vscode.languages.registerInlayHintsProvider('zee', {
      async provideInlayHints(document) {
        const result = await lsp.request('textDocument/inlayHint', {
          textDocument: { uri: document.uri.toString() },
          range: {
            start: { line: 0, character: 0 },
            end: { line: document.lineCount, character: 0 },
          },
        })
        return (result ?? []).map(
          (hint) =>
            new vscode.InlayHint(
              new vscode.Position(hint.position.line, hint.position.character),
              hint.label,
              vscode.InlayHintKind.Type,
            ),
        )
      },
    }),
    vscode.languages.registerDocumentSemanticTokensProvider(
      'zee',
      {
        async provideDocumentSemanticTokens(document) {
          const result = await lsp.request('textDocument/semanticTokens/full', {
            textDocument: { uri: document.uri.toString() },
          })
          return new vscode.SemanticTokens(new Uint32Array(result?.data ?? []))
        },
      },
      legend,
    ),
  )
}

/**
 * @param {vscode.TextDocument} document
 * @param {vscode.Position} position
 */
function positionParams(document, position) {
  return {
    textDocument: { uri: document.uri.toString() },
    position: { line: position.line, character: position.character },
  }
}

/**
 * @param {{ range: { start: { line: number, character: number }, end: { line: number, character: number } }, message: string }} item
 */
function toDiagnostic(item) {
  const start = item.range?.start ?? { line: 0, character: 0 }
  const end = item.range?.end ?? { line: start.line, character: start.character + 1 }
  const range = new vscode.Range(start.line, start.character, end.line, end.character)
  const diagnostic = new vscode.Diagnostic(range, item.message, vscode.DiagnosticSeverity.Error)
  diagnostic.source = 'zee'
  return diagnostic
}

/**
 * @param {{ uri: string, range: { start: { line: number, character: number } } }} hit
 */
function locationFromLsp(hit) {
  return new vscode.Location(
    vscode.Uri.parse(hit.uri),
    new vscode.Position(hit.range.start.line, hit.range.start.character),
  )
}

/**
 * @param {number | undefined} kind
 */
function completionKind(kind) {
  if (kind === 3) return vscode.CompletionItemKind.Function
  if (kind === 22) return vscode.CompletionItemKind.Class
  if (kind === 9) return vscode.CompletionItemKind.Module
  if (kind === 14) return vscode.CompletionItemKind.Keyword
  return vscode.CompletionItemKind.Variable
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

function deactivate() {
  return client?.stop()
}

module.exports = { activate, deactivate }
