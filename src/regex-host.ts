export type CompiledRegex = {
  source: string
  ok: boolean
  re?: RegExp
}

export function compileRegex(source: string): CompiledRegex {
  try {
    return { source, ok: true, re: new RegExp(source, 'u') }
  } catch {
    return { source, ok: false }
  }
}

export function regexIsMatch(compiled: CompiledRegex, text: string): boolean {
  if (!compiled.ok || !compiled.re) return false
  compiled.re.lastIndex = 0
  return compiled.re.test(text)
}
