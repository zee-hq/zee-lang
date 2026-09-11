import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { KEYWORDS } from '../src/lexer.ts'

const editorRoot = join(import.meta.dirname, '../editor/vscode')
const grammar = JSON.parse(readFileSync(join(editorRoot, 'syntaxes/zee.tmLanguage.json'), 'utf8'))
const languageConfig = JSON.parse(readFileSync(join(editorRoot, 'language-configuration.json'), 'utf8'))
const extensionManifest = JSON.parse(readFileSync(join(editorRoot, 'package.json'), 'utf8'))

const require = createRequire(import.meta.url)
const { parseCliDiagnostics } = require('../editor/vscode/diagnostics.cjs') as {
  parseCliDiagnostics: (text: string) => Array<{
    file: string
    line: number
    column: number
    message: string
    severity: 'error' | 'panic'
  }>
}
const { resolveZeeCli } = require('../editor/vscode/cli.cjs') as {
  resolveZeeCli: (
    subcommand: string,
    file: string | undefined,
    workspaceRoot: string | undefined,
    exists?: (path: string) => boolean,
    execPath?: string,
  ) => { command: string; args: string[]; cwd: string }
}

describe('editor diagnostics', () => {
  it('parses a ZeeError from zee check stderr', () => {
    const text = 'error: /tmp/hello.zee:4:7: expected i32, found String\n'
    expect(parseCliDiagnostics(text)).toEqual([
      {
        file: '/tmp/hello.zee',
        line: 4,
        column: 7,
        message: 'expected i32, found String',
        severity: 'error',
      },
    ])
  })

  it('parses Windows paths and panic lines', () => {
    expect(
      parseCliDiagnostics(
        'error: C:\\src\\app.zee:1:1: unknown name `x`\npanic: overflow\n',
      ),
    ).toEqual([
      {
        file: 'C:\\src\\app.zee',
        line: 1,
        column: 1,
        message: 'unknown name `x`',
        severity: 'error',
      },
      {
        file: '',
        line: 1,
        column: 1,
        message: 'overflow',
        severity: 'panic',
      },
    ])
  })

  it('ignores success output', () => {
    expect(parseCliDiagnostics('ok: /tmp/hello.zee\n')).toEqual([])
  })
})

describe('editor CLI resolver', () => {
  it('uses the workspace tsx interpreter when this repo is open', () => {
    const root = '/Users/zeth/Projects/zee-lang'
    const file = join(root, 'examples/hello.zee')
    const resolved = resolveZeeCli('check', file, root, (path) => {
      return (
        path === join(root, 'src/cli.ts') ||
        path === join(root, 'node_modules/tsx/dist/cli.mjs')
      )
    })
    expect(resolved.command).toBe(process.execPath)
    expect(resolved.args).toEqual([
      join(root, 'node_modules/tsx/dist/cli.mjs'),
      join(root, 'src/cli.ts'),
      'check',
      file,
    ])
    expect(resolved.cwd).toBe(root)
  })

  it('falls back to zee on PATH for a user package', () => {
    const file = '/tmp/hello/src/main.zee'
    const resolved = resolveZeeCli('run', file, '/tmp/hello', () => false)
    expect(resolved).toEqual({
      command: 'zee',
      args: ['run', file],
      cwd: '/tmp/hello',
    })
  })

  it('starts zee lsp without appending a file', () => {
    const root = '/Users/zeth/Projects/zee-lang'
    const resolved = resolveZeeCli('lsp', undefined, root, (path) => {
      return (
        path === join(root, 'src/cli.ts') ||
        path === join(root, 'node_modules/tsx/dist/cli.mjs')
      )
    })
    expect(resolved.args).toEqual([
      join(root, 'node_modules/tsx/dist/cli.mjs'),
      join(root, 'src/cli.ts'),
      'lsp',
    ])
  })

  it('does not spawn the editor binary as zee lsp', () => {
    const root = '/Users/zeth/Projects/zee-lang'
    const electron = '/Applications/Cursor.app/Contents/MacOS/Cursor'
    const resolved = resolveZeeCli(
      'lsp',
      undefined,
      root,
      (item) =>
        item === join(root, 'src/cli.ts') || item === join(root, 'node_modules/tsx/dist/cli.mjs'),
      electron,
    )
    expect(resolved.command).not.toBe(electron)
    expect(resolved.command).toBe('node')
    expect(resolved.args.at(-1)).toBe('lsp')
  })

  it('answers hover over stdio from the vscode lsp client', async () => {
    const { ZeeLspClient } = require('../editor/vscode/lsp-client.cjs') as {
      ZeeLspClient: new (cli: { command: string; args: string[]; cwd: string }) => {
        start: () => Promise<void>
        request: (method: string, params: unknown) => Promise<{ contents?: { value?: string } } | null>
        didOpen: (uri: string, text: string) => void
        stop: () => Promise<void>
      }
    }
    const root = join(import.meta.dirname, '..')
    const cli = resolveZeeCli('lsp', undefined, root)
    const client = new ZeeLspClient(cli)
    try {
      await client.start()
      const file = join(root, 'examples/hello.zee')
      const text = readFileSync(file, 'utf8')
      const uri = `file://${file}`
      client.didOpen(uri, text)
      const hover = await client.request('textDocument/hover', {
        textDocument: { uri },
        position: { line: 1, character: 4 },
      })
      expect(hover?.contents?.value).toMatch(/fn |println|main/)
    } finally {
      await client.stop()
    }
  })
})

