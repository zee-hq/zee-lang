import { resolve } from 'node:path'

export interface DebugFrame {
  name: string
  file: string
  line: number
  column: number
  variables: { name: string; value: string }[]
}

export interface DebugStop {
  file: string
  line: number
  column: number
  stack: DebugFrame[]
}

export type DebugAction = 'continue' | 'next' | 'stepIn'

export class DebugController {
  onStop?: (event: DebugStop) => DebugAction
  private readonly breakpoints = new Map<string, Set<number>>()
  private stepping = false

  setBreakpoints(file: string, lines: number[]): void {
    this.breakpoints.set(resolve(file), new Set(lines))
  }

  atStmt(event: DebugStop): void {
    const hit = this.breakpoints.get(resolve(event.file))?.has(event.line) ?? false
    if (!hit && !this.stepping) return
    this.stepping = false
    const action = this.onStop?.(event) ?? 'continue'
    if (action === 'next' || action === 'stepIn') this.stepping = true
  }
}
