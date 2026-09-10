import { ZeeError } from './error.ts'

export type VersionPrecision = 'major' | 'minor' | 'patch'

export interface Version {
  major: number
  minor: number
  patch: number
  precision: VersionPrecision
}

const VERSION_RE = /^(\d+)(?:\.(\d+)(?:\.(\d+))?)?$/

export function isVersionConstraint(raw: string): boolean {
  return VERSION_RE.test(raw)
}

/** SemVer with precision: `1.2.3` exact, `1.2` means 1.2.x, `1` means 1.x.x (AC-ZEE-5). */
export function parseVersion(raw: string, file = 'zee.toml'): Version {
  const match = VERSION_RE.exec(raw)
  if (!match) {
    throw new ZeeError(`invalid version \`${raw}\``, 1, 1, file)
  }
  const major = Number(match[1])
  if (match[3] !== undefined) {
    return { major, minor: Number(match[2]), patch: Number(match[3]), precision: 'patch' }
  }
  if (match[2] !== undefined) {
    return { major, minor: Number(match[2]), patch: 0, precision: 'minor' }
  }
  return { major, minor: 0, patch: 0, precision: 'major' }
}

export function formatVersion(version: Version): string {
  return `${version.major}.${version.minor}.${version.patch}`
}

export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (left.major !== right.major) return left.major - right.major
  if (left.minor !== right.minor) return left.minor - right.minor
  return left.patch - right.patch
}

export function satisfiesConstraint(version: string, constraint: string): boolean {
  const actual = parseVersion(version)
  const want = parseVersion(constraint)
  if (actual.major !== want.major) return false
  if (want.precision === 'major') return true
  if (actual.minor !== want.minor) return false
  if (want.precision === 'minor') return true
  return actual.patch === want.patch
}

export function pickMatchingVersion(published: string[], constraint: string): string | undefined {
  const matches = published.filter((item) => satisfiesConstraint(item, constraint))
  if (matches.length === 0) return undefined
  return matches.sort(compareVersions).at(-1)
}
