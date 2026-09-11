'use strict'

const { spawn } = require('node:child_process')

const REQUEST_TIMEOUT_MS = 10_000

class ZeeLspClient {
  /**
   * @param {{ command: string, args: string[], cwd: string }} cli
   */
  constructor(cli) {
    this.cli = cli
    this.id = 0
    this.pending = new Map()
    this.buffer = Buffer.alloc(0)
    this.child = null
    /** @type {(uri: string, diagnostics: unknown[]) => void} */
    this.onDiagnostics = () => {}
    /** @type {Promise<void> | null} */
    this.ready = null
  }

  start() {
    this.child = spawn(this.cli.command, this.cli.args, {
      cwd: this.cli.cwd,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child.stdout.on('data', (chunk) => this._onData(chunk))
    this.child.stderr.on('data', () => {})
    this.child.on('error', (err) => {
      for (const item of this.pending.values()) item.reject(err)
      this.pending.clear()
    })
    this.ready = this._request('initialize', {
      processId: process.pid,
      capabilities: {},
    }).then(() => {
      this.notify('initialized', {})
    })
    return this.ready
  }

  /**
   * @param {string} method
   * @param {unknown} params
   */
  request(method, params) {
    if (!this.ready) return Promise.reject(new Error('zee lsp is not started'))
    return this.ready.then(() => this._request(method, params))
  }

  /**
   * @param {string} method
   * @param {unknown} params
   */
  notify(method, params) {
    this._send({ jsonrpc: '2.0', method, params })
  }

  /**
   * @param {string} uri
   * @param {string} text
   */
  didOpen(uri, text) {
    this.notify('textDocument/didOpen', {
      textDocument: { uri, languageId: 'zee', version: 1, text },
    })
  }

  /**
   * @param {string} uri
   * @param {string} text
   */
  didChange(uri, text) {
    this.notify('textDocument/didChange', {
      textDocument: { uri, version: 1 },
      contentChanges: [{ text }],
    })
  }

  /**
   * @param {string} uri
   */
  didClose(uri) {
    this.notify('textDocument/didClose', { textDocument: { uri } })
  }

  async stop() {
    try {
      if (this.ready) await this.request('shutdown', null)
      this.notify('exit', undefined)
    } catch {
      // The process may already be gone.
    }
    this.child?.kill()
    this.child = null
  }

  /**
   * @param {string} method
   * @param {unknown} params
   */
  _request(method, params) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`zee lsp timed out: ${method}`))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (err) => {
          clearTimeout(timer)
          reject(err)
        },
      })
      this._send({ jsonrpc: '2.0', id, method, params })
    })
  }

  /**
   * @param {object} message
   */
  _send(message) {
    if (!this.child?.stdin) return
    this.child.stdin.write(encodeLspMessage(message))
  }

  /**
   * @param {Buffer} chunk
   */
  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)])
    while (true) {
      const parsed = tryReadLspMessage(this.buffer)
      if (!parsed) break
      this.buffer = parsed.rest
      this._onMessage(parsed.message)
    }
  }

  /**
   * @param {{ id?: number | string, method?: string, params?: { uri?: string, diagnostics?: unknown[] }, result?: unknown, error?: { message?: string } }} message
   */
  _onMessage(message) {
    if (message.id !== undefined && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id)
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message ?? String(message.error)))
      else pending.resolve(message.result)
      return
    }
    if (message.method === 'textDocument/publishDiagnostics' && message.params?.uri) {
      this.onDiagnostics(message.params.uri, message.params.diagnostics ?? [])
    }
  }
}

function encodeLspMessage(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8')
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf8')
  return Buffer.concat([header, body])
}

function tryReadLspMessage(buffer) {
  const headerEnd = buffer.indexOf('\r\n\r\n')
  if (headerEnd < 0) return undefined
  const header = buffer.subarray(0, headerEnd).toString('utf8')
  const match = /Content-Length:\s*(\d+)/i.exec(header)
  if (!match) return undefined
  const length = Number(match[1])
  const start = headerEnd + 4
  if (buffer.length < start + length) return undefined
  const body = buffer.subarray(start, start + length).toString('utf8')
  const rest = buffer.subarray(start + length)
  return { message: JSON.parse(body), rest }
}

module.exports = { ZeeLspClient, encodeLspMessage, tryReadLspMessage }
