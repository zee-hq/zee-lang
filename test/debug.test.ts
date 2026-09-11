import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { serveDap } from '../src/dap.ts'
import { DebugController } from '../src/debug.ts'
import { encodeLspMessage, tryReadLspMessage, type LspMessage } from '../src/lsp.ts'
import { executePath } from '../src/zee.ts'

type DapWire = LspMessage & { event?: string; command?: string; type?: string }

const temps: string[] = []

function scratch(): string {
  const dir = mkdtempSync(join(import.meta.dirname, 'debug-'))
  temps.push(dir)
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'zee.toml'), '[package]\nname = "app"\nversion = "0.1.0"\nentry = "src/main.zee"\n')
  return dir
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('zee debug (ZEE-3)', () => {
  it('stops on a breakpoint and steps to the next statement', () => {
    const root = scratch()
    const file = join(root, 'src/main.zee')
    writeFileSync(
      file,
      `fn main() {
  const a = 1
  const b = 2
  println(a)
}
`,
    )
    const debug = new DebugController()
    debug.setBreakpoints(file, [3])
    const stops: number[] = []
    debug.onStop = (event) => {
      stops.push(event.line)
      return stops.length === 1 ? 'next' : 'continue'
    }
    const result = executePath(file, { debug })
    expect(stops[0]).toBe(3)
    expect(stops[1]).toBe(4)
    expect(result.stdout).toBe('1\n')
  })

  it('stops at a breakpoint over DAP', async () => {
    const root = scratch()
    const file = join(root, 'src/main.zee')
    writeFileSync(
      file,
      `fn main() {
  const a = 1
  println(a)
}
`,
    )
    const input = new PassThrough()
    const output = new PassThrough()
    const messages: DapWire[] = []
    let buffer: Buffer = Buffer.alloc(0)
    const serving = serveDap(input, output)
    const waitFor = (match: (item: DapWire) => boolean, timeoutMs = 15000) =>
      new Promise<DapWire>((resolve, reject) => {
        const start = Date.now()
        const tick = () => {
          const hit = messages.find(match)
          if (hit) {
            resolve(hit)
            return
          }
          if (Date.now() - start > timeoutMs) {
            reject(new Error(`dap timeout; saw ${messages.map((item) => item.event ?? item.command).join(',')}`))
            return
          }
          setTimeout(tick, 20)
        }
        tick()
      })
    output.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      while (true) {
        const parsed = tryReadLspMessage(buffer)
        if (!parsed) break
        buffer = parsed.rest
        messages.push(parsed.message as DapWire)
      }
    })
    const send = (message: Record<string, unknown>) => {
      input.write(encodeLspMessage(message as LspMessage))
    }
    send({ type: 'request', seq: 1, command: 'initialize', arguments: {} })
    await waitFor((item) => item.event === 'initialized')
    send({ type: 'request', seq: 2, command: 'launch', arguments: { program: file } })
    send({
      type: 'request',
      seq: 3,
      command: 'setBreakpoints',
      arguments: { source: { path: file }, breakpoints: [{ line: 3 }] },
    })
    send({ type: 'request', seq: 4, command: 'configurationDone', arguments: {} })
    await waitFor((item) => item.event === 'stopped')
    send({ type: 'request', seq: 5, command: 'continue', arguments: { threadId: 1 } })
    await waitFor((item) => item.event === 'exited')
    send({ type: 'request', seq: 6, command: 'disconnect', arguments: {} })
    await serving
  }, 20000)
})
