import { describe, expect, it } from 'vitest'
import {
  compareVersions,
  isVersionConstraint,
  parseVersion,
  pickMatchingVersion,
  satisfiesConstraint,
} from '../src/semver.ts'

describe('SemVer precision (AC-ZEE-5)', () => {
  it('parses major.minor.patch', () => {
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, precision: 'patch' })
    expect(parseVersion('1.2')).toEqual({ major: 1, minor: 2, patch: 0, precision: 'minor' })
    expect(parseVersion('1')).toEqual({ major: 1, minor: 0, patch: 0, precision: 'major' })
  })

  it('orders versions', () => {
    expect(compareVersions('1.2.0', '1.2.1')).toBeLessThan(0)
    expect(compareVersions('1.3.0', '1.2.9')).toBeGreaterThan(0)
    expect(compareVersions('1.2.0', '1.2.0')).toBe(0)
  })

  it('1.2.3 is exact; 1.2 is >=1.2.0 <1.3.0; 1 is >=1.0.0 <2.0.0', () => {
    expect(satisfiesConstraint('1.2.3', '1.2.3')).toBe(true)
    expect(satisfiesConstraint('1.2.4', '1.2.3')).toBe(false)
    expect(satisfiesConstraint('1.2.0', '1.2')).toBe(true)
    expect(satisfiesConstraint('1.2.9', '1.2')).toBe(true)
    expect(satisfiesConstraint('1.3.0', '1.2')).toBe(false)
    expect(satisfiesConstraint('1.9.0', '1')).toBe(true)
    expect(satisfiesConstraint('2.0.0', '1')).toBe(false)
  })

  it('detects SemVer constraints vs git refs', () => {
    expect(isVersionConstraint('1.2.3')).toBe(true)
    expect(isVersionConstraint('1.2')).toBe(true)
    expect(isVersionConstraint('1')).toBe(true)
    expect(isVersionConstraint('main')).toBe(false)
    expect(isVersionConstraint('v1.0.0')).toBe(false)
  })

  it('picks the latest matching published version', () => {
    const published = ['1.1.9', '1.2.0', '1.2.4', '1.3.0']
    expect(pickMatchingVersion(published, '1.2')).toBe('1.2.4')
    expect(pickMatchingVersion(published, '1.2.0')).toBe('1.2.0')
    expect(pickMatchingVersion(published, '1')).toBe('1.3.0')
    expect(pickMatchingVersion(published, '2')).toBeUndefined()
  })
})
