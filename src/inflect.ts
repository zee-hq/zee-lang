const UNCOUNTABLE = new Set([
  'api',
  'auth',
  'bootstrap',
  'css',
  'html',
  'http',
  'https',
  'io',
  'json',
  'llvm',
  'math',
  'os',
  'shared',
  'sql',
  'ssl',
  'tls',
  'ui',
  'wasm',
  'xml',
])

/** Laravel-style inflection for layer file stems: user → users. AC-generate-inflect. */
export function pluralize(word: string): string {
  if (UNCOUNTABLE.has(word)) return word
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`
  if (/(?:x|z|ch|sh)$/.test(word)) return `${word}es`
  if (word.endsWith('ss')) return `${word}es`
  if (word.endsWith('s')) return word
  return `${word}s`
}

export function pluralizeLast(segments: string[]): string[] {
  if (segments.length === 0) return segments
  const last = segments[segments.length - 1]!
  return [...segments.slice(0, -1), pluralize(last)]
}
