import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import { crc32 } from 'node:zlib'
import { ZeeError } from './error.ts'

export interface ZipEntry {
  name: string
  data: Buffer
}

const LOCAL = 0x04034b50
const CENTRAL = 0x02014b50
const EOCD = 0x06054b50
const UTF8 = 0x0800

/** Uncompressed ZIP of package files (AC-ZEE-5). */
export function packStoreZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const data = entry.data
    const crc = crc32(data)
    const local = Buffer.alloc(30 + name.length + data.length)
    local.writeUInt32LE(LOCAL, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(UTF8, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    name.copy(local, 30)
    data.copy(local, 30 + name.length)
    locals.push(local)

    const central = Buffer.alloc(46 + name.length)
    central.writeUInt32LE(CENTRAL, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(UTF8, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    name.copy(central, 46)
    centrals.push(central)
    offset += local.length
  }
  const cd = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(EOCD, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)
  return Buffer.concat([...locals, cd, eocd])
}

export function unpackStoreZip(zip: Buffer, dest: string): void {
  let offset = 0
  while (offset + 4 <= zip.length) {
    const sig = zip.readUInt32LE(offset)
    if (sig === CENTRAL || sig === EOCD) break
    if (sig !== LOCAL) {
      throw new ZeeError('invalid zip', 1, 1, 'zip')
    }
    const nameLen = zip.readUInt16LE(offset + 26)
    const extraLen = zip.readUInt16LE(offset + 28)
    const size = zip.readUInt32LE(offset + 22)
    const method = zip.readUInt16LE(offset + 8)
    if (method !== 0) {
      throw new ZeeError('zip must be stored (no compression)', 1, 1, 'zip')
    }
    const nameStart = offset + 30
    const name = zip.subarray(nameStart, nameStart + nameLen).toString('utf8')
    assertSafeZipPath(name)
    const dataStart = nameStart + nameLen + extraLen
    const data = zip.subarray(dataStart, dataStart + size)
    const file = join(dest, name)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, data)
    offset = dataStart + size
  }
}

function assertSafeZipPath(name: string): void {
  const normalized = posix.normalize(name)
  if (normalized.startsWith('/') || normalized.startsWith('\\') || normalized.split('/').includes('..')) {
    throw new ZeeError(`unsafe zip path \`${name}\``, 1, 1, 'zip')
  }
}
