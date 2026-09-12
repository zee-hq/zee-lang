import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { ZeeValue } from './interpreter.ts'

export type HttpMatch =
  | { kind: 'static'; body: string }
  | { kind: 'resource'; verb: string; controller: ZeeValue; params: Record<string, string> }
  | { kind: 'none' }

export function matchHttpRoute(router: ZeeValue, method: string, path: string): HttpMatch {
  const verb = method.toUpperCase()
  const pathname = stripQuery(path)
  if (router.type !== 'struct') return { kind: 'none' }
  const staticGets = router.fields.staticGets
  if (verb === 'GET' && staticGets?.type === 'list') {
    for (const item of staticGets.items) {
      if (item.type !== 'struct') continue
      const routePath = stringField(item, 'path')
      const body = stringField(item, 'body')
      if (routePath !== undefined && body !== undefined && normalizePath(routePath) === pathname) {
        return { kind: 'static', body }
      }
    }
  }
  const mounts = router.fields.mounts
  if (mounts?.type !== 'list') return { kind: 'none' }
  for (const item of mounts.items) {
    if (item.type !== 'struct') continue
    const prefix = stringField(item, 'prefix')
    const resource = item.fields.resource
    if (prefix === undefined || !resource) continue
    const hit = matchResource(verb, pathname, prefix, resource)
    if (hit) return hit
  }
  return { kind: 'none' }
}

export function httpResponseValue(
  status: number,
  text: string,
  headers: Record<string, string> = {},
): ZeeValue {
  return {
    type: 'struct',
    name: 'Response',
    module: 'http',
    data: true,
    readonly: false,
    identity: false,
    fields: {
      status: { type: 'i32', value: status },
      text: { type: 'string', value: text },
      headers: stringMap(headers),
    },
    fieldMut: { status: false, text: false, headers: false },
  }
}

export function httpRequestValue(
  method: string,
  path: string,
  text: string,
  params: Record<string, string>,
  headers: Record<string, string> = {},
): ZeeValue {
  const query = parseQueryString(path)
  return {
    type: 'struct',
    name: 'Request',
    module: 'http',
    data: true,
    readonly: false,
    identity: false,
    fields: {
      method: { type: 'string', value: method },
      path: { type: 'string', value: path },
      text: { type: 'string', value: text },
      params: stringMap(params),
      query: stringMap(query),
      headers: stringMap(headers),
    },
    fieldMut: { method: false, path: false, text: false, params: false, query: false, headers: false },
  }
}

export function readHttpRequest(req: ZeeValue): {
  method: string
  path: string
  text: string
  headers: Record<string, string>
} {
  if (req.type !== 'struct') {
    throw new Error('httpDispatch expects a Request')
  }
  const method = stringField(req, 'method') ?? 'GET'
  const path = stringField(req, 'path') ?? '/'
  const text = stringField(req, 'text') ?? ''
  return { method, path, text, headers: stringMapFromValue(req.fields.headers) }
}

export function readHttpResponse(res: ZeeValue): {
  status: number
  text: string
  headers: Record<string, string>
} {
  if (res.type !== 'struct') return { status: 500, text: 'internal error', headers: {} }
  const statusField = res.fields.status
  const text = stringField(res, 'text') ?? ''
  const status = statusField?.type === 'i32' ? statusField.value : 500
  return { status, text, headers: stringMapFromValue(res.fields.headers) }
}

export function i32ParamFromRequest(req: ZeeValue, name: string): ZeeValue {
  if (req.type !== 'struct') {
    return i32ParamErr(`missing param \`${name}\``)
  }
  const params = req.fields.params
  if (params?.type !== 'map') return i32ParamErr(`missing param \`${name}\``)
  const hashed = `str:${JSON.stringify(name)}`
  const entry = params.entries.get(hashed)
  if (!entry || entry.value.type !== 'string') return i32ParamErr(`missing param \`${name}\``)
  const n = Number(entry.value.value)
  if (!Number.isInteger(n)) return i32ParamErr(`bad param \`${name}\``)
  return {
    type: 'tuple',
    items: [
      { type: 'i32', value: n },
      { type: 'option', tag: 'none' },
    ],
  }
}

export function parseListenAddr(addr: string): { host: string; port: number } {
  const trimmed = addr.trim()
  const colon = trimmed.lastIndexOf(':')
  if (colon <= 0) {
    throw new Error('http.listen expects `host:port`')
  }
  const host = trimmed.slice(0, colon)
  const port = Number(trimmed.slice(colon + 1))
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('http.listen expects `host:port`')
  }
  return { host, port }
}

export function startHttpServer(
  addr: string,
  handle: (
    method: string,
    path: string,
    text: string,
    headers: Record<string, string>,
  ) => { status: number; text: string; headers: Record<string, string> },
): void {
  const { host, port } = parseListenAddr(addr)
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    req.on('end', () => {
      const method = req.method ?? 'GET'
      const url = req.url ?? '/'
      const text = Buffer.concat(chunks).toString('utf8')
      const out = handle(method, url, text, incomingHeaders(req))
      const json = out.text.startsWith('{') || out.text.startsWith('[')
      res.writeHead(out.status, {
        'content-type': json ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
        ...out.headers,
      })
      res.end(out.text)
    })
  })
  server.listen(port, host)
}

const LOCALHOST_SUBDOMAIN =
  /^https?:\/\/([a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]*\.)?localhost(:\d+)?$/
