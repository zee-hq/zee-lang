declare module '*generate.mjs' {
  export const PALETTE: Record<string, string>
  export const KINDS: Array<{ id: string; color: string }>
  export const VARIANTS: string[]
  export const SYNTAX: Array<{ id: string; color: string; scope: string }>
  export function tokenColors(): Array<{
    scope: string
    settings: { foreground: string; fontStyle?: string }
  }>
  export function buildColorTheme(mode: string): unknown
  export function iconFileName(kindId: string, variant: string): string
  export function svgFor(kindId: string, color: string, variant: string, style?: string): string
  export function buildTheme(): any
  export function generate(outDir?: string): void
}
