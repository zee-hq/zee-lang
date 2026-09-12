# shop-api

HTTP via official lib [`http`](../../libs/http). `@Controller` in the package is enough. `http.app()` indexes them and builds via `of` / `empty`. No route list. No `@Inject`. No `src/` walk.

```
src/bootstrap/main.zee                 entry — listen(http.app())
src/shared/config/api.prefix.zee       @PathPrefix("/api") on src/modules/
src/shared/config/cors.zee             @Cors + CorsProperties
src/shared/errors/handler.zee          @ErrorHandler — abort / fail
src/modules/application/           health @Controller → /api/health
src/modules/users/                     import users
src/modules/users/controllers/         @Controller — mounted by http.app() → /api/users
test/bootstrap/                        tests for bootstrap (same module)
test/modules/users/                    tests for users (same module)
```

```zee
fn main() {
  http.listen("127.0.0.1:8080", http.app())
}
```

`@Body` is JSON into the parameter type. `@Param("id")` is the path key.

```bash
zee test          # dispatch, no listen
zee run           # listen 127.0.0.1:8080
```
