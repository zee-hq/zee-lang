import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { readSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DebugController, type DebugAction, type DebugStop } from './debug.ts'
import { encodeLspMessage, tryReadLspMessage, type LspMessage } from './lsp.ts'
import { executePath } from './zee.ts'

interface DapMessage {
  seq?: number
  type?: string
  command?: string
  event?: string
  request_seq?: number
  success?: boolean
  arguments?: Record<string, unknown>
  body?: unknown
}

export function runDebuggee(program: string, inputFd = 0, output: { write(text: string): void } = process.stdout): number {
  const initLine = readLineSync(inputFd)
  const init = initLine ? (JSON.parse(initLine) as { breakpoints?: { file: string; lines: number[] }[] }) : {}
  const debug = new DebugController()
  for (const item of init.breakpoints ?? []) {
    debug.setBreakpoints(item.file, item.lines)
  }
  debug.onStop = (event) => {
    output.write(`${JSON.stringify({ event: 'stopped', ...event })}\n`)
    const reply = JSON.parse(readLineSync(inputFd) || '{"action":"continue"}') as { action?: DebugAction }
    return reply.action ?? 'continue'
  }
  const result = executePath(program, {
    debug,
    print: (text) => output.write(`${JSON.stringify({ event: 'output', text })}\n`),
  })
  output.write(`${JSON.stringify({ event: 'exited', code: result.exitCode })}\n`)
  return result.exitCode
}

export async function serveDap(
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
): Promise<void> {
  let seq = 1
  let buffer: Buffer = Buffer.alloc(0)
  let program = ''
  const breakpoints: { file: string; lines: number[] }[] = []
  let child: ChildProcessWithoutNullStreams | undefined
  let childBuf = ''
  let finished = false

  const send = (message: DapMessage) => {
    const payload = { seq: seq++, ...message }
    output.write(encodeLspMessage(payload as unknown as LspMessage))
  }

  let lastStop: DebugStop | undefined

  const handleChildLine = (line: string) => {
    if (!line.trim()) return
    const msg = JSON.parse(line) as { event: string; text?: string; code?: number } & DebugStop
    if (msg.event === 'output' && msg.text) {
      send({ type: 'event', event: 'output', body: { category: 'stdout', output: msg.text } })
      return
    }
    if (msg.event === 'stopped') {
      lastStop = msg
      send({
        type: 'event',
        event: 'stopped',
        body: {
          reason: 'breakpoint',
          threadId: 1,
          allThreadsStopped: true,
        },
      })
      return
    }
    if (msg.event === 'exited') {
      return
    }
  }

  for await (const chunk of input) {
    buffer = Buffer.concat([buffer, Buffer.from(chunk)]) as Buffer
    while (true) {
      const parsed = tryReadLspMessage(buffer)
      if (!parsed) break
      buffer = parsed.rest
      const message = parsed.message as DapMessage
      if (message.type !== 'request' || !message.command) continue
      const respond = (body?: unknown) =>
        send({ type: 'response', request_seq: message.seq, success: true, command: message.command, body })
      if (message.command === 'initialize') {
        respond({
          supportsConfigurationDoneRequest: true,
          supportsStepInRequest: true,
        })
        send({ type: 'event', event: 'initialized' })
        continue
      }
      if (message.command === 'launch') {
        program = String(message.arguments?.program ?? '')
        respond()
        continue
      }
      if (message.command === 'setBreakpoints') {
        const source = message.arguments?.source as { path?: string } | undefined
        const bps = (message.arguments?.breakpoints as { line: number }[] | undefined) ?? []
        const file = source?.path ?? ''
        const existing = breakpoints.find((item) => item.file === file)
        if (existing) existing.lines = bps.map((item) => item.line)
        else if (file) breakpoints.push({ file, lines: bps.map((item) => item.line) })
        respond({ breakpoints: bps.map((item) => ({ verified: true, line: item.line })) })
        continue
      }
      if (message.command === 'configurationDone') {
        child = spawnDebuggee(program)
        child.stdin.write(`${JSON.stringify({ breakpoints })}\n`)
        child.stdout.setEncoding('utf8')
        child.stderr.setEncoding('utf8')
        child.stderr.on('data', (text: string) => {
          send({ type: 'event', event: 'output', body: { category: 'stderr', output: text } })
        })
        child.stdout.on('data', (text: string) => {
          childBuf += text
          const lines = childBuf.split('\n')
          childBuf = lines.pop() ?? ''
          for (const line of lines) handleChildLine(line)
        })
        child.on('exit', (code) => {
          if (finished) return
          finished = true
          if (childBuf.trim()) handleChildLine(childBuf)
          childBuf = ''
          send({ type: 'event', event: 'terminated', body: {} })
          send({ type: 'event', event: 'exited', body: { exitCode: code ?? 0 } })
        })
        respond()
        continue
      }
      if (message.command === 'continue' || message.command === 'next' || message.command === 'stepIn') {
        const action = message.command === 'continue' ? 'continue' : message.command
        child?.stdin.write(`${JSON.stringify({ action })}\n`)
        respond({ allThreadsContinued: message.command === 'continue' })
        continue
      }
      if (message.command === 'threads') {
        respond({ threads: [{ id: 1, name: 'main' }] })
        continue
      }
      if (message.command === 'stackTrace') {
        respond({
          stackFrames: (lastStop?.stack ?? []).map((frame, index) => ({
            id: index + 1,
            name: frame.name,
            line: frame.line,
            column: frame.column,
            source: { path: frame.file },
          })),
          totalFrames: lastStop?.stack.length ?? 0,
        })
        continue
      }
      if (message.command === 'scopes') {
        respond({ scopes: [{ name: 'Locals', variablesReference: 1, expensive: false }] })
        continue
      }
      if (message.command === 'variables') {
        const frame = lastStop?.stack[0]
        respond({
          variables: (frame?.variables ?? []).map((item) => ({
            name: item.name,
            value: item.value,
            variablesReference: 0,
          })),
        })
        continue
      }
      if (message.command === 'disconnect' || message.command === 'terminate') {
        child?.kill()
        respond()
        return
      }
      respond()
    }
  }
  child?.kill()
}

function spawnDebuggee(program: string): ChildProcessWithoutNullStreams {
  const here = dirname(fileURLToPath(import.meta.url))
  const tsx = join(here, '../node_modules/tsx/dist/cli.mjs')
  const cli = join(here, 'cli.ts')
  return spawn(process.execPath, [tsx, cli, 'debuggee', program], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

function readLineSync(fd: number): string {
  let out = ''
  const buf = Buffer.alloc(1)
  while (true) {
    const n = readSync(fd, buf, 0, 1, null)
    if (n === 0) return out
    if (buf[0] === 10) return out.replace(/\r$/, '')
    out += buf.toString('utf8')
  }
}
