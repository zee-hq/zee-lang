import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { packStoreZip, unpackStoreZip } from '../src/zip-store.ts'

const temps: string[] = []

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zee-zip-'))
  temps.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('store zip (AC-ZEE-5)', () => {
  it('round-trips zee.toml and src files', () => {
    const zip = packStoreZip([
      { name: 'zee.toml', data: Buffer.from('name = "json"\n') },
      { name: 'src/lib.zee', data: Buffer.from('pub fn ping() {}\n') },
    ])
    const dest = scratch()
    unpackStoreZip(zip, dest)
    expect(readFileSync(join(dest, 'zee.toml'), 'utf8')).toBe('name = "json"\n')
    expect(readFileSync(join(dest, 'src/lib.zee'), 'utf8')).toBe('pub fn ping() {}\n')
  })

  it('rejects zip-slip paths', () => {
    const zip = packStoreZip([{ name: '../evil.zee', data: Buffer.from('nope') }])
    expect(() => unpackStoreZip(zip, scratch())).toThrow(/zip path/)
  })
})
