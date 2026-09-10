import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getPackages } from '../src/pkg.ts'
import { createProject } from '../src/project.ts'
import { listenRegistry } from '../src/registry-http.ts'
import { publishPackage } from '../src/registry.ts'
import { packStoreZip, unpackStoreZip } from '../src/zip-store.ts'
import { executePath } from '../src/zee.ts'
import { startRegistryProcess } from './registry-process.ts'

const temps: string[] = []

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zee-http-'))
  temps.push(dir)
  return dir
}

afterEach(() => {
  delete process.env.ZEE_REGISTRY
  delete process.env.ZEE_REGISTRY_TOKEN
  delete process.env.ZEE_HOME
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function write(root: string, rel: string, source: string): void {
  const full = join(root, rel)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, source)
}

function jsonLib(parent: string, version: string, ping: string): string {
  const lib = createProject({ name: 'json', parentDir: parent, mode: 'new' })
  write(lib.root, 'zee.toml', `[package]\nname = "json"\nversion = "${version}"\nentry = "src/main.zee"\n`)
  write(lib.root, 'src/lib.zee', `pub fn ping() -> String { "${ping}" }\n`)
  return lib.root
}

describe('HTTP registry server (AC-ZEE-5)', () => {
  it('PUT then GET zip over the documented API', async () => {
    const parent = scratch()
    const root = join(parent, 'store')
    const token = 'secret-token'
    const { url, close } = await listenRegistry({ root, token, host: '127.0.0.1', port: 0 })
    try {
      const lib = jsonLib(parent, '1.2.1', 'pong')
      const zip = packStoreZip([
        { name: 'zee.toml', data: readFileSync(join(lib, 'zee.toml')) },
        { name: 'src/lib.zee', data: readFileSync(join(lib, 'src/lib.zee')) },
      ])
      const put = await fetch(`${url}/api/v1/packages/json/1.2.1`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/zip' },
        body: zip,
      })
      expect(put.status).toBe(200)

      const listed = await fetch(`${url}/api/v1/packages/json`)
      expect(listed.status).toBe(200)
      expect(await listed.json()).toEqual({ name: 'json', versions: ['1.2.1'] })

      const got = await fetch(`${url}/api/v1/packages/json/1.2.1`)
      expect(got.status).toBe(200)
      expect(got.headers.get('content-type')).toMatch(/zip/)
      const dest = join(parent, 'unpacked')
      unpackStoreZip(Buffer.from(await got.arrayBuffer()), dest)
      expect(readFileSync(join(dest, 'src/lib.zee'), 'utf8')).toContain('pong')
    } finally {
      await close()
    }
  })

  it('refuses overwrite and missing bearer on PUT', async () => {
    const parent = scratch()
    const token = 'secret-token'
    const { url, close } = await listenRegistry({
      root: join(parent, 'store'),
      token,
      host: '127.0.0.1',
      port: 0,
    })
    try {
      const zip = packStoreZip([{ name: 'zee.toml', data: Buffer.from('[package]\nname = "json"\nversion = "1.0.0"\n') }])
      const first = await fetch(`${url}/api/v1/packages/json/1.0.0`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/zip' },
        body: zip,
      })
      expect(first.status).toBe(200)
      const again = await fetch(`${url}/api/v1/packages/json/1.0.0`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/zip' },
        body: zip,
      })
      expect(again.status).toBe(409)
      expect(await again.json()).toEqual({ error: 'already_published' })

      const unauth = await fetch(`${url}/api/v1/packages/json/1.0.1`, {
        method: 'PUT',
        headers: { 'content-type': 'application/zip' },
        body: zip,
      })
      expect(unauth.status).toBe(401)
      expect(await unauth.json()).toEqual({ error: 'unauthorized' })
    } finally {
      await close()
    }
  })
})

describe('zee publish + get over HTTP (AC-ZEE-5)', () => {
  it('publishes json@1.2.1 then resolves json = "1.2"', async () => {
    const parent = scratch()
    const token = 'secret-token'
    const proc = await startRegistryProcess({ root: join(parent, 'store'), token })
    try {
      process.env.ZEE_REGISTRY = proc.url
      process.env.ZEE_REGISTRY_TOKEN = token
      jsonLib(parent, '1.2.1', 'pong')
      const libRoot = join(parent, 'json')
      const published = publishPackage(libRoot)
      expect(published.dest).toContain('/api/v1/packages/json/1.2.1')

      const app = createProject({ name: 'app', parentDir: parent, mode: 'new' })
      write(
        app.root,
        'zee.toml',
        `[package]\nname = "app"\nversion = "0.1.0"\nentry = "src/main.zee"\n\n[deps]\njson = "1.2"\n`,
      )
      write(app.root, 'src/main.zee', 'import json.ping\nfn main() {\n  println(ping())\n}\n')
      const got = getPackages(app.root)
      expect(got.packages[0]?.version).toBe('1.2.1')
      expect(existsSync(join(app.root, '.zee/json/src/lib.zee'))).toBe(true)
      expect(executePath(join(app.root, 'src/main.zee')).stdout).toBe('pong\n')
    } finally {
      proc.stop()
    }
  })
})
