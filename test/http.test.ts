import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createProject } from '../src/project.ts'
import { executePath } from '../src/zee.ts'

const temps: string[] = []
const HTTP_LIB = join(fileURLToPath(new URL('.', import.meta.url)), '../libs/http')
const JSON_LIB = join(fileURLToPath(new URL('.', import.meta.url)), '../libs/json')

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zee-http-'))
  temps.push(dir)
  return dir
}

function write(root: string, rel: string, source: string): void {
  const full = join(root, rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, source)
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('official http package (AC-http)', () => {
  function app(): string {
    const parent = scratch()
    const created = createProject({ name: 'app', parentDir: parent, mode: 'new' })
    write(
      created.root,
      'zee.toml',
      `[package]
name = "app"
version = "0.1.0"
entry = "src/main.zee"

[deps]
http = { path = "${HTTP_LIB}" }
json = { path = "${JSON_LIB}" }
`,
    )
    write(
      created.root,
      'src/users.zee',
      `import http
import http.{Request, Response}
import json

pub data struct UserRow {
  pub const id: i32
  pub const name: String
}

pub data struct StoreUser {
  pub const name: String
}

@Trace("users")
@Controller("/users")
pub class UsersController {
  var rows: List<UserRow>
  var nextId: i32

  pub fn empty() -> self {
    self { rows: [], nextId: 1 }
  }

  @Trace
  pub fn ping(self, _req: Request) -> Response {
    http.ok("traced")
  }

  @Get("/")
  pub fn index(self, _req: Request) -> Response {
    http.ok(json.encode(self.rows))
  }

  @Post("/")
  pub fn store(var self, req: Request) -> Response {
    const (body, err) = json.decode<StoreUser>(req.text)
    if err != None {
      return http.badRequest("invalid json")
    }
    const row = UserRow { id: self.nextId, name: body.name }
    self.rows = self.rows + [row]
    self.nextId = self.nextId + 1
    http.created(json.encode(row))
  }

  @Get("/:id")
  pub fn show(self, req: Request) -> Response {
    const (id, err) = http.i32Param(req, "id")
    if err != None {
      return http.badRequest("bad id")
    }
    const found = self.rows.find { it.id == id }
    if found.isNone() {
      return http.notFound("not found")
    }
    http.ok(json.encode(found ?: UserRow { id: 0, name: "" }))
  }
}
`,
    )
    write(
      created.root,
      'src/main.zee',
      `import http

fn main() {
  const app = http.router()
    .get("/health", "ok")
    .controller(UsersController.empty())
  const health = http.dispatch(app, http.request("GET", "/health", ""))
  println(str(health.status) + " " + health.text)
  const created = http.dispatch(app, http.request("POST", "/users", "{\\"name\\":\\"ada\\"}"))
  println(str(created.status) + " " + created.text)
  const shown = http.dispatch(app, http.request("GET", "/users/1", ""))
  println(str(shown.status) + " " + shown.text)
  const missing = http.dispatch(app, http.request("GET", "/nope", ""))
  println(str(missing.status) + " " + missing.text)
  const traced = http.dispatch(app, http.request("TRACE", "/users", ""))
  println(str(traced.status) + " " + traced.text)
}
`,
    )
    return created.root
  }

  it('dispatches static GET and a decorated controller', () => {
    const root = app()
    expect(executePath(join(root, 'src/main.zee')).stdout).toBe(
      '200 ok\n201 {"id":1,"name":"ada"}\n200 {"id":1,"name":"ada"}\n404 not found\n404 not found\n',
    )
  })

  it('binds @Param @Params @Query @Body @Request (AC-http-bind)', () => {
    const parent = scratch()
    const created = createProject({ name: 'bind', parentDir: parent, mode: 'new' })
    write(
      created.root,
      'zee.toml',
      `[package]
name = "bind"
version = "0.1.0"
entry = "src/main.zee"

[deps]
http = { path = "${HTTP_LIB}" }
json = { path = "${JSON_LIB}" }
`,
    )
    write(
      created.root,
      'src/echo.zee',
      `import http
import http.{Request, Response}

pub data struct StoreUser {
  pub const name: String
}

@Controller("/echo")
pub class Echo {
  var n: i32

  pub fn empty() -> self {
    self { n: 0 }
  }

  @Get("/p/:id")
  pub fn oneParam(self, @Param("id") id: String) -> Response {
    http.ok(id)
  }

  @Get("/n/:id")
  pub fn oneI32(self, @Param("id") id: i32) -> Response {
    http.ok(str(id))
  }

  @Get("/all/:id")
  pub fn allParams(self, @Params params: Map<String, String>) -> Response {
    http.ok(params["id"] ?: "")
  }

  @Get("/q")
  pub fn oneQuery(self, @Query("q") q: String) -> Response {
    http.ok(q)
  }

  @Get("/qs")
  pub fn allQuery(self, @Query query: Map<String, String>) -> Response {
    http.ok(query["q"] ?: "")
  }

  @Post("/body")
  pub fn body(self, @Body body: StoreUser) -> Response {
    http.ok(body.name)
  }

  @Get("/req")
  pub fn bag(self, @Request req: Request) -> Response {
    http.ok(req.method + " " + (req.query["q"] ?: ""))
  }
}
`,
    )
    write(
      created.root,
      'src/main.zee',
      `import http

fn main() {
  const app = http.router().controller(Echo.empty())
  const a = http.dispatch(app, http.request("GET", "/echo/p/ada", ""))
  println(str(a.status) + " " + a.text)
  const b = http.dispatch(app, http.request("GET", "/echo/n/7", ""))
  println(str(b.status) + " " + b.text)
  const c = http.dispatch(app, http.request("GET", "/echo/n/x", ""))
  println(str(c.status) + " " + c.text)
  const d = http.dispatch(app, http.request("GET", "/echo/all/bo", ""))
  println(str(d.status) + " " + d.text)
  const e = http.dispatch(app, http.request("GET", "/echo/q?q=ada+l", ""))
  println(str(e.status) + " " + e.text)
  const f = http.dispatch(app, http.request("GET", "/echo/q", ""))
  println(str(f.status) + " " + f.text)
  const g = http.dispatch(app, http.request("GET", "/echo/qs?q=ana", ""))
  println(str(g.status) + " " + g.text)
  const h = http.dispatch(app, http.request("POST", "/echo/body", "{\\"name\\":\\"ada\\"}"))
  println(str(h.status) + " " + h.text)
  const i = http.dispatch(app, http.request("POST", "/echo/body", "{"))
  println(str(i.status) + " " + i.text)
  const j = http.dispatch(app, http.request("GET", "/echo/req?q=hi", ""))
  println(str(j.status) + " " + j.text)
}
`,
    )
    expect(executePath(join(created.root, 'src/main.zee')).stdout).toBe(
      '200 ada\n200 7\n400 bad id\n200 bo\n200 ada l\n400 missing query\n200 ana\n200 ada\n400 invalid json\n200 GET hi\n',
    )
  })

  it('http.app() mounts @Controller types via of/empty (AC-http-quarkus)', () => {
    const parent = scratch()
    const created = createProject({ name: 'scan', parentDir: parent, mode: 'new' })
    write(
      created.root,
      'zee.toml',
      `[package]
name = "scan"
version = "0.1.0"
entry = "src/main.zee"

[deps]
http = { path = "${HTTP_LIB}" }
`,
    )
    write(
      created.root,
      'src/echo.zee',
      `import http
import http.Response

@Controller("/ping")
pub class Ping {
  pub fn empty() -> self {
    self {}
  }

  @Get("/")
  pub fn index(self) -> Response {
    http.ok("pong")
  }
}
`,
    )
    write(
      created.root,
      'src/main.zee',
      `import http

fn main() {
  const app = http.app()
  const res = http.dispatch(app, http.request("GET", "/ping", ""))
  println(str(res.status) + " " + res.text)
}
`,
    )
    expect(executePath(join(created.root, 'src/main.zee')).stdout).toBe('200 pong\n')
  })

  it('prefixes @Controller under src/modules/ when @PathPrefix is loaded (AC-http-prefix)', () => {
    const parent = scratch()
    const created = createProject({ name: 'prefix', parentDir: parent, mode: 'new' })
    write(
      created.root,
      'zee.toml',
      `[package]
name = "prefix"
version = "0.1.0"
entry = "src/main.zee"

[deps]
http = { path = "${HTTP_LIB}" }
`,
    )
    write(
      created.root,
      'src/shared/config/api.prefix.zee',
      `@Configuration
@PathPrefix("/api")
pub class ApiPrefixConfig {}
`,
    )
    write(
      created.root,
      'src/modules/users/users.controller.zee',
      `import http
import http.Response

@Controller("/users")
pub class UsersPing {
  pub fn empty() -> self {
    self {}
  }

  @Get("/")
  pub fn index(self) -> Response {
    http.ok("users")
  }
}
`,
    )
    write(
      created.root,
      'src/bootstrap/health.controller.zee',
      `import http
import http.Response

@Controller("/health")
pub class HealthPing {
  pub fn empty() -> self {
    self {}
  }

  @Get("/")
  pub fn index(self) -> Response {
    http.ok("ok")
  }
}
`,
    )
    write(
      created.root,
      'src/main.zee',
      `import http

fn main() {
  const app = http.app()
  const users = http.dispatch(app, http.request("GET", "/api/users", ""))
  println(str(users.status) + " " + users.text)
  const bare = http.dispatch(app, http.request("GET", "/users", ""))
  println(str(bare.status) + " " + bare.text)
  const health = http.dispatch(app, http.request("GET", "/health", ""))
  println(str(health.status) + " " + health.text)
}
`,
    )
    expect(executePath(join(created.root, 'src/main.zee')).stdout).toBe(
      '200 users\n404 not found\n200 ok\n',
    )
  })

  it('applies CORS when @Cors is loaded (AC-http-cors)', () => {
    const parent = scratch()
    const created = createProject({ name: 'cors', parentDir: parent, mode: 'new' })
    write(
      created.root,
      'zee.toml',
      `[package]
name = "cors"
version = "0.1.0"
entry = "src/main.zee"

[deps]
http = { path = "${HTTP_LIB}" }
`,
    )
    write(
      created.root,
      'src/shared/config/cors.zee',
      `import http.CorsProperties

@Provider
@Cors
pub class CorsFilter {
  pub fn properties() -> CorsProperties {
    const allowedOrigins: List<String> = ["https://shop.example.com"]
    const allowedOriginPatterns: List<String> = ["https://*.app.example.com"]
    CorsProperties { allowedOrigins: allowedOrigins, allowedOriginPatterns: allowedOriginPatterns }
  }
}
`,
    )
    write(
      created.root,
      'src/ping.zee',
      `import http
import http.Response

@Controller("/ping")
pub class Ping {
  pub fn empty() -> self {
    self {}
  }

  @Get("/")
  pub fn index(self) -> Response {
    http.ok("pong")
  }
}
`,
    )
    write(
      created.root,
      'src/main.zee',
      `import http
import http.Request
import http.Response

fn req(method: String, path: String, origin: String) -> Request {
  const params: Map<String, String> = {}
  const query: Map<String, String> = {}
  const headers: Map<String, String> = { "Origin": origin }
  Request { method: method, path: path, text: "", params: params, query: query, headers: headers }
}

fn corsOrigin(res: Response) -> String {
  res.headers["Access-Control-Allow-Origin"] ?: ""
}

fn main() {
  const app = http.app()
  const local = http.dispatch(app, req("GET", "/ping", "http://localhost:3000"))
  println(str(local.status) + " " + local.text + " " + corsOrigin(local))
  const loopback = http.dispatch(app, req("GET", "/ping", "http://127.0.0.1:8080"))
  println(corsOrigin(loopback))
  const sub = http.dispatch(app, req("GET", "/ping", "http://foo.localhost:3000"))
  println(corsOrigin(sub))
  const listed = http.dispatch(app, req("GET", "/ping", "https://shop.example.com"))
  println(corsOrigin(listed))
  const patterned = http.dispatch(app, req("GET", "/ping", "https://admin.app.example.com"))
  println(corsOrigin(patterned))
  const denied = http.dispatch(app, req("GET", "/ping", "https://evil.com"))
  println(str(denied.status) + " " + corsOrigin(denied))
  const preflight = http.dispatch(app, req("OPTIONS", "/ping", "http://localhost:3000"))
  println(str(preflight.status) + " " + corsOrigin(preflight))
}
`,
    )
    expect(executePath(join(created.root, 'src/main.zee')).stdout).toBe(
      '200 pong http://localhost:3000\nhttp://127.0.0.1:8080\nhttp://foo.localhost:3000\nhttps://shop.example.com\nhttps://admin.app.example.com\n200 \n200 http://localhost:3000\n',
    )
  })
})
