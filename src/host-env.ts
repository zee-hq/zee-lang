import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseManifest } from './project.ts'

const PROFILE_RE = /^[A-Za-z0-9._-]+$/

export interface EnvHost {
  processEnv: NodeJS.Dict<string>
  readText: (path: string) => string | undefined
}

export type LoadedEnv = {
  profile: string
  overlay: Map<string, string>
  app: Map<string, string>
}

export interface HostEnvIo {
  root?: string
  processEnv?: NodeJS.Dict<string>
  readText?: (path: string) => string | undefined
}

const cache = new WeakMap<object, LoadedEnv>()

export function isSafeProfile(name: string): boolean {
  return PROFILE_RE.test(name)
}

export function parseDotenv(source: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const body = line.startsWith('export ') ? line.slice('export '.length).trim() : line
    const eq = body.indexOf('=')
    if (eq <= 0) continue
    const key = body.slice(0, eq).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    let value = body.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1)
    } else {
      const hash = value.indexOf(' #')
      if (hash >= 0) value = value.slice(0, hash).trimEnd()
    }
    out.set(key, value)
  }
  return out
}

export function loadHostEnv(root: string | undefined, host: EnvHost): LoadedEnv {
  const overlay = new Map<string, string>()
  let app = new Map<string, string>()
  if (root) {
    mergeFile(overlay, host.readText(join(root, '.env')))
    mergeFile(overlay, host.readText(join(root, '.env.local')))
    app = readPackageMeta(host.readText(join(root, 'zee.toml')), join(root, 'zee.toml'))
  }

  const profile =
    pickProfile(host.processEnv.ZEE_PROFILE) ??
    pickProfile(host.processEnv.ZEE_ENV) ??
    pickProfile(overlay.get('ZEE_PROFILE')) ??
    pickProfile(overlay.get('ZEE_ENV')) ??
    'dev'

  if (root) {
    mergeFile(overlay, host.readText(join(root, `.env.${profile}`)))
    mergeFile(overlay, host.readText(join(root, `.env.${profile}.local`)))
  }

  return { profile, overlay, app }
}

export function lookupEnv(
  name: string,
  loaded: LoadedEnv,
  processEnv: NodeJS.Dict<string>,
): string | undefined {
  if (Object.hasOwn(processEnv, name) && processEnv[name] !== undefined) {
    return processEnv[name]
  }
  return loaded.overlay.get(name)
}

export function defaultReadText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

/** Overlay is loaded once per RuntimeIo; process env is read live on each lookup. */
export function hostEnvFor(io: HostEnvIo): LoadedEnv {
  let loaded = cache.get(io)
  if (!loaded) {
    loaded = loadHostEnv(io.root, {
      processEnv: io.processEnv ?? process.env,
      readText: io.readText ?? defaultReadText,
    })
    cache.set(io, loaded)
  }
  return loaded
}

function pickProfile(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  const name = raw.trim()
  if (!name || !isSafeProfile(name)) return undefined
  return name
}

function mergeFile(overlay: Map<string, string>, text: string | undefined): void {
  if (text === undefined) return
  for (const [key, value] of parseDotenv(text)) {
    overlay.set(key, value)
  }
}

function readPackageMeta(source: string | undefined, file: string): Map<string, string> {
  if (source === undefined) return new Map()
  try {
    return parseManifest(source, file).meta
  } catch {
    return new Map()
  }
}