const LOCALHOST = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/

export function headerGet(headers: Record<string, string>, name: string): string | undefined {
  const want = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === want) return value
  }
  return undefined
}

export type CorsConfig = {
  allowedOrigins: string[]
  allowedOriginPatterns: string[]
}

export function resolveCorsAllowOrigin(origin: string | undefined, config: CorsConfig): string | undefined {
  if (!origin) return undefined
  if (LOCALHOST_SUBDOMAIN.test(origin) || LOCALHOST.test(origin)) return origin
  if (config.allowedOrigins.includes(origin)) return origin
  for (const pattern of config.allowedOriginPatterns) {
    if (antMatch(pattern, origin)) return origin
  }
  return undefined
}

export function corsResponseHeaders(allowOrigin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Expose-Headers': '*',
  }
}

export function applyCorsHeaders(res: ZeeValue, origin: string | undefined, config: CorsConfig): ZeeValue {
  const allow = resolveCorsAllowOrigin(origin, config)
  if (!allow) return res
  const out = readHttpResponse(res)
  return httpResponseValue(out.status, out.text, { ...out.headers, ...corsResponseHeaders(allow) })
}

function antMatch(pattern: string, str: string): boolean {
  return antMatchAt(pattern, 0, str, 0)
}

function antMatchAt(pat: string, pi: number, str: string, si: number): boolean {
  while (pi < pat.length) {
    const p = pat.charAt(pi)
    if (p === '*') {
      pi++
      if (pi >= pat.length) return true
      for (let i = si; i <= str.length; i++) {
        if (antMatchAt(pat, pi, str, i)) return true
      }
      return false
    }
    if (si >= str.length) return false
    if (p === '?') {
      pi++
      si++
      continue
    }
    if (p !== str.charAt(si)) return false
    pi++
    si++
  }
  return si === str.length
}

function incomingHeaders(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') out[key] = value
    else if (Array.isArray(value) && value[0] !== undefined) out[key] = value[0]
  }
  return out
}

function stringMapFromValue(value: ZeeValue | undefined): Record<string, string> {
  if (value?.type !== 'map') return {}
  const out: Record<string, string> = {}
  for (const entry of value.entries.values()) {
    if (entry.key.type === 'string' && entry.value.type === 'string') {
      out[entry.key.value] = entry.value.value
    }
  }
  return out
}

function matchResource(
  method: string,
  pathname: string,
  prefix: string,
  controller: ZeeValue,
): HttpMatch | undefined {
  const base = normalizePath(prefix)
  if (pathname === base) {
    if (method === 'GET') return { kind: 'resource', verb: 'index', controller, params: {} }
    if (method === 'POST') return { kind: 'resource', verb: 'store', controller, params: {} }
    return undefined
  }
  if (!pathname.startsWith(`${base}/`)) return undefined
  const rest = pathname.slice(base.length + 1)
  if (rest.length === 0 || rest.includes('/')) return undefined
  const params = { id: rest }
  if (method === 'GET') return { kind: 'resource', verb: 'show', controller, params }
  if (method === 'PUT' || method === 'PATCH') return { kind: 'resource', verb: 'update', controller, params }
  if (method === 'DELETE') return { kind: 'resource', verb: 'destroy', controller, params }
  return undefined
}

function stringField(value: ZeeValue, name: string): string | undefined {
  if (value.type !== 'struct' && value.type !== 'sealed') return undefined
  const field = value.fields[name]
  return field?.type === 'string' ? field.value : undefined
}

function stringMap(params: Record<string, string>): ZeeValue {
  const entries = new Map<string, { key: ZeeValue; value: ZeeValue }>()
  for (const [key, value] of Object.entries(params)) {
    entries.set(`str:${JSON.stringify(key)}`, {
      key: { type: 'string', value: key },
      value: { type: 'string', value },
    })
  }
  return { type: 'map', entries, key: { kind: 'string' }, value: { kind: 'string' } }
}

function i32ParamErr(message: string): ZeeValue {
  return {
    type: 'tuple',
    items: [
      { type: 'i32', value: 0 },
      { type: 'option', tag: 'some', value: { type: 'error', message } },
    ],
  }
}

function stripQuery(path: string): string {
  const q = path.indexOf('?')
  return normalizePath(q < 0 ? path : path.slice(0, q))
}

export function parseQueryString(path: string): Record<string, string> {
  const q = path.indexOf('?')
  if (q < 0) return {}
  const search = path.slice(q + 1)
  const out: Record<string, string> = {}
  if (search.length === 0) return out
  for (const part of search.split('&')) {
    if (part.length === 0) continue
    const eq = part.indexOf('=')
    const rawKey = eq < 0 ? part : part.slice(0, eq)
    const rawVal = eq < 0 ? '' : part.slice(eq + 1)
    const key = decodeQueryComponent(rawKey)
    if (key.length === 0 || Object.prototype.hasOwnProperty.call(out, key)) continue
    out[key] = decodeQueryComponent(rawVal)
  }
  return out
}

function decodeQueryComponent(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '))
  } catch {
    return value.replace(/\+/g, ' ')
  }
}

function normalizePath(path: string): string {
  if (path.length === 0) return '/'
  const withSlash = path.startsWith('/') ? path : `/${path}`
  if (withSlash.length > 1 && withSlash.endsWith('/')) return withSlash.slice(0, -1)
  return withSlash
}

