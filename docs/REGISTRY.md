# Zee registry contract (ZEE-5)

Zee is not JavaScript. The registry is **not npm**. A package is `zee.toml` + `src/`. The lockfile (`zee.lock`) remains the pin: the registry only answers “which versions exist” and hands back those files.

## SemVer

Constraint precision is Gradle-shaped, not npm caret:

| Constraint | Means |
|---|---|
| `1.2.3` | exactly `1.2.3` |
| `1.2` | latest `1.2.x` (`>=1.2.0 <1.3.0`) |
| `1` | latest `1.x.x` (`>=1.0.0 <2.0.0`) |

`zee get` writes the **resolved** version into `zee.lock` and **honors** that pin on later gets. `zee update` [name...] re-resolves within the current constraint (Gradle precision: `1.2` can move to a newer `1.2.x`, `1.2.3` stays exact) and rewrites the lock. Reproducing a build uses the lock, not a floating range. `zee update` does not edit `libs.toml`.

## Where the registry lives

Same protocol for public and private:

1. `ZEE_REGISTRY` (env) — file path, `file://…`, or `https://…`
2. `[registry] url` in the app `zee.toml`
3. otherwise `~/.zee/registry` (override home with `ZEE_HOME`)

`zee publish` needs `package.version`. It refuses to overwrite `name@version`. HTTP publish requires `ZEE_REGISTRY_TOKEN`.

Local HTTP host:

```
zee registry --root ~/.zee/registry --token "$ZEE_REGISTRY_TOKEN"
# prints: listening http://127.0.0.1:<port>
ZEE_REGISTRY=http://127.0.0.1:<port> ZEE_REGISTRY_TOKEN=… zee publish
```

GCP / GitHub Releases / a box is the same API on another origin — not a second format.

File layout (also the HTTP payload unpacked):

```
<registry>/packages/<name>/<version>/zee.toml
<registry>/packages/<name>/<version>/src/
```

## HTTP (same JSON for every host)

Base: `{origin}/api/v1`

| Method | Path | Auth | Meaning |
|---|---|---|---|
| `GET` | `/packages/{name}` | optional bearer | `{ "name", "versions": ["1.2.0", "1.2.1"] }` |
| `GET` | `/packages/{name}/{version}` | optional bearer | tarball or zip of `zee.toml` + `src/` (`Content-Type: application/zip`) |
| `PUT` | `/packages/{name}/{version}` | **required** `Authorization: Bearer <token>` | body = zip of `zee.toml` + `src/`; **409** if that version exists |

Errors: `{ "error": "already_published" \| "unknown_package" \| "unauthorized" }` plus HTTP 409 / 404 / 401.

Overwrite is never 200. Yank/advisory are out of scope.

Hosting (GCP, GitHub Releases, a box) is an implementation of this API, not a second format. `zee registry` is the file-backed implementation shipped with the CLI.
