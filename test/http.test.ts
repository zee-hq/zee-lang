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

  it('exposes HttpCode for every registered status (AC-http-code)', () => {
    const parent = scratch()
    const created = createProject({ name: 'codes', parentDir: parent, mode: 'new' })
    write(
      created.root,
      'zee.toml',
      `[package]
name = "codes"
version = "0.1.0"
entry = "src/main.zee"

[deps]
http = { path = "${HTTP_LIB}" }
`,
    )
    write(
      created.root,
      'src/main.zee',
      `import http.HttpCode

fn eq(got: i32, want: i32) {
  if got != want {
    panic(str(got) + " != " + str(want))
  }
}

fn main() {
  eq(HttpCode.Continue.code(), 100)
  eq(HttpCode.SwitchingProtocols.code(), 101)
  eq(HttpCode.Processing.code(), 102)
  eq(HttpCode.EarlyHints.code(), 103)
  eq(HttpCode.Ok.code(), 200)
  eq(HttpCode.Created.code(), 201)
  eq(HttpCode.Accepted.code(), 202)
  eq(HttpCode.NonAuthoritativeInformation.code(), 203)
  eq(HttpCode.NoContent.code(), 204)
  eq(HttpCode.ResetContent.code(), 205)
  eq(HttpCode.PartialContent.code(), 206)
  eq(HttpCode.MultiStatus.code(), 207)
  eq(HttpCode.AlreadyReported.code(), 208)
  eq(HttpCode.ImUsed.code(), 226)
  eq(HttpCode.MultipleChoices.code(), 300)
  eq(HttpCode.MovedPermanently.code(), 301)
  eq(HttpCode.Found.code(), 302)
  eq(HttpCode.SeeOther.code(), 303)
  eq(HttpCode.NotModified.code(), 304)
  eq(HttpCode.UseProxy.code(), 305)
  eq(HttpCode.TemporaryRedirect.code(), 307)
  eq(HttpCode.PermanentRedirect.code(), 308)
  eq(HttpCode.BadRequest.code(), 400)
  eq(HttpCode.Unauthorized.code(), 401)
  eq(HttpCode.PaymentRequired.code(), 402)
  eq(HttpCode.Forbidden.code(), 403)
  eq(HttpCode.NotFound.code(), 404)
  eq(HttpCode.MethodNotAllowed.code(), 405)
  eq(HttpCode.NotAcceptable.code(), 406)
  eq(HttpCode.ProxyAuthenticationRequired.code(), 407)
  eq(HttpCode.RequestTimeout.code(), 408)
  eq(HttpCode.Conflict.code(), 409)
  eq(HttpCode.Gone.code(), 410)
  eq(HttpCode.LengthRequired.code(), 411)
  eq(HttpCode.PreconditionFailed.code(), 412)
  eq(HttpCode.PayloadTooLarge.code(), 413)
  eq(HttpCode.UriTooLong.code(), 414)
  eq(HttpCode.UnsupportedMediaType.code(), 415)
  eq(HttpCode.RangeNotSatisfiable.code(), 416)
  eq(HttpCode.ExpectationFailed.code(), 417)
  eq(HttpCode.ImATeapot.code(), 418)
  eq(HttpCode.MisdirectedRequest.code(), 421)
  eq(HttpCode.UnprocessableEntity.code(), 422)
  eq(HttpCode.Locked.code(), 423)
  eq(HttpCode.FailedDependency.code(), 424)
  eq(HttpCode.TooEarly.code(), 425)
  eq(HttpCode.UpgradeRequired.code(), 426)
  eq(HttpCode.PreconditionRequired.code(), 428)
  eq(HttpCode.TooManyRequests.code(), 429)
  eq(HttpCode.RequestHeaderFieldsTooLarge.code(), 431)
  eq(HttpCode.UnavailableForLegalReasons.code(), 451)
  eq(HttpCode.InternalServerError.code(), 500)
  eq(HttpCode.NotImplemented.code(), 501)
  eq(HttpCode.BadGateway.code(), 502)
  eq(HttpCode.ServiceUnavailable.code(), 503)
  eq(HttpCode.GatewayTimeout.code(), 504)
  eq(HttpCode.HttpVersionNotSupported.code(), 505)
  eq(HttpCode.VariantAlsoNegotiates.code(), 506)
  eq(HttpCode.InsufficientStorage.code(), 507)
  eq(HttpCode.LoopDetected.code(), 508)
  eq(HttpCode.NotExtended.code(), 510)
  eq(HttpCode.NetworkAuthenticationRequired.code(), 511)
  println("ok")
}
`,
    )
    expect(executePath(join(created.root, 'src/main.zee')).stdout).toBe('ok\n')
  })

  it('builds a Response from HttpCode or a named helper (AC-http-response)', () => {
    const parent = scratch()
    const created = createProject({ name: 'res', parentDir: parent, mode: 'new' })
    write(
      created.root,
      'zee.toml',
      `[package]
name = "res"
version = "0.1.0"
entry = "src/main.zee"

[deps]
http = { path = "${HTTP_LIB}" }
`,
    )
    write(
      created.root,
      'src/main.zee',
      `import http
import http.HttpCode

fn eq(got: i32, want: i32) {
  if got != want {
    panic(str(got) + " != " + str(want))
  }
}

fn main() {
  const generic = http.response(HttpCode.Continue, "go")
  eq(generic.status, 100)
  if generic.text != "go" {
    panic(generic.text)
  }
  eq(http.response(HttpCode.ImATeapot, "short").status, 418)
  eq(http.switchingProtocols("").status, 101)
  eq(http.processing("").status, 102)
  eq(http.earlyHints("").status, 103)
  eq(http.ok("x").status, 200)
  eq(http.created("x").status, 201)
  eq(http.accepted("").status, 202)
  eq(http.nonAuthoritativeInformation("").status, 203)
  eq(http.noContent("").status, 204)
  eq(http.resetContent("").status, 205)
  eq(http.partialContent("").status, 206)
  eq(http.multiStatus("").status, 207)
  eq(http.alreadyReported("").status, 208)
  eq(http.imUsed("").status, 226)
  eq(http.multipleChoices("").status, 300)
  eq(http.movedPermanently("").status, 301)
  eq(http.found("").status, 302)
  eq(http.seeOther("").status, 303)
  eq(http.notModified("").status, 304)
  eq(http.useProxy("").status, 305)
  eq(http.temporaryRedirect("").status, 307)
  eq(http.permanentRedirect("").status, 308)
  eq(http.badRequest("x").status, 400)
  eq(http.unauthorized("").status, 401)
  eq(http.paymentRequired("").status, 402)
  eq(http.forbidden("").status, 403)
  eq(http.notFound("x").status, 404)
  eq(http.methodNotAllowed("").status, 405)
  eq(http.notAcceptable("").status, 406)
  eq(http.proxyAuthenticationRequired("").status, 407)
  eq(http.requestTimeout("").status, 408)
  eq(http.conflict("").status, 409)
  eq(http.gone("").status, 410)
  eq(http.lengthRequired("").status, 411)
  eq(http.preconditionFailed("").status, 412)
  eq(http.payloadTooLarge("").status, 413)
  eq(http.uriTooLong("").status, 414)
  eq(http.unsupportedMediaType("").status, 415)
  eq(http.rangeNotSatisfiable("").status, 416)
  eq(http.expectationFailed("").status, 417)
  eq(http.imATeapot("").status, 418)
  eq(http.misdirectedRequest("").status, 421)
  eq(http.unprocessableEntity("").status, 422)
  eq(http.locked("").status, 423)
  eq(http.failedDependency("").status, 424)
  eq(http.tooEarly("").status, 425)
  eq(http.upgradeRequired("").status, 426)
  eq(http.preconditionRequired("").status, 428)
  eq(http.tooManyRequests("").status, 429)
  eq(http.requestHeaderFieldsTooLarge("").status, 431)
  eq(http.unavailableForLegalReasons("").status, 451)
  eq(http.internalServerError("").status, 500)
  eq(http.notImplemented("").status, 501)
  eq(http.badGateway("").status, 502)
  eq(http.serviceUnavailable("").status, 503)
  eq(http.gatewayTimeout("").status, 504)
  eq(http.httpVersionNotSupported("").status, 505)
  eq(http.variantAlsoNegotiates("").status, 506)
  eq(http.insufficientStorage("").status, 507)
  eq(http.loopDetected("").status, 508)
  eq(http.notExtended("").status, 510)
  eq(http.networkAuthenticationRequired("").status, 511)
  println("ok")
}
`,
    )
    expect(executePath(join(created.root, 'src/main.zee')).stdout).toBe('ok\n')
  })

  it('dispatches resource create and edit (AC-http-resource)', () => {
    const parent = scratch()
    const created = createProject({ name: 'resrc', parentDir: parent, mode: 'new' })
    write(
      created.root,
      'zee.toml',
      `[package]
name = "resrc"
version = "0.1.0"
entry = "src/main.zee"

[deps]
http = { path = "${HTTP_LIB}" }
`,
    )
    write(
      created.root,
      'src/users.zee',
      `import http
import http.{Request, Response, Resource}

pub class Users implements Resource {
  pub fn empty() -> self {
    self {}
  }

  pub fn index(self, _req: Request) -> Response {
    http.ok("index")
  }

  pub fn create(self, _req: Request) -> Response {
    http.ok("create")
  }

  pub fn store(var self, _req: Request) -> Response {
    http.created("store")
  }

  pub fn show(self, req: Request) -> Response {
    const (id, err) = http.i32Param(req, "id")
    if err != None {
      return http.badRequest("bad id")
    }
    http.ok("show " + str(id))
  }

  pub fn edit(self, req: Request) -> Response {
    const (id, err) = http.i32Param(req, "id")
    if err != None {
      return http.badRequest("bad id")
    }
    http.ok("edit " + str(id))
  }

  pub fn update(var self, _req: Request) -> Response {
    http.ok("update")
  }

  pub fn destroy(var self, _req: Request) -> Response {
    http.ok("destroy")
  }
}
`,
    )
    write(
      created.root,
      'src/main.zee',
      `import http

fn main() {
  const app = http.router().resource("/users", Users.empty())
  const created = http.dispatch(app, http.request("GET", "/users/create", ""))
  println(str(created.status) + " " + created.text)
  const edited = http.dispatch(app, http.request("GET", "/users/1/edit", ""))
  println(str(edited.status) + " " + edited.text)
  const shown = http.dispatch(app, http.request("GET", "/users/1", ""))
  println(str(shown.status) + " " + shown.text)
}
`,
    )
    expect(executePath(join(created.root, 'src/main.zee')).stdout).toBe(
      '200 create\n200 edit 1\n200 show 1\n',
    )
  })

  it('dispatches api resource verbs without create or edit (AC-http-api-resource)', () => {
    const parent = scratch()
    const created = createProject({ name: 'apires', parentDir: parent, mode: 'new' })
    write(
      created.root,
      'zee.toml',
      `[package]
name = "apires"
version = "0.1.0"
entry = "src/main.zee"

[deps]
http = { path = "${HTTP_LIB}" }
`,
    )
    write(
      created.root,
      'src/users.zee',
      `import http
import http.{Request, Response, ApiResource}

pub class Users implements ApiResource {
  pub fn empty() -> self {
    self {}
  }

  pub fn index(self, _req: Request) -> Response {
    http.ok("index")
  }

  pub fn store(var self, _req: Request) -> Response {
    http.created("store")
  }

  pub fn show(self, req: Request) -> Response {
    const (id, err) = http.i32Param(req, "id")
    if err != None {
      return http.badRequest("bad id")
    }
    http.ok("show " + str(id))
  }

  pub fn update(var self, _req: Request) -> Response {
    http.ok("update")
  }

  pub fn destroy(var self, _req: Request) -> Response {
    http.ok("destroy")
  }
}
`,
    )
    write(
      created.root,
      'src/main.zee',
      `import http

fn main() {
  const app = http.router().apiResource("/users", Users.empty())
  const listed = http.dispatch(app, http.request("GET", "/users", ""))
  println(str(listed.status) + " " + listed.text)
  const form = http.dispatch(app, http.request("GET", "/users/create", ""))
  println(str(form.status) + " " + form.text)
  const edited = http.dispatch(app, http.request("GET", "/users/1/edit", ""))
  println(str(edited.status) + " " + edited.text)
  const shown = http.dispatch(app, http.request("GET", "/users/1", ""))
  println(str(shown.status) + " " + shown.text)
  const stored = http.dispatch(app, http.request("POST", "/users", ""))
  println(str(stored.status) + " " + stored.text)
}
`,
    )
    expect(executePath(join(created.root, 'src/main.zee')).stdout).toBe(
      '200 index\n400 bad id\n404 not found\n200 show 1\n201 store\n',
    )
  })

  it('builds an abort Response from HttpCode (AC-http-abort)', () => {
    const parent = scratch()
    const created = createProject({ name: 'abort', parentDir: parent, mode: 'new' })
    write(
      created.root,
      'zee.toml',
      `[package]
name = "abort"
version = "0.1.0"
entry = "src/main.zee"

[deps]
http = { path = "${HTTP_LIB}" }
`,
    )
    write(
      created.root,
      'src/main.zee',
      `import http
import http.HttpCode

fn main() {
  const stopped = http.abort(HttpCode.NotFound, "gone")
  println(str(stopped.status) + " " + stopped.text)
  const forbidden = http.abort(HttpCode.Forbidden, "no")
  println(str(forbidden.status) + " " + forbidden.text)
  const failed = http.fail(error("boom"))
  println(str(failed.status) + " " + failed.text)
}
`,
    )
    expect(executePath(join(created.root, 'src/main.zee')).stdout).toBe('404 gone\n403 no\n500 boom\n')
  })

  it('routes abort and fail through @ErrorHandler (AC-http-error-handler)', () => {
    const parent = scratch()
    const created = createProject({ name: 'errh', parentDir: parent, mode: 'new' })
    write(
      created.root,
      'zee.toml',
      `[package]
name = "errh"
version = "0.1.0"
entry = "src/main.zee"

[deps]
http = { path = "${HTTP_LIB}" }
`,
    )
    write(
      created.root,
      'src/shared/errors/handler.zee',
      `import http
import http.{Request, Response, HttpError}

@ErrorHandler
pub class Handler {
  pub fn handle(err: Error, _req: Request) -> Response {
    if err is HttpError {
      return http.response(err.code, "http:" + err.text)
    }
    http.ok("err:" + err.message())
  }
}
`,
    )
    write(
      created.root,
      'src/gone.zee',
      `import http
import http.{HttpCode, Response}

@Controller("/gone")
pub class Gone {
  pub fn empty() -> self {
    self {}
  }

  @Get("/")
  pub fn index(self) -> Response {
    http.abort(HttpCode.NotFound, "missing")
  }

  @Get("/boom")
  pub fn boom(self) -> Response {
    http.fail(error("boom"))
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
  const stopped = http.dispatch(app, http.request("GET", "/gone", ""))
  println(str(stopped.status) + " " + stopped.text)
  const failed = http.dispatch(app, http.request("GET", "/gone/boom", ""))
  println(str(failed.status) + " " + failed.text)
}
`,
    )
    expect(executePath(join(created.root, 'src/main.zee')).stdout).toBe('404 http:missing\n200 err:boom\n')
  })
})
