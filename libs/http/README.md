# http

Official Zee HTTP listen/dispatch. The language stores `@Name` as metadata. **This package** reads `@Get` / `@Post` / `@Put` / `@Patch` / `@Delete` / `@Controller` on types and methods, and `@Param` / `@Params` / `@Query` / `@Body` / `@Request` on parameters.

```zee
import http

fn main() {
  http.listen("127.0.0.1:8080", http.app())
}
```

`http.app()` indexes `@Controller` types already loaded (Quarkus/Jandex-shaped) and constructs them with `of` / `empty`. `.controller(instance)` remains for tests that mount one object. `@Controller("/users")` is the type prefix; `@Get("/:id")` is `GET /users/:id`. `@PathPrefix("/api")` on a loaded `pub` type prepends `/api` to `@Controller` files under `src/modules/` (Spring `addPathPrefix` for `RestController` in `….modules`). `@Cors` on a loaded `pub` type reads associated `properties() -> CorsProperties` (`allowedOrigins` / `allowedOriginPatterns`). Localhost is always allowed. `OPTIONS` is `200` when allowed. Unknown names (`@Trace`, `@Configuration`, `@Provider`) stay metadata.

| Attribute | Action |
|---|---|
| `@Param("id")` | one path key (`:id`) |
| `@Params` | path `Map<String, String>` |
| `@Query("q")` | one query key (`?q=`) |
| `@Query` | whole query `Map` |
| `@Body` | `json.decode` into the parameter type |
| `@Request` | the whole `Request` (`method` / `path` / `text` / `params` / `query` / `headers`) |

Query string is parsed from `?k=v` (`+` and `%20`). Bind failures are `400`. A parameter typed `Request` with no attribute is still the bag (compat).

`resource("/users", users)` still maps Laravel `--api` verbs on `http.Resource` without attributes:

| Verb | Method | Path |
|---|---|---|
| GET | `index` | `/users` |
| POST | `store` | `/users` |
| GET | `show` | `/users/:id` |
| PUT / PATCH | `update` | `/users/:id` |
| DELETE | `destroy` | `/users/:id` |

Tests call `http.dispatch(router, req)` so they do not bind a port. `http.listen` is the host overlay.

Host overlay: `httpDispatch` / `httpListen` / `httpI32Param` / `httpRouterController` / `httpApp` live in zee-lang.
