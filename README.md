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
| Editor (VS Code / Cursor / JetBrains) | `zee lsp` + `zee fmt` + rename + interpreter debugger |
| Bytecode / LLVM / native | later — not this drop |

The grammar will change. Syntax that is decided but **not** in v0 yet (`open`, `abstract`, bounds `T: Closeable`, `struct Box<T>`, concurrency) lives in [`docs/DIRECTION.md`](docs/DIRECTION.md). Construction is `Name { fields }` + associated factories; `main` wires dependencies — radar §9 is **closed**.

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

`zee new hello` creates `zee.toml` + `src/main.zee` (`--kind bin`). `zee new shop --kind api` uses `src/bootstrap/main.zee` plus the HTTP slice (`src/modules/users/`); `--kind web` adds `src/ui/` (UI runtime is a gap); `--kind monolith` is both in **one** package; `--kind service` is an API slice labeled as a process. Inside a project, `zee run` and `zee check` use the entry in the manifest (default `src/main.zee`). `zee test` injects the official [`ZeeTest`](https://github.com/zee-hq/ZeeTest) package and calls `ZeeTest.run()` — `fn test*` in `*.test.zee` under `src/` or `test/` (`test/` mirrors `src/`; `users.service.test.zee`, not `foo_test.zee` or `.spec.zee`), including library packages with `src/lib.zee`. Group with `describe("title") { const row = …; fn testFoo() { } }` — the block is a closure; inner `fn` get that env. Lifecycle hooks are `fn beforeAll()` / `fn beforeEach()` / `fn afterEach()` / `fn afterAll()`. You can also `import ZeeTest` yourself. Assertions are `expect(x).toBe(y)` / `toEqual` / `.not` (panic on mismatch). `it()` is not a test helper — Zee `it` is the lambda parameter. Failure is also `panic` or a visible `err`. `zee init` scaffolds the current directory.

Dependencies are Gradle-style aliases. `zee get ZeeTest` looks up the name in a workspace `libs.toml` if you have one, otherwise in the official [`catalog.json`](catalog.json) (Maven-style index: where the package lives). You can point `ZEE_CATALOG` at a JSON URL or file — later that URL will be the landing-page central. `zee get` adds the alias to `[deps]` and copies the package into `.zee/`. `zee get` with no args fetches what is already listed and **honors `zee.lock`**. `zee update` (or `zee update env`) re-resolves within the current constraint and rewrites the lock — `1.2` can pick a newer `1.2.x`, `1.2.3` stays exact. It does not edit `libs.toml`. `zee.lock` is the pin (commit it). `.zee/` is generated (gitignored). Inline `{ path }` / `{ git, tag }` still work. `json = "1.2"` is SemVer precision (`1.2` → latest `1.2.x`). Registry order: `ZEE_REGISTRY`, `[registry] url`, then `~/.zee/registry`. `zee publish` refuses overwrite. Contract: [`docs/REGISTRY.md`](docs/REGISTRY.md).

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

Second: [`zee-hq/ZeeTest`](https://github.com/zee-hq/ZeeTest) (fixture copy in [`libs/ZeeTest`](libs/ZeeTest) for language tests). `zee test` injects it and calls `ZeeTest.run()`. Group with `describe("title") { fn testFoo() { } }`. Hooks: `fn beforeEach()`. Assertions: `expect(x).toBe(1)`. You can also `import ZeeTest`.

Third: [`zee-hq/json`](https://github.com/zee-hq/json) (fixture copy in [`libs/json`](libs/json)). `import json` then `json.encode(value)` and `json.decode<T>(text)` — JSON `null` is `None`, never a Zee `null`. Invalid JSON and missing fields are `err` (dummy `T`), not panic. Host overlay: `jsonEncode` / `jsonDecode`.

Fourth: **http** (in-tree fixture [`libs/http`](libs/http); GitHub `zee-hq/http` comes when the package is published). `import http` then `http.listen(addr, http.app())`. `http.app()` indexes `@Controller` in the loaded package and builds via `of` / `empty`. The compiler does not know Get/Post; the package reads `@Get` / `@Param` / `@Query` / `@Body` / `@Request` from metadata. Tests call `http.dispatch` so they do not bind a port. Host overlay: `httpDispatch` / `httpListen` / `httpI32Param` / `httpRouterController` / `httpApp`. Example: [`examples/shop-api`](examples/shop-api).

```toml
# libs.toml
[versions]
env = "0.1"
ZeeTest = "0.1"
json = "0.1"

[libraries]
env = { git = "https://github.com/zee-hq/env.git", version.ref = "env" }
ZeeTest = { git = "https://github.com/zee-hq/ZeeTest.git", version.ref = "ZeeTest" }
json = { git = "https://github.com/zee-hq/json.git", version.ref = "json" }
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

Generators follow the HTTP slice. `zee generate resource` writes the HTTP mapper; `zee generate feature` writes the whole stack:

```bash
zee generate feature user --api
zee generate controller user --api    # or -i
zee generate resource user
```

`user` becomes `src/modules/users/users.controller.zee`, `users.action.zee`, `users.service.zee`, `users.resource.zee`, `users.repository.zee`, `users.model.zee`, `users.api.zee`, `users.module.zee`. Tests are `*.test.zee` only.

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

**Types:** `i8`…`i64`, `u8`…`u64`, `isize`/`usize` (hosted = 64-bit), `f32`/`f64`, `bool`, `String`, `Char`, `Unit`, `Never`, `Error`, `Option<T>`, `List<T>`, `Map<K, V>`, `(T, U)`, `(A, B) -> R`, `T[]`, user `struct` / `class`, `enum`, `sealed struct` / `sealed class`, `type` alias, `newtype`, `interface` / `sealed interface`.

**Bindings:** `const` is immutable, `var` is mutable. Both require an initializer. The type may be written or inferred from the initializer — never from “whatever would make this compile”. Tuple bindings: `const (q, r) = divmod(10, 3)` — arity must match; `_` discards a slot. `redim x: i32` widens a `var` on the same signedness ladder. `redim xs, n` / `redim preserve xs, n` change array length (`n: usize`).

**Functions:** parameters are always annotated. The return type defaults to `Unit`. A trailing expression is the return value (Rust-style). Multiple returns are tuples; errors use `(T, Option<Error>)` and `err != None`. First parameter `self: T` on a named type registers an instance method (`p.mag()` ≡ UFCS). `self` is read-only; `var self` is a mutating receiver, callable only on a `var` binding. Instance methods may live inside the type body or as UFCS outside it. An `fn` in the type body with **no** `self` is associated: `Point.origin()`. Inside a type body, `self` in type or constructor position is the enclosing name (`fn empty() -> self { self { … } }` ≡ `-> Point { Point { … } }`).

**Generics:** `fn identity<T>(x: T) -> T`. Infer `T` from arguments (`identity(3)` is `i32`) or write `identity<String>("a")`. Several parameters: `fn pair<T, U>(…)`. Invariant. No wildcards, no raw types, no erasure. Bounds `T: Closeable` / `T: Eq` and user `struct Box<T>` wait.

**Lambdas:** `{ a, b -> a + b }`, `{ it * 2 }`, `{ 0 }` (unused param). Parameter types come from the expected function type. Trailing form: `apply(3) { x -> x + 1 }` and `xs.map { it * 2 }`. Closures capture `const`, not `var`. Named `fn` stays for declarations.

**Control flow:** `if` is an expression. Using it as a value requires `else` and matching branch types. `x is Type` is a `bool` test; in `if x is File { … }` the then-branch narrows `x`. `match` is an expression: arms use `=>`, `|` combines patterns, `_` is the default. All arms have the same type (`Never` unifies with any arm). Integers / `String` need `_`; `bool` is exhaustive with `true` and `false`; `enum`, `sealed`, and `sealed interface` are exhaustive when every variant / implementor is covered (or `_`). Patterns include values, `Type.Variant`, `Type.Variant { fields }`, and `Type { fields }` on a sealed interface. Comparison is `==` (no truthiness). Loops are statements: `while` / `until`, `do { } while` / `do { } until`, three-clause `for (var i = 0; i < n; i += 1)`, infinite `for { }`, `for i in 0..n` (exclusive end), `for x in xs` over `T[]` or `List<T>`, `for c in s` over `String` (`c: Char`), `for (i, x) in xs` with `i: usize`, and `for (k, v) in ages` on `Map` (plain `for x in ages` is an error). Loop bindings are `const`. `cond` is `bool`. `break` / `continue` apply to the innermost loop and do not cross a lambda. `defer expr` / `defer { … }` registers work for function exit, LIFO (Go). `panic("…")` / `panic(\`…{x}…\`)` abort with `Never` after running that function’s defers. No `try` / `catch` / `recover`.

**Arrays:** `var xs: i32[] = [1, 2, 3]`. Index `xs[i]` needs `i: usize` (unsuffixed literals in index context become usize). `xs.len` is `usize`. Out of bounds panics. Empty `[]` needs a type. Unannotated `var xs = [1, 2, 3]` infers `i32[]`. Unannotated `const xs = [1, 2, 3]` infers `List<i32>`. Annotated `T[]` stays an array. Arrays share the buffer; `const` forbids slot writes, `redim`, `push` / `pop` / `fill` / `sort`. `map` / `filter` / `forEach` return a new array or `Unit` (they do not mutate). `first` / `last` are `Option<T>`. `reverse` / `unique` (`T: Eq`, first-seen) return a new array. `flat()` is one level (`T[][]` → `T[]`). `flatMap { }` one level (`(T) -> U[]`). `fold(init) { acc, x -> }`, `count { }`, `zip(ys)` (shorter wins), `groupBy { }` → `Map<K, T[]>`, `min` / `max` (`T: Ord` → `Option<T>`). `join(sep)` is `String[]`. `push` grows at the end; `pop()` is `Option<T>`; `fill(x)` writes every slot; `sort` / `sort { a, b -> }` are in-place on `var` (`T: Ord` or `(T, T) -> i32`). `buf.toList()` copies into `List<T>`. `String` is UTF-8: `.len` / `s[i]` are bytes (`usize` / `u8`); `isEmpty` is byte-empty; `isBlank` / `isNotBlank` are Unicode `Char` whitespace (Kotlin, not ASCII-only); `for c in s` yields `Char`; `"…"` does not interpolate; `` `hello, {name}` `` interpolates `String` / `Char` / `bool` / integers; `` ```block``` `` is a raw multiline. `String.fromBytes(buf: u8[])` is `(String, Option<Error>)`. `'a'` is `Char`.

**List:** immutable `List<T>` over a copied buffer. No slot write, no `redim`. `xs[i]` reads (`i: usize`); OOB panics. `xs.len` is `usize`. `map` / `filter` / `forEach` / `find` / `any` / `all` take a trailing lambda (`it`). `contains`, `sort` (new list, `T: Ord`) or `sort { a, b -> a.age <===> b.age }` (`(T, T) -> i32`; `T` need not be `Ord`), `sortBy { it.age }` (`(T) -> K` with `K: Ord`), `sortByDescending { it.age }` (same key, reverse), `first` / `last` (`Option<T>`), `reverse`, `unique` (`T: Eq`, first-seen), `flat()` one level (`List<List<T>>` → `List<T>`), `flatMap { }` one level (`(T) -> List<U>`), `fold(init) { acc, x -> }`, `count { }` (`usize`), `zip(ys)` (shorter wins), `groupBy { }` → `Map<K, List<T>>` (`K: Eq + Hash`), `min` / `max` (`T: Ord` → `Option<T>`), `join(sep)` on `List<String>`, `toString` (debug dump), `slice(start, end)`, `isEmpty`. `+` concatenates. `xs.toArray()` copies to `T[]`. `==` if `T` is `Eq`.

**Map:** `var ages: Map<String, i32> = { "ana": 30 }`. Lookup `ages[k]` is `Option<V>`. Assign `ages[k] = v` on a `var` Map inserts/updates `V` (grows; no `redim`). `const` Map forbids assign. Keys need `Eq + Hash` (integers, `bool`, `String`, `Char`, `enum` — not `T[]`, not float, not plain struct). `.len` is `usize`. Empty `{}` needs a `Map<K, V>` type. Quoted string keys disambiguate the literal from lambdas and `Name { field: … }` struct construction. `keys()` / `values()` are `List` in insertion order. `sortByKey()` / `sortByValue()` return a new Map (`K` / `V` need `Ord`); `for (k, v)` follows that order. Not PHP `ksort` / `asort`. `values.sort()` drops keys. `mapValues { it * 2 }` is `{ V -> U }` → `Map<K, U>`. `filter` / `find` / `any` / `all` / `forEach` take `{ k, v -> … }`. `find` is `Option<(K, V)>`. `containsKey(k)` is key lookup, not value `contains`. `merge(other)` returns a new Map; right wins. `map` on Map is an error.

**Structs and classes:** both are objects, construction `Name { fields }`, no `new`. Field write needs a `var` binding and a `var` field. `readonly` forbids field writes even on `var`. `data` enables `==` by value. **`struct`** copies on assign. **`class`** shares identity (`var b = a` is the same object). `===` / `!==` compare class identity only. Plain `class` is not `Eq` (`==` is a type error). `data class` is both: `==` by fields, `===` by instance. `p.copy(x: 0)` on a `data` type returns a new value/object with listed fields replaced. Modifiers: `readonly data struct Point { … }`, `data class Point { … }`. `pub struct` / `pub class` do not export fields; mark a field `pub const` / `pub var`. A `const` / `var` **with an initializer in the type body** is associated (`User.ROLE_ADMIN`); without initializer it is a constructor field. Nested `struct` / `class` / `enum` / `interface` / `newtype` / `type` use path `Outer.Inner`. Nested types do not capture the outer instance (no Java `Outer.this`). Associated names are not constructor fields.

**Enums and sealed:** `enum Status { Ready Failed }` is a sealed set of payload-less variants. Construct with `Status.Ready`. `==` is by variant. `<` / `<===>` follow declaration order. `sealed struct Shape { data struct Circle { const r: i32 } … }` is a value sum type; `sealed class Shape { data class Circle { const r: i32 } … }` is an identity sum type. Construct `Shape.Circle { r: 3 }` and match `Shape.Circle { r } => …`. Nested variants are not Java inner classes. `match` is exhaustive on the variant set. Nested variants of a `pub` sealed type are pub unless marked otherwise. `open` / `abstract` wait.

**Type aliases and newtypes:** `type Handler = (i32) -> i32` is an interchangeable name for `T` (including generic `type Table<K, V> = Map<K, List<V>>`). `newtype UserId = i32` is a distinct wrapper. Wrap with `UserId(n)`, unwrap with `i32(id)` (same conversion syntax as integer widen). No arithmetic, concat, or index on the wrapper. `Eq` / `Hash` / `Ord` follow the inner type (`UserId == UserId(40)` is ok; `id == 40` is not).

**Interfaces:** nominative `implements`. Methods only — no fields, no default bodies. A coincidental method is not enough. Methods that satisfy the interface live on the type or as UFCS `fn name(self: Type)` in the same module. `fn f(x: Closeable)` is an existential; call `x.close()`. `sealed interface` can be implemented in this module only; `match` is exhaustive on that set. `if x is File` narrows in the then-branch (not `as`). `open` / `abstract` / bounds `T: Closeable` wait. Unconstrained `fn f<T>` is in.

**Modules:** a package is `zee.toml`. A module is a directory under `src/` (`src/` is the root module; `src/http/` is `http`). Unmarked names are file-private. `internal` is visible in the same folder without `import`. `pub` is importable from another module or package. Imports: `import http`, `import http.Client`, `import http.{A, B as C}`. A `[deps]` name is the same: `import json.Value`. No glob, no `public`/`protected`. Cycles and file-vs-folder clashes are compile errors.

**Docs:** `///` is a Markdown doc on the next declaration (`fn`, type, field, method); consecutive lines merge. `//!` is inner docs for the file (top of the file). `{` in docs is not interpolation. `//` and `/* */` are not docs. A `///` with no following declaration is an error.

**Operators:** `?:` unwraps `Option<T>` (not PHP falsy; not `??`). `isNone` / `isSome` are sugar for `== None` / `!= None`. `isNoneOrEmpty` is `None` or empty inner on `Option<String>` / `Option<List<T>>` / `Option<T[]>` / `Option<Map<K, V>>` only (`Some("  ")` is not empty). `isNoneOrBlank` is `None` or blank on `Option<String>` only. `??=` / `!!=` fill a `var Option<T>` when `None` / `Some`. `&&=` / `||=` are short-circuit assigns on `var bool`. `+=` `-=` `*=` `/=` `%=` are compound assigns on `var` (lhs evaluated once); integers and floats take all five, `String` only `+=`. `& | ^ ~ << >>` and `&= |= ^= <<= >>=` are integers only; `>>` is arithmetic on signed and logical on unsigned; no `>>>`. No `++` / `--`. `<===>` is three-way compare on integers, `String`, `Char`, and `enum` and yields `i32` (`-1` / `0` / `1`). Strings and chars are also ordered with `<` `<=` `>` `>=`. Float is not `Ord` and not a `Map` key. `===` / `!==` are identity on `class` only, not three-way compare.

**Integers:** unsuffixed literals take the expected width or default to `i32`. Suffixes `40u8`, hex `0xFF`, binary `0b1010`, separators `1_000`. No mixed arithmetic. Widen with `i64(n)`; narrow with `narrow<i8>(n) -> Option<i8>`. `+ - *` panic on overflow. Wrap is `wrap.add` / `wrap.sub` / `wrap.mul` / `wrap.shl` (same integer type both sides).

**Floats:** unsuffixed `1.0` is `f64` (or the expected `f32`/`f64`). Suffixes `1.0f32` / `1.0f64`. IEEE: `NaN == NaN` is false; `/ 0.0` is `Infinity`. Convert int→float with `f64(n)` / `f32(n)`; float→int with `narrow<i32>(x)` (`None` on NaN / out of range). No mixed `i32 + f64`.

**Builtins:** `print`, `println` (integers | floats | `bool` | `String`), `printf` / `sprintf` (`%s` `%d` `%f` `%b` `%%`; no width/precision; `printf` does not add a newline), `str` (integer | float | `bool`) -> `String`, `error(String) -> Error` (constructs `Fail`, which implements `Error`; call `e.message()`), `panic(String) -> Never`, `Some(x)`, `None` (needs a type context). `wrap.add` / `wrap.sub` / `wrap.mul` / `wrap.shl` wrap integers (no `import`).

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
named       = intWidth | "f32" | "f64" | "bool" | "String" | "Char" | "Unit" | "Never" | "Error" | ident
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

See `examples/` for programs that actually run (`hello.zee`, `greet.zee`, `factorial.zee`) plus one file of each role so the explorer icons show up. A packaged monolith lives in [`examples/projeto-1`](examples/projeto-1) (`users` + `orders` + `ui`; HTTP is still a stdout client). An HTTP API lives in [`examples/shop-api`](examples/shop-api) (`import http`; `@Get` is metadata the **package** reads; `zee test` uses `dispatch`, `zee run` listens).

## Editor

The VS Code / Cursor extension is in [`editor/vscode`](editor/vscode). It starts **`zee lsp`** for hover, complete, go to definition, find references, inlay hints, semantic tokens, **format**, **rename**, and checker diagnostics. Breakpoints step the TypeScript interpreter via `zee debug` (DAP). TextMate highlighting stays as fallback. JetBrains sources live in [`editor/jetbrains`](editor/jetbrains) (same grammar + LSP4IJ client; format and rename come from the server). Marketplace / Open VSX packaging is `npm run editor:package` and [publish-editor](.github/workflows/publish-editor.yml) (`workflow_dispatch`, needs `VSCE_PAT` / `OVSX_PAT` / `JETBRAINS_MARKETPLACE_TOKEN`).

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
catalog.json    official library index (`zee get ZeeTest` / `zee get env`)
editor/vscode   TextMate grammar + `zee lsp` client + format/rename + DAP debugger
editor/jetbrains TextMate grammar + LSP4IJ (`zee lsp`)
```

## Commands

| Command | Meaning |
|---|---|
| `npm test` | run the language tests |
| `npm run typecheck` | TypeScript strict check |
| `zee new <name> [--kind bin\|api\|web\|monolith\|service]` | create a package (default `bin`) |
| `zee init [name]` | scaffold the current directory |
| `zee generate feature <name> [--api\|-i]` | HTTP slice (`user` → `src/modules/users/users.*.zee`) |
| `zee generate controller <name> [--api\|-i]` | HTTP in; `--api` or invokable `-i` |
| `zee generate resource <name>` | HTTP mapper (`users.resource.zee`) |
| `zee generate action\|service\|repository\|model\|api\|module <name>` | one layer file |
| `zee get [alias...]` | resolve alias from `libs.toml` or `catalog.json`, fetch into `.zee/` |
| `zee update [name...]` | re-resolve deps within current constraints and rewrite `zee.lock` |
| `zee publish` | publish this package to `ZEE_REGISTRY` / `[registry] url` |
| `zee registry` | serve the HTTP registry from a file root (`--root`, `--token`, `--port`) |
| `zee run [file]` | interpret a program (or the project entry) |
| `zee check [file]` | type-check only |
| `zee fmt [file]` | format a file, or every `.zee` in the package |
| `zee debug` | Debug Adapter Protocol (stdio) for editors |
| `zee test` | inject ZeeTest and run `ZeeTest.run()` (`fn test*` in `*.test.zee`) |
| `zee lsp` | language server (stdio JSON-RPC) for editors |
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