describe('editor grammar', () => {
  it('highlights every lexer keyword', () => {
    const blob = JSON.stringify(grammar)
    for (const keyword of Object.keys(KEYWORDS)) {
      expect(blob, `missing keyword ${keyword}`).toContain(keyword)
    }
  })

  it('closes brackets, quotes, and backticks', () => {
    const pairs = languageConfig.autoClosingPairs.map((pair: { open: string }) => pair.open)
    expect(pairs).toEqual(expect.arrayContaining(['{', '(', '[', '"', "'", '`']))
  })

  it('registers go-to-definition and a word pattern (AC-editor-navigate)', () => {
    const extension = readFileSync(join(editorRoot, 'extension.js'), 'utf8')
    expect(extension).toContain("resolveZeeCli('lsp'")
    expect(extension).toContain('registerDefinitionProvider')
    expect(extension).toContain('registerHoverProvider')
    expect(extension).toContain('registerCompletionItemProvider')
    expect(extension).toContain('textDocument/semanticTokens/full')
    expect(languageConfig.wordPattern).toBeDefined()
  })
})

describe('JetBrains plugin (ZEE-2)', () => {
  const jetbrainsRoot = join(import.meta.dirname, '../editor/jetbrains')

  it('ships a TextMate grammar and an LSP4IJ client for zee lsp', () => {
    const pluginXml = readFileSync(join(jetbrainsRoot, 'src/main/resources/META-INF/plugin.xml'), 'utf8')
    expect(pluginXml).toContain('com.redhat.devtools.lsp4ij')
    expect(pluginXml).toContain('fileNamePatternMapping')
    expect(pluginXml).toContain('*.zee')
    const factory = readFileSync(
      join(jetbrainsRoot, 'src/main/kotlin/dev/zee/lang/ZeeLanguageServerFactory.kt'),
      'utf8',
    )
    expect(factory).toContain('"zee"')
    expect(factory).toContain('"lsp"')
    const vsGrammar = readFileSync(join(editorRoot, 'syntaxes/zee.tmLanguage.json'), 'utf8')
    const jbGrammar = readFileSync(
      join(jetbrainsRoot, 'src/main/resources/textmate/zee/syntaxes/zee.tmLanguage.json'),
      'utf8',
    )
    expect(jbGrammar).toBe(vsGrammar)
  })
})

describe('editor brand', () => {
  it('ships the Zee mark as the extension icon', () => {
    expect(existsSync(join(editorRoot, 'media/zee-icon.png'))).toBe(true)
    expect(extensionManifest.icon).toBe('media/zee-icon.png')
    expect(extensionManifest.publisher).toBe('zee-hq')
    expect(extensionManifest.contributes.iconThemes).toEqual([
      {
        id: 'zee-icons',
        label: 'Zee',
        path: './file-icons/zee-icon-theme.json',
      },
    ])
    expect(extensionManifest.contributes.themes).toEqual([
      {
        id: 'Zee Dark',
        label: 'Zee Dark',
        uiTheme: 'vs-dark',
        path: './themes/zee-dark.json',
      },
      {
        id: 'Zee Light',
        label: 'Zee Light',
        uiTheme: 'vs',
        path: './themes/zee-light.json',
      },
    ])
  })
})
