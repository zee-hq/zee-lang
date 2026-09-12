# http

Official Zee HTTP listen/dispatch. The language stores `@Name` as metadata. **This package** reads `@Get` / `@Post` / `@Put` / `@Patch` / `@Delete` / `@Controller` on types and methods, `@Param` / `@Params` / `@Query` / `@Body` / `@Request` on parameters, and `@Valid` on methods.

```zee
import http

fn main() {
  http.listen("127.0.0.1:8080", http.app())
}
```

`http.app()` indexes `@Controller` types already loaded and constructs them with `of` / `empty`. `.controller(instance)` remains for tests that mount one object. `@Controller("/users")` is the type prefix; `@Get("/:id")` is `GET /users/:id`. `@PathPrefix("/api")` on a loaded `pub` type prepends `/api` to `@Controller` files under `src/modules/`. `@Cors` on a loaded `pub` type reads associated `properties() -> CorsProperties` (`allowedOrigins` / `allowedOriginPatterns`). Localhost is always allowed. `OPTIONS` is `200` when allowed. `HttpCode` is the HTTP status catalog (`HttpCode.Ok.code()` is `200`). `http.response(code, text)` builds any status; named helpers wrap it (`ok`, `created`, `notFound`, …). `http.abort(code, text)` is that response for a failed request (return it — Zee has no `throw`). `http.fail(err)` maps `Error` to a `Response`. `@ErrorHandler` associated `handle(err, req)` is the app-wide mapper; missing handler keeps `HttpError` status and sends other errors as `500`. 100 Continue is `response(HttpCode.Continue, text)` (`continue` is a keyword). Unknown names (`@Trace`, `@Configuration`, `@Provider`) stay metadata.

| Attribute | Action |
|---|---|
| `@Param("id")` | one path key (`:id`) |
| `@Params` | path `Map<String, String>` |
| `@Query("q")` | one query key (`?q=`) |
| `@Query` | whole query `Map` |
| `@Body` | `json.decode` into the parameter type |
| `@Request` | the whole `Request` (`method` / `path` / `text` / `params` / `query` / `headers`) |
| `@Valid` | after bind, calls `classValidator.validate` on bound structs except `self`; every issue is `422` JSON `{"issues":[{field, rule, text}, …]}`. The app must depend on `classValidator`. |

Query string is parsed from `?k=v` (`+` and `%20`). Bind failures are `400`. `@Valid` failures are `422` JSON and skip `@ErrorHandler`. A parameter typed `Request` with no attribute is still the bag (compat).

`resource("/users", users)` maps `http.Resource` without attributes:

| Verb | Method | Path |
|---|---|---|
| GET | `index` | `/users` |
| GET | `create` | `/users/create` |
| POST | `store` | `/users` |
| GET | `show` | `/users/:id` |
| GET | `edit` | `/users/:id/edit` |
| PUT / PATCH | `update` | `/users/:id` |
| DELETE | `destroy` | `/users/:id` |

`apiResource("/users", users)` maps `http.ApiResource` (no `create` / `edit`). `GET /users/create` is `show` with id `create`; `GET /users/:id/edit` is 404.

Tests call `http.dispatch(router, req)` so they do not bind a port. `http.listen` is the host overlay.

Host overlay: `httpDispatch` / `httpListen` / `httpI32Param` / `httpRouterController` / `httpApp` / `httpFail` live in zee-lang.

Layout (one type per file, **same** module — nested `src/` folders would be other modules):

| File | Type |
|---|---|
| `src/lib.zee` | package docs |
| `src/code.zee` | `HttpCode` |
| `src/request.zee` | `Request` |
| `src/response.zee` | `Response` |
| `src/cors.properties.zee` | `CorsProperties` |
| `src/static.get.zee` | `StaticGet` |
| `src/mount.zee` | `Mount` |
| `src/api.mount.zee` | `ApiMount` |
| `src/router.zee` | `Router` |
| `src/resource.zee` | `Resource` |
| `src/api.resource.zee` | `ApiResource` |
| `src/http.error.zee` | `HttpError` / `abort` / `fail` |
