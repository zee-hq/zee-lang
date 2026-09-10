# Zee

**A strongly typed language.** Interpreter, REPL, CLI, and editor. The OS (`zee-os`) is out of scope for this drop.

[![test](https://github.com/zee-hq/zee-lang/actions/workflows/test.yml/badge.svg)](https://github.com/zee-hq/zee-lang/actions/workflows/test.yml)

Zee is a small systems language with **no implicit conversions**, **no null**, and a single syntax for every environment. v0 is a tree-walking interpreter on Node. Native backends come later — they do not start until this interpreter is boringly solid.

```zee
fn greet(name: String) -> String {
  "hello, " + name
}

fn main() {
  println(greet("zee"))
}
```

## Status

| Piece | v0.1 |
|---|---|
| Lexer / parser | done |
| Type checker (strong, local inference) | done |
| Interpreter + REPL + project CLI | done |
| Editor (VS Code / Cursor) | syntax + file icons + check on save + Run File |
| Bytecode / LLVM / native | later — not this drop |

The grammar will change. Syntax that is decided but **not** in v0 yet (`open`, `abstract`, bounds `T: Closeable`, `struct Box<T>`, concurrency) lives in [`docs/DIRECTION.md`](docs/DIRECTION.md). Constructors beyond `Name { fields }` and DI are **radar** there (§9) — not closed.

Jira (not a Z-Group product; same instance): project **ZEE**, board [quadro ZEE](https://rr-it-solutions.atlassian.net/jira/software/c/projects/ZEE/boards/244), epic [ZEE-1](https://rr-it-solutions.atlassian.net/browse/ZEE-1).

## Quick start

Requires **Node 22+**.

```bash
git clone git@github.com:zee-hq/zee-lang.git
cd zee-lang
npm install
npm test
npx tsx src/cli.ts run examples/hello.zee
npx tsx src/cli.ts            # REPL
```

Install the CLI on your `PATH`:

```bash
npm link
zee new hello
cd hello
zee run
```

`zee new` creates `zee.toml` + `src/main.zee`. Inside a project, `zee run` and `zee check` use the entry in the manifest (default `src/main.zee`). `zee init` scaffolds the current directory.

Dependencies are Gradle-style aliases from a workspace `libs.toml` (walks up, like `libs.versions.toml`). `zee get json` adds the alias to `[deps]` and copies the package into `.zee/`. `zee get` with no args fetches what is already listed and **honors `zee.lock`**. `zee update` (or `zee update env`) re-resolves within the current constraint and rewrites the lock — `1.2` can pick a newer `1.2.x`, `1.2.3` stays exact. It does not edit `libs.toml`. `zee.lock` is the pin (commit it). `.zee/` is generated (gitignored). Inline `{ path }` / `{ git, tag }` still work. `json = "1.2"` is SemVer precision (`1.2` → latest `1.2.x`). Registry order: `ZEE_REGISTRY`, `[registry] url`, then `~/.zee/registry`. `zee publish` refuses overwrite. Contract: [`docs/REGISTRY.md`](docs/REGISTRY.md).

```toml
# libs.toml (workspace root)
[versions]
http = "1.0.0"

[libraries]
json = { path = "json" }
http = { git = "https://github.com/zee-hq/http", version.ref = "http" }
```

```toml
# app/zee.toml — after `zee get json`
[deps]
json = { lib = "json" }
```

```bash
zee get json
zee run
```

`import json.ping` is the same spelling as a local module. There is no `package.json` as Zee config.

First official library: [`zee-hq/env`](https://github.com/zee-hq/env) (fixture copy in [`libs/env`](libs/env) for language tests). Releases are Git tags matching `zee.toml` version (`0.1.0`, not `v0.1.0`). `import env` then `env.get` / `env.require` / `env.getOr` / `env.profile`. App identity is `[package]` in the running app's `zee.toml`: `env.appName()`, `env.appVersion()`, plus `env.appDescription()` / `appAuthor` / `appCompany` / `appContact` / `appLicense` / `appHomepage` / `appRepository` (all `Option<String>`), or `env.app("author")` for any quoted key. It also reads process env, then `.env`, `.env.local`, `.env.{profile}`, `.env.{profile}.local` next to `zee.toml`. Profile is `ZEE_PROFILE`, else `ZEE_ENV`, else a `ZEE_PROFILE` in `.env`, else `dev`. Process env always wins. Missing keys are `None`.

```toml
# libs.toml
[versions]
env = "0.1"

[libraries]
env = { git = "https://github.com/zee-hq/env.git", version.ref = "env" }
```

```toml
# app/zee.toml
[package]
name = "hello"
version = "0.1.0"
description = "demo"
author = "Ada"
company = "Zee HQ"
contact = "ada@zee.dev"
license = "MIT"
homepage = "https://zee.dev"
repository = "https://github.com/zee-hq/hello"
```

```bash
zee get env
zee update env
```

```zee
import env

fn main() {
  println(env.profile())
  println(env.appName())
  println(env.appVersion())
  println(env.appAuthor() ?: "")
  println(env.require("APP_NAME"))
}
```

Generators follow the HTTP slice. `zee generate resource` is the Laravel-style mapper; `zee generate feature` writes the whole stack:

```bash
zee generate feature user --api
zee generate controller user --api    # or -i
zee generate resource user
```

`user` becomes `src/users/users.controller.zee`, `users.action.zee`, `users.service.zee`, `users.resource.zee`, `users.repository.zee`, `users.model.zee`, `users.api.zee`, `users.module.zee`. Tests are `*.test.zee` only.

```bash
zee run examples/factorial.zee
zee check examples/greet.zee
```

```
zee> const x = 40
zee> fn add(a: i32, b: i32) -> i32 { a + b }
zee> add(x, 2)
42
```

## Language (v0)

**Types:** `i8`…`i64`, `u8`…`u64`, `isize`/`usize` (hosted = 64-bit), `bool`, `String`, `Unit`, `Never`, `Error`, `Option<T>`, `List<T>`, `Map<K, V>`, `(T, U)`, `(A, B) -> R`, `T[]`, user `struct` / `class`, `enum`, `sealed struct` / `sealed class`, `type` alias, `newtype`, `interface` / `sealed interface`.

**Bindings:** `const` is immutable, `var` is mutable. Both require an initializer. The type may be written or inferred from the initializer — never from “whatever would make this compile”. Tuple bindings: `const (q, r) = divmod(10, 3)` — arity must match; `_` discards a slot. `redim x: i32` widens a `var` on the same signedness ladder. `redim xs, n` / `redim preserve xs, n` change array length (`n: usize`).

**Functions:** parameters are always annotated. The return type defaults to `Unit`. A trailing expression is the return value (Rust-style). Multiple returns are tuples; errors use `(T, Option<Error>)` and `err != None`. First parameter `self: T` on a named type registers an instance method (`p.mag()` ≡ UFCS). `self` is read-only; `var self` is a mutating receiver, callable only on a `var` binding. Instance methods may live inside the type body or as UFCS outside it. An `fn` in the type body with **no** `self` is associated: `Point.origin()`.

**Generics:** `fn identity<T>(x: T) -> T`. Infer `T` from arguments (`identity(3)` is `i32`) or write `identity<String>("a")`. Several parameters: `fn pair<T, U>(…)`. Invariant. No wildcards, no raw types, no erasure. Bounds `T: Closeable` / `T: Eq` and user `struct Box<T>` wait.

**Lambdas:** `{ a, b -> a + b }`, `{ it * 2 }`, `{ 0 }` (unused param). Parameter types come from the expected function type. Trailing form: `apply(3) { x -> x + 1 }` and `xs.map { it * 2 }`. Closures capture `const`, not `var`. Named `fn` stays for declarations.

**Control flow:** `if` is an expression. Using it as a value requires `else` and matching branch types. `x is Type` is a `bool` test; in `if x is File { … }` the then-branch narrows `x`. `match` is an expression: arms use `=>`, `|` combines patterns, `_` is the default. All arms have the same type (`Never` unifies with any arm). Integers / `String` need `_`; `bool` is exhaustive with `true` and `false`; `enum`, `sealed`, and `sealed interface` are exhaustive when every variant / implementor is covered (or `_`). Patterns include values, `Type.Variant`, `Type.Variant { fields }`, and `Type { fields }` on a sealed interface. Comparison is `==` (no truthiness). Loops are statements: `while` / `until`, `do { } while` / `do { } until`, three-clause `for (var i = 0; i < n; i += 1)`, infinite `for { }`, `for i in 0..n` (exclusive end), `for x in xs` over `T[]` or `List<T>`, `for (i, x) in xs` with `i: usize`, and `for (k, v) in ages` on `Map` (plain `for x in ages` is an error). Loop bindings are `const`. `cond` is `bool`. `break` / `continue` apply to the innermost loop and do not cross a lambda. `defer expr` / `defer { … }` registers work for function exit, LIFO (Go). `panic("…")` aborts with `Never` after running that function’s defers. No `try` / `catch` / `recover`.

**Arrays:** `var xs: i32[] = [1, 2, 3]`. Index `xs[i]` needs `i: usize` (unsuffixed literals in index context become usize). `xs.len` is `usize`. Out of bounds panics. Empty `[]` needs a type. Unannotated `var xs = [1, 2, 3]` infers `i32[]`. Unannotated `const xs = [1, 2, 3]` infers `List<i32>`. Annotated `T[]` stays an array. Arrays share the buffer; `const` forbids slot writes and `redim`. `buf.toList()` copies into `List<T>`. `String` `.len` is usize and `s[i]` is `u8`.

**List:** immutable `List<T>` over a copied buffer. No slot write, no `redim`. `xs[i]` reads (`i: usize`); OOB panics. `xs.len` is `usize`. `map` / `filter` / `forEach` take a trailing lambda (`it`). `xs.toArray()` copies to `T[]`. `==` if `T` is `Eq`.

**Map:** `var ages: Map<String, i32> = { "ana": 30 }`. Lookup `ages[k]` is `Option<V>`. Assign `ages[k] = v` on a `var` Map inserts/updates `V` (grows; no `redim`). `const` Map forbids assign. Keys need `Eq + Hash` (integers, `bool`, `String`, `enum` — not `T[]`, not float, not plain struct). `.len` is `usize`. Empty `{}` needs a `Map<K, V>` type. Quoted string keys disambiguate the literal from lambdas and `Name { field: … }` struct construction.

**Structs and classes:** both are objects, construction `Name { fields }`, no `new`. Field write needs a `var` binding and a `var` field. `readonly` forbids field writes even on `var`. `data` enables `==` by value. **`struct`** copies on assign. **`class`** shares identity (`var b = a` is the same object). `===` / `!==` compare class identity only. Plain `class` is not `Eq` (`==` is a type error). `data class` is both: `==` by fields, `===` by instance. `p.copy(x: 0)` on a `data` type returns a new value/object with listed fields replaced. Modifiers: `readonly data struct Point { … }`, `data class Point { … }`. `pub struct` / `pub class` do not export fields; mark a field `pub const` / `pub var`. A `const` / `var` **with an initializer in the type body** is associated (`User.ROLE_ADMIN`); without initializer it is a constructor field. Nested `struct` / `class` / `enum` / `interface` / `newtype` / `type` use path `Outer.Inner`. Nested types do not capture the outer instance (no Java `Outer.this`). Associated names are not constructor fields.

**Enums and sealed:** `enum Status { Ready Failed }` is a sealed set of payload-less variants. Construct with `Status.Ready`. `==` is by variant. `<` / `<===>` follow declaration order. `sealed struct Shape { data struct Circle { const r: i32 } … }` is a value sum type; `sealed class Shape { data class Circle { const r: i32 } … }` is an identity sum type. Construct `Shape.Circle { r: 3 }` and match `Shape.Circle { r } => …`. Nested variants are not Java inner classes. `match` is exhaustive on the variant set. Nested variants of a `pub` sealed type are pub unless marked otherwise. `open` / `abstract` wait.

**Type aliases and newtypes:** `type Handler = (i32) -> i32` is an interchangeable name for `T` (including generic `type Table<K, V> = Map<K, List<V>>`). `newtype UserId = i32` is a distinct wrapper. Wrap with `UserId(n)`, unwrap with `i32(id)` (same conversion syntax as integer widen). No arithmetic, concat, or index on the wrapper. `Eq` / `Hash` / `Ord` follow the inner type (`UserId == UserId(40)` is ok; `id == 40` is not).

**Interfaces:** nominative `implements`. Methods only — no fields, no default bodies. A coincidental method is not enough. Methods that satisfy the interface live on the type or as UFCS `fn name(self: Type)` in the same module. `fn f(x: Closeable)` is an existential; call `x.close()`. `sealed interface` can be implemented in this module only; `match` is exhaustive on that set. `if x is File` narrows in the then-branch (not `as`). `open` / `abstract` / bounds `T: Closeable` wait. Unconstrained `fn f<T>` is in.

**Modules:** a package is `zee.toml`. A module is a directory under `src/` (`src/` is the root module; `src/http/` is `http`). Unmarked names are file-private. `internal` is visible in the same folder without `import`. `pub` is importable from another module or package. Imports are Kotlin-shaped: `import http`, `import http.Client`, `import http.{A, B as C}`. A `[deps]` name is the same: `import json.Value`. No glob, no `public`/`protected`. Cycles and file-vs-folder clashes are compile errors.

**Operators:** `?:` unwraps `Option<T>` (not PHP falsy; not `??`). `??=` / `!!=` fill a `var Option<T>` when `None` / `Some`. `&&=` / `||=` are short-circuit assigns on `var bool`. `+=` `-=` `*=` `/=` `%=` are compound assigns on `var` (lhs evaluated once); integers take all five, `String` only `+=`. No `++` / `--`. `<===>` is three-way compare on integers, `String`, and `enum` and yields `i32` (`-1` / `0` / `1`). Strings are also ordered with `<` `<=` `>` `>=`. `===` / `!==` are identity on `class` only, not three-way compare.

**Integers:** unsuffixed literals take the expected width or default to `i32`. Suffixes `40u8`, hex `0xFF`, binary `0b1010`, separators `1_000`. No mixed arithmetic. Widen with `i64(n)`; narrow with `narrow<i8>(n) -> Option<i8>`. `+ - *` panic on overflow.

**Builtins:** `print`, `println` (integers | `bool` | `String`), `str` (integer | `bool`) -> `String`, `error(String) -> Error` (constructs `Fail`, which implements `Error`; call `e.message()`), `panic(String) -> Never`, `Some(x)`, `None` (needs a type context).

What the checker **refuses**:

```zee
1 + "zee"           // error: `+` is not defined for i32 and String
if true { 1 }       // error: if expression is missing `else`
const n: i32 = "1"    // error: cannot assign String to n: i32
```

`+` on two strings is concatenation, not coercion. `+` on two `i32`s is addition. Mixing them is a type error.

### Grammar (subset)

```
program     = (import | visDecl | statement)*
import      = "import" ident ("." ident)* ("." "{" importName ("," importName)* "}")? ("as" ident)?
importName  = ident ("as" ident)?
visDecl     = ("pub" | "internal") (fn | structDecl | enumDecl | typeAlias | newtypeDecl | interfaceDecl | const | var)
statement   = fn | structDecl | enumDecl | typeAlias | newtypeDecl | interfaceDecl | const | var | redim | assign | return | defer | loop | for | break | continue | expression
loop        = "while" expression block
            | "until" expression block
            | "do" block ("while" | "until") expression
for         = "for" "(" forInit? ";" expression? ";" forStep? ")" block
            | "for" block
            | "for" ident "in" expression ".." expression block
            | "for" ident "in" expression block
            | "for" "(" ident "," ident ")" "in" expression block
fn          = "fn" ident ("<" ident ("," ident)* ">")? "(" params? ")" ("->" type)? block
params      = param ("," ident ":" type)*
param       = "var"? ident ":" type
type        = typeHead "[]"*
typeHead    = named | "()" | "(" type ("," type)+ ")" | genericType
            | "(" type ("," type)* ")" "->" type
            | "()" "->" type
genericType = ("Option" | "List" | ident) "<" type ">" | "Map" "<" type "," type ">"
named       = intWidth | "bool" | "String" | "Unit" | "Never" | "Error" | ident
structDecl  = ("readonly" | "data" | "sealed")* ("struct" | "class") ident implements? "{" typeMember* "}" implements? ("{" fn* "}")?
implements  = "implements" ident ("," ident)*
typeMember  = structField | associatedConst | nestedType | fn | structVariant
structField = ("pub" | "internal")? ("const" | "var") ident ":" type
associatedConst = ("pub" | "internal")? ("const" | "var") ident (":" type)? "=" expression
nestedType  = ("pub" | "internal")? (structDecl | enumDecl | typeAlias | newtypeDecl | interfaceDecl)
structVariant = ("pub" | "internal")? ("readonly" | "data")* ("struct" | "class") ident "{" structField* "}"
enumDecl    = "enum" ident "{" ident* "}"
typeAlias   = "type" ident ("<" ident ("," ident)* ">")? "=" type
newtypeDecl = "newtype" ident "=" type
interfaceDecl = "sealed"? "interface" ident "{" ifaceMethod* "}"
ifaceMethod = "fn" ident "(" "var"? "self" ("," ident ":" type)* ")" ("->" type)?
const       = "const" ident (":" type)? "=" expression
            | "const" tupleBind "=" expression
var         = "var" ident (":" type)? "=" expression
            | "var" tupleBind "=" expression
defer       = "defer" expression
redim       = "redim" ident ":" type
            | "redim" "preserve"? ident "," expression
tupleBind   = "(" ident ("," ident)+ ")"
if          = "if" expression block ("else" (if | block))?
match       = "match" expression "{" matchArm+ "}"
matchArm    = pattern ("|" pattern)* "=>" expression
pattern     = "_" | variantPattern | expression
variantPattern = ident ("." ident)* ("{" ident ("," ident)* "}")?
lambda      = "{" (ident ("," ident)* "->")? statements "}"
intWidth    = "i8" | "i16" | "i32" | "i64" | "u8" | "u16" | "u32" | "u64" | "isize" | "usize"
```

See `examples/` for programs that actually run (`hello.zee`, `greet.zee`, `factorial.zee`) plus one file of each role so the explorer icons show up.

## Editor

The VS Code / Cursor extension is in [`editor/vscode`](editor/vscode). It highlights `.zee` files, shows the Zee file icon, type-checks on save, and adds **Zee: Run File**.

```bash
npm run editor:link
```

Reload the window, open `examples/hello.zee`. To see the teal Z in the explorer, pick **File Icon Theme → Zee**.

## Design constraints

These exist because Zee is meant to grow into a language that can host its own OS:

1. **One language, several environments** — not dialects. Missing capabilities fail at type-check time, not in production.
2. **Strong and static.** No `null`. No implicit casts. Local inference only.
3. **The interpreter is a bootstrap.** It is written in TypeScript so we can move fast on syntax and types. A self-hosted / native compiler is a later milestone, not a v0 goal.
4. **Kernel profile comes after.** Freestanding Zee (`zee:kernel`: no hidden alloc, `repr(C)`, `asm`) belongs with [`zee-os`](https://github.com/RR-IT-Solutions/zee-os). This repo stays hosted: editor + interpreter.

## Layout

```
src/            lexer, parser, checker, interpreter, CLI
test/           vitest — language behavior, not snapshots of implementation
examples/       programs the interpreter must keep running
editor/vscode   TextMate grammar + Run/Check commands
```

## Commands

| Command | Meaning |
|---|---|
| `npm test` | run the language tests |
| `npm run typecheck` | TypeScript strict check |
| `zee new <name>` | create a new project |
| `zee init [name]` | scaffold the current directory |
| `zee generate feature <name> [--api\|-i]` | HTTP slice (`user` → `src/users/users.*.zee`) |
| `zee generate controller <name> [--api\|-i]` | HTTP in; Laravel `--api` or invokable `-i` |
| `zee generate resource <name>` | HTTP mapper (`users.resource.zee`) |
| `zee generate action\|service\|repository\|model\|api\|module <name>` | one layer file |
| `zee get [alias...]` | fetch `[deps]` into `.zee/` (catalog aliases optional; honors lock) |
| `zee update [name...]` | re-resolve deps within current constraints and rewrite `zee.lock` |
| `zee publish` | publish this package to `ZEE_REGISTRY` / `[registry] url` |
| `zee registry` | serve the HTTP registry from a file root (`--root`, `--token`, `--port`) |
| `zee run [file]` | interpret a program (or the project entry) |
| `zee check [file]` | type-check only |
| `zee` | REPL |

## License

MIT. See [LICENSE](LICENSE).

---

### Português

Zee é uma linguagem **fortemente tipada**. Este repositório tem o **interpretador**, o **REPL**, o **editor** e o **CLI** (`zee new` / `zee run`). O sistema operacional fica em [zee-os](https://github.com/RR-IT-Solutions/zee-os) e ainda não é o foco.

```bash
npm install && npm test
npm link
zee new hello && cd hello && zee run
```
