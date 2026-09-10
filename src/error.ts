export const VERSION = '0.1.0'

export class ZeeError extends Error {
  constructor(
    message: string,
    readonly line: number,
    readonly column: number,
    readonly file: string = '<input>',
  ) {
    super(`${file}:${line}:${column}: ${message}`)
    this.name = 'ZeeError'
  }
}

export class PanicError extends Error {
  constructor(
    readonly panicMessage: string,
    readonly line: number = 1,
    readonly column: number = 1,
    readonly file: string = '<input>',
  ) {
    super(panicMessage)
    this.name = 'PanicError'
  }
}

export interface Loc {
  file: string
  line: number
  column: number
}

export function locOf(file: string, line: number, column: number): Loc {
  return { file, line, column }
}
