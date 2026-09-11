# Zee — language direction

North star for syntax that is **not** in v0 yet. Still hosted on Node; still no PHP/JS coercions.

v0 today: `fn` + UFCS methods (`self` / `var self`), associated `Type.fn()` / `Type.CONST`, nested types (`User.Constants`, no outer instance), unconstrained `fn f<T>` (infer or `f<i32>(…)`), `const` / `var`, `if`/`else`/`match`, `while`/`until`/`do`/`for`/`break`/`continue`, integer widths, `f32`/`f64`, `Option`, `?:` / `??=` / `!!=` / `&&=` / `||=` / `+=` `-=` `*=` / `/=` `%=` / `& | ^ ~ << >>` / `wrap.add`, `<===>`, `T[]` + array `redim`, `List<T>` / `Map<K, V>`, `struct` / `class` / `data` / `readonly`, `enum` / `sealed struct` / `sealed class` + `match` on variants, `===` / `!==` on `class`, `copy()` on `data`, `for x in xs` / `for (i, x) in xs`, `pub` / `internal` + `import`, `type` / `newtype`, `interface` / `sealed interface` / `implements`, `is`, stdlib `Error`, `panic` / `Never`, `defer`.

| Wanted | Source | Zee |
|---|---|---|
| Bindings | JS / VB | **`const` / `var`** (no `let`) |
| `redim` | VB6 | widen integer width (`i8` → `i32`); later, arrays |
| Tuples / multi-value | Go | `(T, U)` + `const (a, b) = …` |
| Errors | Go | last tuple slot: `Option<E>`, check `err != None` |
| `match` | PHP 8 | expression, no fall-through, exhaustive |
| Elvis | PHP / Kotlin | **`?:` only** (not `??`) |
| Fill-if-absent | PHP | `??=` on `var Option<T>` |
| Fill-if-present | (dual) | `!!=` — opposite of `??=` |
| `&&=` `\|\|=` | PHP | `var bool`, short-circuit |
| Three-way compare | PHP `<=>` | **`<===>`** — `Ord` → `i32` (`-1` / `0` / `1`) |
| `+=` `-=` `*=` `/=` `%=` | C / PHP | `var` only; no `++` / `--` |
| `defer` | Go | function-scoped, LIFO; no exceptions |
| `panic` | Go | abort (`Never`); not `err`, no `recover` |
| Collections | Kotlin + VB + Go | `T[]` buffer, `List<T>` immutable, `Map<K, V>` |
| Objects | C# | **OOP:** `struct` (value object) + `class` (identity object); `interface` / `sealed interface` + `implements` |
| `type` / `newtype` | Go | alias vs distinct wrapper (`UserId`); IDs are `newtype` |
| `==` / `===` | Kotlin | `data` is value `==`; `===` identity on `class` only |
| Docs | Rust | `///` on the next item; `//!` on the file/module; Markdown |
| Bits / wrap | C | `& \| ^ ~ << >>`; wrap is `wrap.add`, not `+` |
| Concurrency | coroutines + CSP | **Zee scheduler:** `task cpu { }`, `on io { }`, `yield`, `Chan<T>`, `select`. Dispatch is named. No `async`/`await`, no `go` |
| Unsafe / FFI | C / Go | `unsafe`, `*T` / `*var T`, `repr(C)`, `extern "C"` / `"host"` |
| Constructors | C# / Kotlin | **radar §9a** — v0 is `Name { fields }` + associated factories (`Type.empty()`). No `new` |
| DI | Nest | **radar §9b** — explicit module graph. No `@Inject`, no scan |
| Collection methods | Kotlin | **radar §9c** — catalog; `List` already has `map`/`filter`/`forEach` |
| Emptiness / blank | Kotlin | **radar §9e** — `isEmpty` / `isBlank` / `isNoneOrEmpty`; no `null` |

Non-goals: implicit casts, `null`, PHP/JS falsy (`0`, `""`, `[]`), language-level **zero values**, `Result<T, E>` as the **standard** error convention, `try` / `catch` / `throw` / `recover`, `async`/`await`, macros, operator overloading, `++`/`--`.

---

## Bindings — `const`, `var`, `redim`

No `let`. Immutable is `const`. Mutable is `var`. Both need an initializer.

```zee
const name: String = "zee"
const n = 40                 // infers i32
var i = 0
i = i + 1                    // ok
```

```zee
const x = 1
x = 2                        // error
```

Destructure uses `const` or `var` according to whether the pieces should move:

```zee
const (q, r) = divmod(10, 3)
var (body, err) = read(path)
```

### Integer widths and `redim` (VB6)

Integers are sized. v0 has the integer and float set below.

```
i8   i16   i32   i64    signed
u8   u16   u32   u64    unsigned
isize  usize            pointer-width (hosted today = 64-bit)
f32  f64                IEEE float
```

No `i128` / `u128` / `f16` / `i2` in this set. `bool` is not a number.

`redim` **changes the width of a `var`**, keeps the value (VB `Preserve`):

```zee
var x: i8 = 1
redim x: i32        // x is i32, value still 1
```

Widening (`i8` → `i32`, `u8` → `u32`) always succeeds. Narrowing fails at type-check unless the value is known to fit; no silent truncate. Signed and unsigned are different ladders — `redim` does not convert `i32` → `u32`.

`redim` is not a cast expression (`x as i32`). It **retypes the binding** from that point on, like BASIC.

Arrays later use the same keyword, classic VB6:

```zee
redim xs, 32
redim preserve xs, 64
```

---

## 0b. Numbers

### Literals

An **unsuffixed integer** is not yet `i32`. It is an integer literal that **becomes** the type the context asks for. If nothing asks, it is **`i32`**.

```zee
const n = 40                 // i32
const len: usize = 40        // usize
xs[0]                        // 0 is usize (index)
const x: u8 = 255            // ok
const y: u8 = 256            // error: does not fit
```

An unsuffixed float `1.0` is **`f64`**. Suffixes when you want a machine type on the token: `40u32`, `40i64`, `40usize`, `1.0f32`. No bare `40u` (ambiguous).

`0xFF`, `0b1010`, `_` in digits (`1_000`).

### No mixed arithmetic

`i32 + u32`, `i32 + i64`, `i32 + f64` are type errors. Same type on both sides, or convert.

### Conversion — `T(x)`, not `as`

```zee
const wide = i64(n)              // widen i32 → i64
const idx = narrow<usize>(n)     // i32 → usize: Option<usize>
const tiny = narrow<i8>(n)       // narrow a runtime value → Option<i8>
```

| From → to | Result |
|---|---|
| Widen, same signedness (`i32` → `i64`, `u8` → `u32`) | `T` via `T(x)` |
| Integer literal that fits | `T` |
| Narrow, or signed ↔ unsigned, of a **typed** runtime value | `narrow<T>(x) -> Option<T>` — never silent truncate |
| `i32` → `f64` / `f32` | `T` via `T(x)` (exact for integers in range) |
| float → int | `narrow<T>(x)` (`None` on NaN / out of range) |
| Wrap `newtype` (`i32` → `UserId`) | `UserId(n)` — always, same bits |
| Unwrap `newtype` (`UserId` → `i32`) | `i32(id)` — always, same bits |

`xs[n]` with `n: i32` is an error. Index type is **`usize`**. Convert or use a literal.

### `len` and index

- `xs.len` is **`usize`**
- `xs[i]` requires `i: usize`
- `redim xs, n` — `n: usize`
- `for i in 0..n` — `n` is `i32` or `usize` (range type follows `n`; `0` takes that type)
- `isize` is pointer-sized **signed** (index difference). Not the type of `.len`

### Overflow, `/`, float

- `+ - *` on integers **do not wrap** in the language. Overflow is **`panic`**. Wrap is `wrap.add` (see Operators). Kernel may refuse float; it does not change `+`.
- Integer `/` truncates toward zero. Divide by zero is **`panic`**. `%` matches that sign.
- `f32` / `f64` are IEEE. `NaN == NaN` is false. Floats are **not** `Ord` and **not** `Map` keys (`Eq`/`Hash` stay integers, `data`, `enum`).
- `zee:kernel` may **refuse** `f32`/`f64` until an FPU story exists. Same grammar; missing capability, not a dialect.

`Ord` applies to all integer types in this set (`i*` `u*` `isize` `usize`), plus `String` and `Char` (see 0c).

---

## 0c. String

`String` is **UTF-8**, immutable, always well-formed. It is not a Java `String` (UTF-16), not a PHP/JS bag of bytes you pretend is text, not a kernel `u8[]` with no encoding.

```zee
const name: String = "zee"
const n = name.len              // usize, **byte** length
const b: u8 = name[0]           // byte (Go), not a character
const hi = `hello, {name}`      // interpolation (backticks)
const line = "a" + "b"          // concat; `{` in "…" is literal
```

### Bytes vs characters

| Access | Type | Cost |
|---|---|---|
| `s.len` | `usize` | bytes |
| `s[i]` | `u8` | byte at offset `i: usize` |
| `for c in s { }` | `Char` | Unicode scalar (code point), not a grapheme |
| `s.bytes` | view / `u8[]` | same bytes |

`s[i] = …` is illegal (`String` is immutable). Mutate text by building a new `String`, or use `u8[]` for a buffer.

`Char` is one Unicode scalar (`'a'`, `'é'`, `'\n'`). Not a grapheme cluster (🇧🇷 is two scalars). Not a UTF-16 code unit. `'ab'` is a type error.

Invalid UTF-8 is **not** a `String`:

```zee
const (s, err) = String.fromBytes(buf)    // (String, Option<Error>)
```

Raw I/O is `u8[]`. Decode at the boundary.

### Quotes

| Form | Interpolation | Newlines |
|---|---|---|
| `"…"` | no — `{` is a character | `\n` escape only |
| `` `…` `` | yes — `{expr}` | allowed |
| `` ```…``` `` | no — raw block | yes, as written |

````zee
const msg = `{name} has {n} items`
const sum = `total {a + b}`

const blob = ```
line one
line two
```
````

- `` `…` `` interpolates `String`, `Char`, `bool`, integers. Not float in v1. Not arbitrary `class`. Escape: `\{` `` \` `` `\\` `\n` `\t`.
- `"…"` never interpolates. Escape: `\"` `\\` `\n` `\t`.
- Block `` ``` `` is raw (SQL, sample Zee, ASCII). No `{expr}`, no escapes except the closing fence. Optional label after the opener (` ```sql `) is **ignored** by the language (editor highlighting only).
- Opening newline after `` ``` `` is stripped. Common leading indent (column of the closing fence) is stripped — Kotlin `trimIndent`.
- A block’s closing fence matches the opener’s backtick count (3 or more). Content may contain shorter fences.
- `'a'` stays `Char`. `$name` is not interpolation.

### `Eq` / `Ord` / `Hash`

`String` and `Char` are `Eq + Hash + Ord`. Order is UTF-8 byte order (= Unicode scalar order for well-formed strings). Map keys: yes.

### What this is not

- Not UTF-16. Not `s[i]` as `Char` (Kotlin/Python) — that would be O(n) or a split code point.
- Not grapheme indexing (Swift).
- Not mutable strings / a `StringBuilder` type (`var s = s + "x"` rebinds; grow bytes with `u8[]`).
- Not implicit `i32 + String` (already refused). `{n}` interpolates only inside `` `…` ``.

---

## 0d. Comments and docs

`//` to end of line. `/* … */` block (not nested in v1). Those are **not** API docs.

**`///`** is a doc comment on the **next** declaration (`fn`, `const`, `var`, `struct`, `class`, `interface`, `enum`, `type`, `newtype`, field, method). Consecutive `///` lines merge.

**`//!`** is inner docs for the **enclosing file / module** (the directory’s module, or `src/` for the root). Put it at the top of the file.

```zee
//! HTTP client for the Zee stdlib.

/// Opens `path`. On failure returns `("", err)`.
///
/// Example:
///
/// ```zee
/// const (body, err) = open("notes.txt")
/// ```
pub fn open(path: String) -> (String, Option<Error>) { … }
```

Rules:

- Body is **Markdown**. Code fences in docs may use `zee`. `{` in docs is not interpolation.
- No `/** */`, no XML `<summary>`, no Javadoc `@param` / `@return`. Describe parameters in prose. Tags later if `zee doc` needs them.
- Hover in the editor and later `zee doc` show `///` on **`pub`** (and `internal` inside the module). File-private `///` is local hover only.
- A doc comment with no following declaration is an error (`///` is not a spare `//`).
- `//` immediately above an item is **not** a doc (unlike Go). Use `///`.

---

## Collections and objects

Three different things. Not PHP’s “array that is also a map that is also an object”.

| | Type | Mutability | Grows |
|---|---|---|---|
| Array | `T[]` | slots + `redim` if the binding is `var` | yes (`redim`) |
| List | `List<T>` | never (new list if you transform) | no |
| Map | `Map<K, V>` | entries if `var` | yes |
| Object | `struct` | fields if the binding is `var` | no |

Tuples `(T, U)` stay heterogeneous and fixed. Arrays are homogeneous.

### Array — `T[]` (VB buffer, Go slice feel)

```zee
var xs: i32[] = [1, 2, 3]
xs[0] = 9
redim preserve xs, 8          // length 8, first 3 kept, rest 0
const ys: i32[] = [1, 2, 3]   // no xs[i] =, no redim
```

- Index `xs[i]` requires `i: usize`. Out of bounds is **`panic`**.
- `xs.len` is `usize`.
- Integer literals in index/`len` context become `usize` (`xs[0]` is fine; `xs[n]` with `n: i32` is not).
- `const` array: cannot write slots, cannot `redim`. `var` array: both allowed.
- Empty needs a type: `var xs: i32[] = []`.
- `for x in xs` / `for (i, x) in xs` iterate arrays.

### List — `List<T>` (Kotlin)

Immutable sequence. Literals that you don’t intend to grow are lists:

```zee
const xs: List<i32> = [1, 2, 3]
const ys = xs.map { it * 2 }     // List<i32>, xs unchanged
```

- No `xs[i] =`, no `redim`.
- `[1, 2, 3]` infers `List<i32>` under `const`, and `T[]` under `var` when annotated `i32[]`. If unannotated `var xs = [1, 2, 3]`, infer **`i32[]`** (you wrote `var`, you probably want a buffer).
- Convert: `xs.toArray()`, `buf.toList()`.

`forEach` / `map` / `filter` are methods that take lambdas, not keywords.

### Map — `Map<K, V>`

Not a PHP array. Keys are typed.

```zee
var ages: Map<String, i32> = { "ana": 30, "bo": 2 }
ages["ana"] = 31
const frozen: Map<String, i32> = { "ana": 30 }
```

- Lookup `ages[k]` returns `Option<V>` (missing is `None`, not `null`, not `0`).
- `K` must be `Eq + Hash` (not float, not plain `class`, not `T[]`).
- `for (k, v) in ages` uses the tuple you already want.
- **Collection methods** (`each`, `map`, `filter`, `unique`, `flat`, `find`, `some`/`all`, `first`/`last`, `push`/`pop`, …): radar §9c. `List` already has `map`/`filter`/`forEach`. `for` stays.

### Types of type — `readonly`, `data`, `sealed`

Kotlin/C# modifiers we **want**, because they make the type *say what it is*. Java `class Foo` that anyone extends is the opposite.

| Modifier | Meaning | From |
|---|---|---|
| *(none)* | closed: nobody inherits | Kotlin default `final` |
| `readonly` | no field writes, even on a `var` binding | C# `readonly struct` |
| `data` | `==` by value, `copy`, destructure, `toString` | Kotlin `data class` |
| `sealed` | fixed set of variants; `match` is exhaustive | Kotlin `sealed` |
| `open` | inheritance allowed — **opt-in only** | Kotlin `open` |
| `enum` | sealed variants without payload | Kotlin / C# |

`struct` vs `class` — **both are objects** (C# OOP, not C records vs Java classes):

- **`struct`** — value object. Methods, fields, visibility, construction `Name { fields }`. Known layout, copy on assign, kernel-ok (`repr` later). No `===` (not a reference).
- **`class`** — identity object. Same OOP surface. Reference semantics, `===` for “same instance”. Hosted Zee first; not the kernel default.

A `struct` is not a mute C bag of fields. If it has no methods, that is a choice, not a language rule. Zee is object-oriented; the split is **value vs identity**, not “OOP vs not”.

A plain `class User` / `struct User` **cannot be subclassed**. That is sealed-by-default. You write `sealed` when there *are* variants; you write `open` only when you really want a subclass.

```zee
readonly data struct Point {
  const x: i32
  const y: i32
}

const p = Point { x: 3, y: 4 }
const q = p.copy(x: 0)
p == Point { x: 3, y: 4 }        // true: data
const (x, y) = p                 // data destructure
```

```zee
sealed class Shape {
  data class Circle { r: i32 }
  data class Rect { w: i32, h: i32 }
}

const area = match shape {
  Shape.Circle { r } => r * r
  Shape.Rect { w, h } => w * h
}                                // no `_` — exhaustive
```

```zee
enum Status {
  Ready
  Failed
}

readonly class Config {
  const host: String
  const port: i32
}

var cfg = Config { host: "localhost", port: 80 }
cfg.port = 443                   // error: readonly type
```

```zee
struct User {
  const name: String             // never mutates
  var age: i32                   // mutates only if the binding is `var`
}

fn mag(self: Point) -> i32 {
  self.x * self.x + self.y * self.y
}
```

Field `const` / `var` is Kotlin `val` / `var`. `readonly` on the type means *every* field behaves as `const`.

Methods: `self` (read), `var self` (mutate). Associated (`fn origin() -> Point`) is called `Point.origin()` — no `self`, not on an instance. No `new`. Construction is `Name { fields }`. Inside a type body, `self` in a type or constructor position is the enclosing name:

```zee
pub fn empty() -> self {
  self { rows: {}, nextId: 1 }
}
```

That is the same as `-> CompanyService` / `CompanyService { … }`. `self` as a type outside a type body is an error. No `static` keyword. Named constructors beyond that, and wiring a controller to a service, are **radar** (§9) — not a second construction syntax in v0.

### Nested types and associated constants

Java **inner** class (`Outer.this` hidden on the nested instance) stays **out**. C# / Kotlin **nested** type (a name under the outer type, no captured instance) is **in**. That is how `User.Constants.ANY_VALUE` works.

```zee
struct User {
  const name: String                         // field — set in User { name: … }

  pub const ROLE_ADMIN: String = "admin"     // associated — User.ROLE_ADMIN

  pub struct Constants {
    pub const ANY_VALUE: i32 = 1             // User.Constants.ANY_VALUE
  }
}

const n = User.Constants.ANY_VALUE
const role = User.ROLE_ADMIN
const u = User { name: "ana" }               // ROLE_ADMIN / Constants are not fields
```

Rules:

- A `const` / `var` **with an initializer in the type body** is associated (`Type.NAME`). A `const` / `var` **without** initializer is a field (constructor). No default field values — that would collide.
- Nested `struct` / `class` / `enum` / `interface` / `newtype` / `type` is allowed. Path is `Outer.Inner`. Visibility (`pub` / `internal`) applies to the nested name.
- Nested types **do not** see the outer instance. Pass `User` as a normal argument if you need it. No `inner`, no `this@User`.
- Nested types may nest again (`User.Constants.Limits.MAX`). Don’t abuse it — a module directory is still the usual grouping.
- **Anonymous classes: no.** Use a named nested type or a lambda.

`abstract` exists only on **`open class`**: unimplemented methods, cannot construct.

**Inheritance we keep:** only `sealed` trees (sum types) and, rarely, `open`. Same-module variants, like Kotlin sealed.

**Inheritance we refuse:** PHP/Java open-by-default, multiple implementation inheritance, dynamic properties, `class` as a bag of strings.

`data` + `sealed` together is the usual shape: the parent is sealed, each variant is `data`. `match` is the consumer. That *is* the object model we want, not a UML tree.

`data struct` is what the kernel can also use (tagged union / record). `class` stays off the bare metal until a runtime exists.

### Interfaces (C# nominative)

Capabilities, not inheritance. Implementing an interface is **not** subclassing. Types stay closed; `implements` is how you opt into a protocol.

```zee
interface Closeable {
  fn close(var self)
}

struct File implements Closeable {
  const path: String

  fn close(var self) { /* … */ }
}
```

Methods that satisfy an interface live **on the type** or as `fn name(self: Type)` in the **same module**. `implements Closeable` is **nominative** — the checker requires those methods; a coincidental `close` does not make a type `Closeable` (not Go).

| Form | Who implements | `match` exhaustive |
|---|---|---|
| `interface` | anyone who can see it | no |
| `sealed interface` | **this module only** | yes, like `sealed class` |

```zee
sealed interface Event { }

data struct Click { const x: i32 } implements Event
data struct Key { const code: i32 } implements Event

const label = match e {
  Click { x } => `click {x}`
  Key { code } => `key {code}`
}
```

Use **`sealed class` / `sealed struct`** when variants are nested in one family. Use **`sealed interface`** when the variants are already top-level types. Use **`interface`** when the set is open (`Closeable`, `Error`).

Rules:

- Methods only. No fields on an interface. No default bodies.
- Several: `implements Closeable, Reader`. No diamond state (there is no state).
- `interface` does **not** need `open`. Classes need `open` to subclass; anyone may `implements` a public interface.
- Two ways to take a capability:
  - static: `fn f<T: Closeable>(x: T)` (bound, like `T: Ord`)
  - existential: `fn f(x: Closeable)` (boxed; kernel = fat pointer)
- `is Type` tests an existential / sealed payload. Narrows in that `if` (Kotlin smart-cast). Not `as`.
- Built-in `Eq` / `Hash` / `Ord` stay **language** bounds (`data`, primitives). A user interface does **not** hook `==`. **No operator overloading.** Custom comparison is an ordinary method (`fn samePath`).
- Visibility: `pub interface`, `internal interface`, file-private default — same as types.

### Stdlib `Error`

`Error` is an **interface**, not Java `Exception`, not a mandatory `class`.

```zee
pub interface Error {
  fn message(self) -> String
}

data struct Fail {
  const text: String
} implements Error {
  fn message(self) -> String { self.text }
}

fn error(text: String) -> Error {
  Fail { text }
}
```

- Stdlib signatures use `(T, Option<Error>)`. A specific type is fine: `(T, Option<IoError>)` where `IoError implements Error`.
- `error("missing file")` is Go `errors.New`.
- You cannot `catch` it. Unfold `Option`, then `e.message`: `const e = err ?: return`.
- Field and method must not share a name (`text` vs `message`).
- Open `Error` is not exhaustive `match` and not a `Map` key. A concrete `data` error is `Eq` if it is `data`.
- JVM `Exception` at FFI becomes `Error` at the boundary (message from the host), never a thrown object inside Zee.

### `type` (alias) vs `newtype`

Two different tools. Go’s `type A = B` vs `type UserId int`. **IDs are `newtype`**, not alias.

```zee
type Handler = (Request) -> Response          // identical to that function type
type Table<K, V> = Map<K, List<V>>            // generic alias

newtype UserId = i32                          // distinct type
newtype Email = String

const id = UserId(40)
const n: i32 = i32(id)
id + 1                                        // error: not i32
id == 40                                      // error
id == UserId(40)                              // true
```

| | `type Name = T` | `newtype Name = T` |
|---|---|---|
| Same as `T`? | yes — interchangeable | **no** |
| Mix with `T` | yes (`UserId` alias + `i32` is one type) | never implicit |
| Construct / unwrap | nothing to do | `Name(x)` / `T(name)` |
| `Eq` / `Hash` / `Ord` | whatever `T` has | **same as `T`** (so `UserId` is a Map key) |
| User `interface` | N/A (there is no new type) | does **not** inherit; `implements` yourself |
| Layout | none | same bits as `T` (kernel-ok) |

Rules:

- Alias is for long types and names. It does not protect you from mixing `UserId` and `i32` — because there is no second type.
- `newtype` is **exactly one** inner type. Several fields → `struct`. Nested variants → `sealed`.
- No arithmetic, concat, or index on the wrapper unless you unwrap. `UserId` is not an integer.
- `pub type` / `pub newtype` follow visibility. File-private default.
- No cyclic alias. No alias of a `newtype` that tries to undo it (`type UserId = i32` after `newtype UserId` is a name clash).
- Prefer `newtype` for IDs, file descriptors, units (`Meters`). Prefer `data struct` when you want named fields, `copy`, destructure.

Not TypeScript `type UserId = number` as a safety feature — that is an alias and Zee will not pretend otherwise.

### Equality — `==` vs `===`

`data` is the **opt-in for value equality**. A plain `struct` / `class` does not grow a silent `equals`.

| | `==` / `!=` | `===` / `!==` | `Hash` / Map key |
|---|---|---|---|
| integers, `bool`, `String`, `Char`, `Unit` | value | not used (`===` is `==`) | yes (`Eq + Hash`) |
| `newtype` | same as inner | no | same as inner |
| `enum` | variant (and payload) | not used | yes |
| `data struct` / `data class` | all fields | `class` only: same object | yes if fields are `Hash` |
| `sealed` (variants `data` / `enum`) | same variant + payload | `class` only: same object | yes if variants are |
| plain `struct` | **type error** | **no** (not a reference) | no |
| plain `class` | **type error** | same reference | no |
| `List<T>` | elements, if `T: Eq` | no | yes if `T: Hash` (immutable) |
| `T[]` | elements, if `T: Eq` | no | **no** (mutable buffer) |
| `Map<K,V>` | same keys and values | no | **no** |
| `(T, U)` / `Option<T>` | parts, if they are `Eq` | no | yes if parts are `Hash` |
| `f32` / `f64` | IEEE `==` (NaN ≠ NaN) | no | **no** — not `Eq` as a bound |
| `Never` | no | no | no |

```zee
const p = Point { x: 1, y: 2 }          // data struct
p == Point { x: 1, y: 2 }               // true

var a = User { name: "ana" }            // plain class
a == a                                  // error: not Eq
a === a                                 // true: same object
var b = User { name: "ana" }
a === b                                 // false: two objects
```

Rules:

- `==` requires `Eq` on **both** sides, same type. No coercion.
- `===` exists only for **`class`** (identity). Not on `struct`, not on primitives, not on arrays.
- `data class` can be both: same fields → `==`; same object → `===`.
- **No custom `equals` / `hash` yet.** Want value `==`? Mark `data`. Want another notion (path vs inode)? Wait for `interface` (`Eq` as a user bound).
- No operator overloading. `==` is not a method you write on `File`.
- `Hash` only if `Eq`. `Map` keys stay `K: Eq + Hash` — so not a plain `class`, not `T[]`, not float.
- `Ord` is still only integers, `String`, `Char` (and `enum` by declaration order). `data` does **not** auto-`Ord` (field order would be a silent API). Sort with an explicit key.

### What we are not copying

- PHP mixed `array` (list + hash + object).
- JS `{ a: 1 }` as both map and object. Maps use `Map<K,V>` literals `{ k: v }`; structs use `Name { field: v }`.
- Java `List` vs `ArrayList` ceremony. Two types: `List<T>` and `T[]`.
- Java/PHP open-by-default `class`.
- Java/PHP “everything is a heap `class`”. Zee has value objects (`struct`) and identity objects (`class`).
- C `struct` as a mute layout with no methods. Zee `struct` is an object that happens to be a value.
- Go implicit interfaces (a `close` method is enough). Zee needs `implements`.
- Java `interface` as a second inheritance tree with fields / default soup in v1. Methods only.

---

## 1. Lambdas (Kotlin)

A lambda is a value of type `(A, B) -> R`. Three levels of binding — all valid:

```zee
const add: (i32, i32) -> i32 = { a, b -> a + b }   // explicit
xs.map { x -> x * 2 }                             // named, trailing
xs.map { it * 2 }                                 // implicit name `it` (1 param)
xs.map { 0 }                                      // param unused: omitted entirely
```

Rules:

- Expected type infers parameter types (`map`’s `f`). Annotate when there is no expected type.
- One parameter: you may name it, use `it`, or omit it when the body does not read the argument.
- Several parameters: names (or `_`) required — no `it`.
- Body is an expression or a block.
- Closures capture immutables by default.
- Named `fn` stays for declarations. No PHP `function () {}`.

---

## 2. Tuples + Go errors

A tuple **is** the type of multiple returns (more than Go, which cannot store `(int, error)` as a value).

```zee
fn divmod(a: i32, b: i32) -> (i32, i32) {
  (a / b, a % b)
}

const (q, r) = divmod(10, 3)
const pair: (i32, String) = (1, "zee")
const first = pair.0
const (_, r) = divmod(10, 3)
```

### Error convention (Go)

Last slot is the error. `None` means success — that is Go’s `nil`.

```zee
fn read(path: String) -> (String, Option<Error>) {
  if missing {
    return ("", Some(err))     // dummy T is written, not implied
  }
  (body, None)
}

fn main() {
  const (body, err) = read("notes.txt")
  if err != None {
    println("failed")
    return
  }
  println(body)
}
```

Rules:

- `(T, U, V)` are types. `(T)` is grouping, not a 1-tuple. `()` is `Unit`.
- Destructure with `const (a, b) = expr`. Arity must match. `_` discards a slot (`const (_, err) = read(path)`). `_` is **not** a “empty T” in the callee.
- **Errors:** `fn f(…) -> (T, Option<E>)`. Caller checks `err != None` before treating `T` as the happy path.
- **No language zero values.** Bindings still need an initializer. On failure the callee still returns a **real `T` it constructed** — often an explicit dummy (`""`, `0`, `[]`, `false`). The checker does not poison `T`.
- That `T` **may still be meaningful** when `err != None` (partial read: count + EOF). Or it may be a dummy. The function’s contract says which; `err` is what means failure, not `T == 0`.
- Types with no honest dummy (live `class`, a handle) do not fake `(T, err)`. Use `Option<T>` as the value, or only `Option<E>` when there is no payload.
- `Result<T, E>` is not the default. Tuples are the convention, including for errors.
- **No exceptions.** No `try`, `catch`, `throw`, `finally`, `throws`, **`recover`**. Recoverable failure is `err`. Abort is `panic`.
- JVM `Exception` stops at FFI (`Error` at the boundary).
- `Error` is a **stdlib interface** (`fn message(self) -> String`), not a thrown type. `error("…")` builds a `Fail`. Specific errors `implements Error`.

### `panic` (abort)

Bugs and broken invariants. Not file-not-found.

```zee
panic("unreachable")
const name = opt ?: panic("missing name")
```

| | `err` | `panic` |
|---|---|---|
| When | I/O, parse, caller can continue | Invariant broken, “this does not exist” |
| Type | `Option<E>` last slot | `Never` — does not return |
| Caller | `if err != None` | nobody handles it |

- `panic` takes **`String`** (`panic(`missing {name}`)`). Not an `Error` value in v1.
- Type **`Never`**: allowed where a value is required (`?:`, `match` arm, `return` of any T).
- Hosted: run `defer` (LIFO), print the message, kill the process.
- Kernel: halt + serial; `defer` may skip (capability, not a second syntax).
- Language faults are `panic`: overflow on `+`, divide by zero, index out of bounds.
- Missing file, bad JSON, `String.fromBytes` → **`err`**.
- No `!`, no `.unwrap()`. Force a `Some` with `x ?: panic("…")`.
- No `recover()`. That is `catch` with another name.

---

## 3. `match` (PHP 8)

```zee
const label = match code {
  200 | 201 => "ok"
  404 => "missing"
  _ => "other"
}
```

Expression, all arms same type, `|` for several patterns, `_` = PHP `default`, exhaustive on `enum`, no fall-through, no coercing `==`. `if` stays.

---

## 4. Operators

Assignment forms need `var`. Presence is `Option<T>`, not `null`, not truthiness.

### `?:` (Elvis) — the only coalescing *expression*

No `??` token. `?:` unwraps or defaults:

```zee
var name: Option<String> = None
const shown = name ?: "anonymous"     // String
```

- `a ?: b` — `a: Option<T>`, `b: T` → `T`
- Not PHP falsy: `0` and `""` stay values. `Some(0) ?: 1` is `0`.

### `??=` vs `!!=` (duals on `var Option<T>`)

| | When LHS is `None` | When LHS is `Some(_)` |
|---|---|---|
| `a ??= b` | `a = Some(b)` (initialize) | unchanged |
| `a !!= b` | unchanged | `a = Some(b)` (update) |

```zee
var a: Option<i32> = None
a ??= 1      // Some(1)  — filled because it was empty
a ??= 9      // Some(1)  — already Some, skip
a !!= 2      // Some(2)  — present, so overwrite
var b: Option<i32> = None
b !!= 2      // None     — absent, so skip
```

`!!=` is the opposite of `??=`: write only if a value is **already there**. Never used as `!==`.

### `&&=` / `||=`

```zee
var ok: bool = true
ok &&= ready()      // if ok is false, ready() is not called
ok ||= ready()
```

Only `bool`.

### `<===>` (three-way / spaceship)

PHP’s `<=>`, spelled so it cannot be mistaken for `<=` / `=>` / `===`:

```zee
const n = 1 <===> 2          // i32: -1
const z = "a" <===> "a"      // 0
const p = 3 <===> 1          // 1
```

- Same type both sides. `Ord` only: integers, `String`, `Char`, and `enum` (declaration order). Not `bool`, not float, not `Option`.
- Result is **`i32`**: `-1` if left `<` right, `0` if equal, `1` if left `>` right.
- String order is UTF-8 bytes, same as `<` / `<=` / `>` / `>=`.

`==` / `!=` need `Eq`. `===` / `!==` are identity on `class` only (see Equality).

### `+=` `-=` `*=` `/=` `%=`

Sugar for `lhs = lhs ⊕ rhs`, with **`lhs` evaluated once** (`xs[i] += 1` does not index twice). Only on `var`. Same type both sides — no mixed arithmetic, no implicit `i32 + String`.

```zee
var i = 0
i += 1
i -= 1
i *= 2
i /= 2
i %= 10

var s = "a"
s += "b"           // String concat
```

- Integers: all five. Division / remainder follow the existing `/` `%` rules (no wrap on `+`).
- `String`: only `+=` (concat). Not `-=`.
- `bool` / `Option` / tuples / `class`: no. Use `&&=` / `||=` for bool.
- **No `++` / `--`.** Three-clause `for` uses `i += 1`.
- No `**=`.

### Bitwise

On **integer** types only (not float, not `bool`): `& | ^ ~ << >>` and `&= |= ^= <<= >>=` on `var`. `~` is unary. Shifts: count is `u32` or unsigned of same width; `>>` on signed is arithmetic, on unsigned is logical. No `>>>`. *(in the interpreter)*

```zee
const flags = 0b1010u8
const x = flags & 0b0010u8
```

### Wrapping arithmetic (not a second `+`)

Language `+ - *` **panic** on overflow. Wrap is **named**, in stdlib module `wrap`: `wrap.add`, `wrap.sub`, `wrap.mul`, `wrap.shl`. Same types both sides. Kernel uses these when wrap is the point. Hosted v0: `wrap` is a builtin (no `import`).

### `defer` (Go)

`defer` registers work that runs when the **function** returns, LIFO. Arguments (if a call) are evaluated **now**. No exceptions to “catch”; this is resource cleanup next to Go `err`.

```zee
fn load(path: String) -> (String, Option<Error>) {
  const (f, err) = open(path)
  if err != None {
    return ("", err)
  }
  defer close(f)

  const (body, err2) = readAll(f)
  if err2 != None {
    return ("", err2)
  }
  (body, None)
}
```

Block form is the same idea (Zee `{ }` is already a block, not `func(){ }()`):

```zee
defer {
  close(f)
}
```

Rules:

- Scope is the **function**, not the inner `{ }` (Go, not Swift). A `defer` inside a loop runs once per iteration, at function exit.
- Runs on every `return`, including early `return` after `err != None`.
- Nested `defer` in a nested `fn` / lambda belongs to **that** function.
- Not a substitute for `err`. `defer` does not turn failure into success.
- Hosted `panic` runs defers then kills the process. Kernel halt may skip defers — capability, not a second syntax.

Not VB `On Error`. Not `try/finally`. Not `using` / `use`.

---

## 5. Loops

The usual set, plus VB6 `Until` as the inverse of `While`. `cond` is always `bool` — no truthiness. `break` / `continue` work in all of them.

```zee
while remaining > 0 {
  remaining = remaining - 1
}

until ready() {
  wait()
}

do {
  remaining = remaining - 1
} while remaining > 0

do {
  wait()
} until ready()

for (var i = 0; i < n; i += 1) {
  println(str(i))
}

for {
  if done() { break }
}

for x in xs { }
for (i, x) in xs { }
for i in 0..n { }
```

| Form | Runs while | Test | From |
|---|---|---|---|
| `while cond { }` | `cond` is true | before body | C / PHP / Kotlin |
| `until cond { }` | `cond` is false | before body | **VB6 `Do Until … Loop`** |
| `do { } while cond` | `cond` is true | after body (runs ≥1) | C / PHP |
| `do { } until cond` | `cond` is false | after body (runs ≥1) | **VB6 `Loop Until`** |
| `for (init; cond; step) { }` | `cond` is true | before body | C / Go / PHP |
| `for { }` | forever | — | Go |
| `for x in xs { }` | items remain | — | Kotlin / PHP `foreach` |
| `for (i, x) in xs { }` | items remain | — | PHP `$k => $v` |
| `for i in 0..n { }` | `0 <= i < n` | — | range, exclusive end |

`until cond { }` is exactly `while !cond { }`. `do { } until cond` is exactly `do { } while !cond`. Both exist so the condition can be written in the positive (“stop when ready”) like VB6.

Rules:

- `until` / `do-until` take `bool`. `until err != None` is legal; `until file` is not.
- Three-clause `for`: any clause may be empty. `for (; ; )` is allowed but `for { }` is the spelling we want for infinite.
- Init in `for` may declare `var`. Scope of that binding is the loop.
- `0..n` exclusive (`0..3` → 0, 1, 2). Inclusive `0..=n` later if needed.
- Integer ranges are built-in (kernel does not wait on `List`).
- `xs.forEach { … }` is a lambda call, not a keyword.
- Labeled `break 'outer` later, not v1.

---

## 5b. Generics

The spelling is already in the spec: `List<T>`, `Map<K, V>`, `Option<T>`. That is the language, not a host trick.

```zee
fn id<T>(x: T) -> T { x }

fn zip<A, B>(a: A, b: B) -> (A, B) { (a, b) }

pub struct Box<T> {
  pub const value: T
}

const n = id(40)                 // T = i32
const n2 = id<i32>(40)           // explicit when inference has no expected type
const b = Box<String> { value: "zee" }
```

v0 has unconstrained `fn f<T>` (infer from arguments, or `f<i32>(…)`). `struct Box<T>` and bounds `T: Closeable` wait.

### Where they go

- `fn`, `struct`, `class`, `enum`, `data` / `sealed` types.
- Type position: `Option<List<i32>>`, `(T, Option<E>)`, `(T) -> R`.
- Call: `name<Type, …>(…)`. Comparison `a < b` is not a type argument.

Names: `T`, `U`, `K`, `V`, `E`, `R` by convention. Full words are fine (`fn wrap<Item>(…)`).

### Inference

Local, like the rest of Zee. The checker fills `T` from arguments and the expected type. If both sides disagree, **error** — no “whatever would make this compile”, no Java raw `List`.

`None` is `Option<T>`: expected type supplies `T`, or write `None<i32>`. `Some(1)` is `Option<i32>`.

### Bounds

Unconstrained `T` is allowed. When a body needs a capability, name it:

```zee
fn max<T: Ord>(a: T, b: T) -> T { if a >= b { a } else { b } }

fn shutdown<T: Closeable>(x: T) { x.close() }
```

Built-in bounds (language capabilities, not Java types):

| Bound | Meaning | Who has it |
|---|---|---|
| `Eq` | `==` / `!=` | integers, `bool`, `String`, `Char`, `Unit`, `enum`, `data`, `newtype` (if inner is), sealed of those, `List`/`tuple`/`Option` when parts are — **not** float, **not** plain `struct`/`class` |
| `Hash` | can be a `Map` key | same as `Eq`, minus `T[]` and `Map` (those may be `Eq` but not keys) |
| `Ord` | `< <= > >=` and `<===>` (`i32` -1/0/1) | all integer types, `String`, `Char`, `enum` (declaration order). **Not** float, **not** auto on `data` |
| *user `interface`* | the methods of that interface | types that `implements` it |

`Map<K, V>` **requires** `K: Eq + Hash`.

Several bounds: `T: Eq + Hash + Closeable`. No `where` clause.

User interfaces do not replace `Eq` / `Hash` / `Ord`. No operator overloading.

### Variance, wildcards, erasure

- **Invariant always.** `List<i32>` is not a `List<i64>`. No `in` / `out`, including on `open class`.
- **No** `List<?>`, `List<?> extends`, `*`, raw `List`.
- **Zee does not erase.** `List<i32>` and `List<String>` are different types at check time. A JVM backend may wipe the *machine* representation; the language does not grow Java’s heap pollution or `List` raw types.
- No higher-kinded types (`F<T>` as a parameter). No const generics (`Array<T, 4>`). `T[]` stays the array spelling.

### What this is not

- Not Java generics (erasure, wildcards, `extends`, raw types).
- Not Go `any` + type switch as the way to write generic code (bounds exist).
- Not C++ templates (no duck-typed `T` that compiles if the body happens to work). A missing bound is a type error at the definition, not at the call in a mysterious instantiation.
- Not a second language on the JVM. `ArrayList<T>` is FFI, not stdlib.

---

## 6. Implementation order

| Prerequisite | Why |
|---|---|
| `var` + `=` | `??=`, `!!=`, `&&=`, `+=` |
| Tuple type | Go returns + errors |
| Function values | lambdas |
| Pattern syntax | `match` |
| `Option<T>` | `?:`, `??=`, `!!=`, `err != None` |
| Generics `Foo<T>` | `List`, `Map`, `Option`, generic `fn` / `struct` |
| `var` + `bool` | `while` |
| Range `0..n` | integer `for` |

1. `const` / `var` + assignment  *(in the interpreter)*  
2. Same-package files (`src/*.zee` one module, no `import` yet)  *(superseded by item 11)*  
3. Tuples + destructure + Go `(T, Option<E>)`  *(in the interpreter)*  
4. Lambdas (`it` + omitted param)  *(in the interpreter; trailing `xs.map { }` landed with List)*  
5. `match`  *(in the interpreter; `enum` / `sealed` arms are item 12)*  
6. Integer widths + `redim`  *(in the interpreter; `f32`/`f64` in the interpreter)*  
7. `Option` + `?:` / `??=` / `!!=` / `&&=` / `||=` + `<===>`  *(in the interpreter)*  
8. `while` / `until` + `do-while` / `do-until` + `break`/`continue`  *(in the interpreter)*  
9. three-clause `for` + `for i in 0..n`  *(in the interpreter)*  
10. `T[]` + `redim` arrays + `struct` / `data` / `readonly`  *(in the interpreter; `for x in xs` enabled)*  
11. `pub` / `internal` + `import` (second directory)  *(in the interpreter; `[deps]` + `libs.toml` + `zee get` / `zee update` / `zee publish` + file and HTTP registry via `zee registry`)*  
12. `sealed` + `match` on variants  *(in the interpreter; `sealed class` landed with item 14)*  
13. `List<T>` / `Map<K, V>` as library types on top of arrays  *(in the interpreter; methods/`self` UFCS landed first so `xs.map { }` exists)*  
14. `class` (reference) + `===` / `!==` + `copy()` on `data`  *(in the interpreter; closed — no `open` / `abstract`)*  
15. `type` / `newtype`  *(in the interpreter; generic aliases `type Table<K, V> = …` included)*  
16. `interface` / `sealed interface` / `implements` + stdlib `Error`  *(in the interpreter; existential + `is` smart-cast; no `open` / `abstract`, no `fn f<T: Closeable>`)*
17. `panic` / `Never` + `defer`  *(in the interpreter; hosted abort is `PanicError`; `panic(\`…{x}…\`)` interpolates)*
18. associated names + nested types  *(in the interpreter; `Type.origin()` / `Type.CONST` / `Outer.Inner`; no Java inner; associated names are not constructor fields)*
19. user generics `fn f<T>`  *(in the interpreter; infer from args or `f<i32>(…)`; invariant; unconstrained `T` only — bounds `T: Closeable` / `T: Eq` and `struct Box<T>` wait)*
20. constructors beyond `Name { fields }`  *(radar §9a — not in the interpreter; associated factories are the v0 stand-in)*
21. DI / module wiring  *(radar §9b — `zee generate` files exist; the language does not wire them)*
22. collection methods (§9c catalog)  *(radar — `List` has `map`/`filter`/`forEach`; Map/array and the rest wait)*
23. emptiness / blank / none predicates  *(radar §9e — Kotlin `isEmpty`/`isBlank`/`isNullOrEmpty`; Zee has no `null`)*

Kernel / OS (`zee-os`) still waits on a freestanding profile.

---

## 6b. Modules and visibility

A **package** is one `zee.toml` (`[package].name`). That is the unit you publish, depend on, and run (`zee run`).

A **module** is one **directory** of `.zee` files (Go). All files in the same folder share the module; they see each other’s `internal` and `pub` names **without** `import`.

```
hello/
  zee.toml                 # name = "hello"
  src/main.zee             # root module (entry)
  src/util.zee             # same module as main — no import
  src/http/server.zee      # module `http`
  src/http/client.zee      # same module as server.zee
```

- `src/` is the **root module** of the package.
- `src/http/` is module `http` (imported as `http`). Every `.zee` file in that folder is the same module — no required `mod.zee`.
- Nested: `src/http/tls/` is `http.tls`.
- You cannot have both `src/http.zee` and `src/http/` (file vs folder clash).
- `zee.toml` `entry` stays `src/main.zee`. `main` is not imported; it is the program start.
- Import cycles are a compile error.

### File layers (HTTP slice)

The compiler does not require these suffixes. They are the **tooling convention** (`zee generate` + explorer icons). One directory is still one module.

```
Request → controller → action → service ─┬─→ resource  → response
                                         ├─→ repository → api
                                         └─→ model      → db   (DI, §9b)
```

| Layer | File | Does |
|---|---|---|
| controller | `users.controller.zee` | HTTP in. Maps the request onto an action. |
| action | `users.action.zee` | One use-case (or a small set). Calls the service. |
| service | `users.service.zee` | Domain rules. No HTTP, no SQL. |
| resource | `users.resource.zee` | Maps domain → HTTP body (Laravel Resource). **Not** “generate the whole stack”. |
| repository | `users.repository.zee` | Persistence port. Talks to `api` or `model`. |
| api | `users.api.zee` | Outbound HTTP client. |
| model | `users.model.zee` | DB shape. Wired by DI (§9b), not constructed in the controller. |
| module | `users.module.zee` | Graph stub until §9b. |

Tests: **`.test.zee` only** (`users.service.test.zee`). No `foo_test.zee`. No `.spec.zee`. `fn testFoo()`. Tooling (`zee test`), not a `test` keyword.

App entry stays `src/main.zee`. A published library uses `src/lib.zee` (no `main`).

### CLI schematic

```
zee generate controller user --api      # or -i / --invokable
zee generate action user
zee generate service user
zee generate resource user               # HTTP mapper
zee generate repository user
zee generate model user
zee generate api user
zee generate module user                 # DI stub
zee generate feature user --api        # the whole slice
```

```
src/users/users.controller.zee
src/users/users.action.zee
src/users/users.service.zee
src/users/users.resource.zee
src/users/users.repository.zee
src/users/users.api.zee
src/users/users.model.zee
src/users/users.module.zee
```

- `user` inflects to `users` (Laravel). Uncountable names stay (`http`, `tls`, `math`, `auth`).
- Only the **last** path segment inflects: `admin/user` → `src/admin/users/`.
- `--api` on a **controller** or **feature** is Laravel API verbs: `index`, `store`, `show`, `update`, `destroy` (no `create`/`edit` views).
- `-i` / `--invokable` is a single `invoke` (Laravel `__invoke`).
- `--api` and `-i` cannot be combined.
- `zee generate feature` writes every layer file. `zee generate resource` writes **only** `*.resource.zee`.
- Aliases: `co`, `act`, `s`, `re`, `repo`, `mod`, `api`, `feat`. `mo` is the module stub.
- `zee new` stays **package**. Generate is **inside** a package. Path is relative to `src/`.
- Wiring is not generated — `*.module.zee` is a comment until DI (§9b).

### Import (Kotlin-shaped)

```
import http                     // bind the module: http.get(...)
import http.Client              // one name
import http.{Client, Request}   // several
import http.Client as HttpClient
```

- No star import (`import http.*`) — dependencies stay explicit.
- Paths are identifiers (`http.Client`), not Go strings (`import "net/http"`).
- External packages: `import json.Value` where `json` is a `[deps]` name in `zee.toml`. Same syntax.

### Visibility (three levels)

| Keyword | Who sees it |
|---|---|
| *(none)* | **File-private** — only that `.zee` file |
| `internal` | Same **module** (same directory) |
| `pub` | Other modules / packages that `import` it |

No `protected`. No export-by-capital-letter (Go). No `public` keyword — `pub` is enough.

Applies to top-level `fn`, `const`, `var`, `struct`, `class`, `enum`, and to **fields** / methods.

```
// src/http/client.zee
pub struct Client {
  pub const host: String
  var timeoutMs: i32              // file-private field
  internal var retries: i32       // visible in src/http/*.zee
}

pub fn connect(host: String) -> Client { … }

internal fn reset(c: Client) { … }   // http internals only

fn debugDump(c: Client) { … }        // this file only
```

- `pub struct` does **not** make fields public. Export a field with `pub const` / `pub var`.
- Top-level `pub var` is allowed but is **process-wide mutable state** — use rarely (kernel tables, intern pools). Prefer `const` and passing values.
- `main` may be unexported (`fn main`) — only the compiler calls it.

### What this is not

- Not Python (everything public, folders are not modules).
- Not PHP namespaces + `use` + `public` on every member.
- Not Java packages with classpath scanning.
- Not Rust `mod foo;` declarations — the **directory is the module** (Go). Import spelling is Kotlin.

---

## 6c. Runtimes

**Zee is the language.** Node, JVM, LLVM, WASM, and the kernel are machines it runs on. They do not get a vote on syntax, types, modules, or the stdlib.

A Zee program is the same program on every backend. If a feature only exists on the JVM (classpath, `null`, Java exceptions, `java.util.*` as the collections), it is **not a Zee feature** — it is a hole in that backend.

| Environment | Role | When |
|---|---|---|
| **Node interpreter (TS)** | Bootstrap: lexer, checker, REPL, `zee generate` | **now** |
| **JVM** | One hosted *machine*: emit `.class` / `.jar` so existing Java processes can load Zee | after Zee has its own IR/bytecode |
| **LLVM / native** | Another machine — closer to the metal, and to the kernel subset | when IR is stable |
| **WASM** | Another machine | later |
| **`zee:kernel`** | The north star. No Node, no HotSpot, no host stdlib | `zee-os` |

Hard rules:

- **Zee stdlib is Zee** (`List`, `Map`, `Option`, `String`). Not `java.util`, not `node:fs`. A JVM backend *implements* those types on top of the machine; it does not replace them.
- **No dialect per backend.** `zee:kernel` may *refuse* capabilities (no hidden alloc). It must not invent a second grammar.
- **Interop is FFI**, like C calling libc — opt-in, typed, at the edge. `null` from Java stops at the boundary (`Option` / `err`). Hosted code that never FFI's Java must be writable without knowing Java exists.
- **Do not rewrite v0 in Java.** The TS interpreter is scaffolding. Porting it now makes two languages by accident.
- **Do not treat “languages on the JVM” (Kotlin, Scala, Groovy) as the model.** Those are JVM languages. Zee using the JVM as a CPU is the C/x86 model: the ISA is not the language.
- **Concurrency is Zee’s scheduler**, not the host’s. No compiling `task` to goroutines, `Promise`, Java threads, or `pthread`. A backend *implements* Zee tasks on the machine the way LLVM implements `+` on x86.

Company jar/Quarkus is a *deployment* of Zee, not a reason to look like Java.

---

## 7. Decisions (closed)

1. **`!!=`** — dual of `??=` (assign if Some), not `!==`.
2. **Elvis spelling** — `?:` only. No `??`.
3. **Lambdas** — `it` allowed; param may also be omitted (unused, or the implicit single arg).
4. **Errors** — Go-style last tuple slot, not `Result` as convention.
5. **Loops** — the known set (`while`, `do-while`, C three-clause `for`, `for in`, `0..n`) plus VB6 `until` / `do-until` as inverses.
6. **Bindings** — `const` / `var`, not `let`.
7. **`redim`** — VB6-style retype of a `var`: widen `i8` → `i32` (preserve value); later, array length.
8. **Collections** — `T[]` growable buffer, `List<T>` immutable, `Map<K,V>` typed; no PHP mixed array.
9. **Types** — OOP à la C#: `struct` (value object) and `class` (identity object), both with methods. Default closed. `data`, `sealed`, `readonly` in; `open` opt-in. Not C mute structs, not Java everything-is-class.
10. **Modules** — package = `zee.toml`; module = directory; root = `src/`. Same folder, no import.
11. **Import** — `import http`, `import http.Client`, `import http.{A, B}`, `as` rename. No glob.
12. **Visibility** — default file-private; `internal` = module; `pub` = export. Fields opt-in. No `protected`, no Go capitals.
13. **Runtimes** — Zee is *the* language. Backends (Node bootstrap, JVM, LLVM, WASM, kernel) are machines. No Java/Kotlin dialect, no host stdlib as Zee stdlib. JVM is optional hosted codegen, not identity.
14. **Generics** — `Foo<T>`, `fn f<T>(…)`, `name<T>(…)`. Infer locally. Invariant. No wildcards, no raw types, no erasure. Bounds: built-in `Eq`/`Hash`/`Ord` plus user `T: Closeable`.
15. **Numbers** — `i8…i64`, `u8…u64`, `isize`/`usize`, `f32`/`f64`. No mixed arithmetic. Literals untyped until context (default `i32` / `f64`). `.len` and index are `usize`. Convert with `T(x)` (widen) or `narrow<T>(x)` (narrow → `Option`). No `as`, no wrap on `+`. Float is not `Ord` / Map key.
16. **String** — UTF-8, immutable, well-formed. `.len` / `s[i]` are bytes (`u8`). `for c in s` / `'a'` is `Char` (scalar). `"…"` plain; `` `…{expr}…` `` interpolates; `` ```block``` `` raw multiline. `fromBytes` at the boundary. `String`/`Char` are `Eq+Hash+Ord`.
17. **Compound assign** — `+=` `-=` `*=` `/=` `%=` on `var` (lhs once). `String` only `+=`. No `++` / `--`.
18. **`defer`** — Go: function-scoped, LIFO, args now. Block `{ }` allowed. Cleanup, not error handling.
19. **No exceptions** — no `try` / `catch` / `throw` / `finally` / `recover`. Recoverable = `err`; abort = `panic`.
20. **`panic`** — `Never`, takes `String`. Bugs / overflow / div0 / OOB. Hosted: defers then abort. Kernel: halt. No unwrap operator.
21. **No zero values** — failed `(T, err)` still returns a real `T` the callee wrote (dummy `""`/`0`/`[]` or partial success). Checker does not poison `T`. Types with no dummy do not fake this convention.
22. **Equality** — `data` / primitives / `enum` / `List` / tuples / `Option` are `Eq` (and `Hash` when safe). Plain `struct`/`class` are not. Identity is `===` on `class` only. No custom `equals`. `data` is not auto-`Ord`.
23. **Interfaces** — nominative `implements` (not Go). `interface` anyone may implement; `sealed interface` same-module + exhaustive `match`. Methods only, no default bodies. `T: Closeable` or existential `Closeable`. `is Type` narrows. `Error` is `fn message(self) -> String` plus `error("…")` / `Fail`. No operator overloading.
24. **`type` / `newtype`** — `type A = T` is alias (interchangeable). `newtype UserId = i32` is a distinct wrapper; wrap/unwrap with `UserId(n)` / `i32(id)`; inherits `Eq`/`Hash`/`Ord` of inner, not user interfaces. IDs use `newtype`, not alias.
25. **Docs** — `///` on the next item, `//!` on the file/module. Markdown. `//` / `/* */` are not docs. No Javadoc/`/**`.
26. **Methods** — `self` / `var self`; associated `Type.fn()` / `Type.CONST`; nested types (`User.Constants`) with **no** outer instance; no Java inner; no anonymous; `abstract` only on `open class`; no operator overloading.
27. **Bits / wrap** — `& | ^ ~ << >>` and compounds on integers. `+` panics; wrap is `wrap.add`. No `++` / `--` / `**=` / `>>>`. *(in the interpreter)*
28. **Concurrency** — Zee scheduler, **explicit coroutines**. Spawn names the dispatcher (`task cpu { }`). Hop queues with `on io { }` (runs that block there, then resumes here). `yield` is an explicit scheduler turn. `recv` / `send` / `select` also park. No `go`, no `async`/`await`, no function coloring. `Chan<T>` + `select` stay. Not Go’s runtime, not Promises, not OS threads as the language.
29. **Unsafe / FFI** — `unsafe { }` / `unsafe fn`; `*T` / `*var T`; `repr(C)` / `repr(packed)`; `extern "C"` / `extern "host"`; `asm("…")` inside unsafe. Host may refuse `asm` (capability).
30. **No macros.** Codegen is `zee generate`. No preprocessor.
31. **Packages** — `zee.toml` `[package]` + `[deps]`; `libs.toml` catalog; `zee get` (honors lock) + `zee update` (re-resolve within constraint) + `.zee/` + `zee.lock`; SemVer via registry (`docs/REGISTRY.md`) + `zee publish`. One app manifest. No `package.json` as Zee config. First official lib: `libs/env` (`import env`) — process env + `.env` / `.env.{profile}` next to `zee.toml`. Host builtins `getenv` / `envProfile` (no Zee `null`).
32. **`<===>`** — three-way compare (PHP `<=>`), spelled so it cannot be `<=` / `=>` / `===`. `Ord` only; result is `i32` (`-1` / `0` / `1`). `||=` stays on `var bool` with `&&=` (short-circuit).

---

## 8. Language closed (except radar)

§8a–8d are **defined**, even if a backend implements them later or refuses them as a capability. They are not open questions.

**Radar** (§9) is the remaining language hole: constructors, DI, collection methods, and emptiness/blank predicates. Do not invent a spelling in the interpreter until it is decided here.

### 8a. Concurrency (explicit coroutines, Zee scheduler)

No `async fn`, no `await`, no `Promise`, no goroutine, **no `go`**. A function is a function — concurrency does **not** color types. What you write is a **coroutine**: you name **which dispatcher** it runs on, and you see **where** it can park.

CSP is still the *shape* for talking between tasks (`Chan`, `select`). The spawn is a coroutine with an explicit queue, not an implicit “fire this somewhere”.

```zee
task cpu {                      // spawn on the compute dispatcher
  work(x)
}

task io {                       // spawn on the I/O dispatcher
  const body = on io { readFile(path) }
  println(body)
}

on io {                         // hop: run this block on `io`, then resume here
  readFile(path)
}

yield                           // explicit turn: give the scheduler the CPU

const c = Chan<i32> { }
c.send(1)
const n = c.recv()              // park until a value (also a dispatch point)

select {
  c.recv() => println("c")
  d.recv() => println("d")
  _ => { }                      // default, non-blocking
}
```

**Dispatchers** are Zee names, not host thread pools leaking into the language:

| Name | For |
|---|---|
| `cpu` | compute; default for `task` if you must pick one |
| `io` | blocking host I/O (files, sockets). Kernel may **refuse** `io` (capability) |

- **`task <dispatcher> { }`** — spawn a coroutine. The dispatcher is **required**. Body is a block (a coroutine), not a colored function. `task { }` without a dispatcher is a parse error.
- **`on <dispatcher> { }`** — run this block on that queue, wait until it finishes, continue on the caller’s dispatcher. Like a named `withContext`. Expression: the block’s value.
- **`yield`** — cooperative yield. You wrote the dispatch point. Not inserted by an `await` desugar.
- **`recv` / `send` / `select`** — park points that you also wrote. They are not silent `await`.
- **`Chan<T>`** is a Zee stdlib type (buffered via `Chan<T> { cap: 4 }` or similar field). Unbuffered default. Not Go `chan`, not `java.util.concurrent`, not a JS `EventEmitter`.
- **`select`** waits on `recv`/`send` arms. `_` is default. No fall-through.
- Mutex / once / wait group are **stdlib**, not syntax.
- **Scheduler is language.** Kernel runs it natively. Hosted v0: cooperative queues (`cpu`, `io`) in the interpreter. A host thread pool, if used, multiplexes those Zee queues — it must not leak (`Promise`, `goroutine`, `Thread.start`).
- Same grammar everywhere. A backend may **refuse** `task` / `on io` until it has a scheduler (capability). It may not invent `async fn` as a substitute.
- No `thread` keyword, no `pthread`, no `go` keyword.
- No data-race proof in the type system (not Rust). Shared `var` across tasks is allowed and can race; document it as a programmer rule.

### 8b. `unsafe`, pointers, `repr`, `asm`

```zee
unsafe fn poke(p: *var u8, v: u8) {
  unsafe { *p = v }
}

repr(C) struct Iovec {
  var base: *var u8
  var len: usize
}

extern "C" {
  unsafe fn strlen(s: *u8) -> usize
}

unsafe { asm("nop") }
```

- `*T` — raw pointer, read. `*var T` — raw pointer, write. Only usable in `unsafe`.
- `unsafe { }` to deref, call `unsafe fn`, `asm`, or transmute. `unsafe fn` body is an unsafe region.
- `repr(C)` / `repr(packed)` are **type modifiers** (stack with `readonly` / `data`). Layout for FFI and kernel. Default struct layout is Zee’s, not C’s.
- `extern "C"` — C ABI. `extern "host"` — hosted machine (Node/JVM) at the edge. `null` from the host becomes `Option` / `err` at the boundary. Never a Zee `null`.
- `asm("…")` — string is backend assembly. Interpreter / JVM may **refuse** (capability). Syntax stays.
- Allocators are **stdlib / kernel**, not syntax. No `malloc` keyword. `class` heap is the runtime; `struct` is a value.

### 8c. Macros, packages, backends

- **No macros**, no `#define`, no compile-time AST plugins. `zee generate` is files on disk.
- **`zee.toml`**: `[package]` + `[deps]`. `[package]` identity: required `name`; `version` (default `0.1.0`); `entry`; optional `description`, `author`, `company`, `contact`, `license`, `homepage`, `repository` (quoted strings). Prefer `{ lib = "json" }` from workspace `libs.toml`. Path/git inline still work. SemVer `json = "1.2"` is precision-based (`1.2` → latest `1.2.x`, `1.2.3` exact) via `ZEE_REGISTRY`, `[registry] url`, or `~/.zee/registry` — see [`docs/REGISTRY.md`](REGISTRY.md). Git catalog tags use the same precision (`version.ref = "1.0"` → latest `1.0.x` tag). `zee get` honors `zee.lock`; `zee update` [name...] re-resolves within the constraint and rewrites the lock (does not edit `libs.toml`). `zee publish` refuses overwrite. HTTP: `zee registry` serves `GET`/`PUT /api/v1/packages/…` (PUT needs `ZEE_REGISTRY_TOKEN`). Materialize in `.zee/`. `zee.lock` pins hashes.
- **Official libs** are GitHub packages under `zee-hq`, versioned by Git tags matching `zee.toml`. First: [`zee-hq/env`](https://github.com/zee-hq/env) (`import env`; `zee get env` via `libs.toml` `{ git, version.ref }`; `zee update env` picks a newer matching tag). Profile `ZEE_PROFILE` then `ZEE_ENV` then `.env` then `dev`; files `.env`, `.env.local`, `.env.{profile}`, `.env.{profile}.local`; process env wins. Dotenv parsing is a host overlay until Zee has string split. No `$VAR` expansion in v0. In-tree `libs/env` is the language-test fixture.
- **Tests:** `.test.zee` (`users.service.test.zee`) + `fn testFoo()`. Tooling (`zee test`), not a `test` keyword. No `foo_test.zee`, no `.spec.zee`.
- **Self-host, LLVM, WASM, JVM:** machines (§6c). Not dialects. Not open language questions.

### 8d. Explicit refusals (will not grow later “for a minute”)

| Refused | Use instead |
|---|---|
| `++` `--` | `+= 1` |
| `async` / `await` / `go` | `task cpu { }`, `on io { }`, `yield`, `Chan` |
| operator overloading | methods; `data` for `==` |
| Java inner class (`Outer.this`) | nested type (no captured outer) or pass `User` as an arg |
| anonymous class | named nested type or lambda |
| macros / preprocessor | `zee generate` |
| `StringBuilder` | `u8[]` / rebind `String` |
| `in` / `out` variance | invariant generics |
| `import x.*` | named imports |
| `null` / exceptions / `recover` | already refused |

### 8e. Host `NULL` and SQL (defined)

SQL `NULL`, JSON `null`, JDBC `wasNull`, C `NULL`, JS `null`/`undefined` are **host** absences. They stop at the driver/FFI, same as §8b: **never a Zee `null`.**

| Column | Zee field |
|---|---|
| `NOT NULL` | `T` |
| nullable | `Option<T>` |

```zee
pub struct UserRow {
  pub const id: i32                    // NOT NULL
  pub const nickname: Option<String> // NULL allowed
}

// read:  SQL NULL → None    value → Some(v)
// write: None     → NULL    Some(v) → v
```

`""` is not `NULL`. `Some("")` is an empty string; `None` is missing. `isNoneOrEmpty` is when you *mean* both. `0` is not `NULL`.

Three-valued SQL (`NULL = 1` is unknown) stays **in SQL**. After the row is typed, Zee `bool` is two-valued. `nickname == None` is a Zee test, not a SQL `IS NULL` unless the query says so.

A driver that hands Zee a host null as if it were `String` is a **bug in the driver**, not a reason to grow `null`.

## 9. Radar (not closed)

Work that the class-style Nest CRUD made unavoidable. **Not defined.** Associated factories and hand-passed fields are the v0 stand-in. Syntax here is illustrative of the *need*, not a grammar to parse.

### 9a. Constructors

v0 today:

```zee
const u = User { name: "ana", age: 1 }     // all fields, visibility applies
const p = Point.origin()                    // associated factory — the public constructor
const svc = CompanyService.empty()         // same: hide private `rows` from other modules
```

That is enough for value types. It is awkward for services:

- A `pub class` with **private** fields cannot be built from another module (`field rows is private`). The defining module must expose an associated factory.
- There is no `init` that runs after fields are filled (invariants, derived slots).
- `T(x)` is already **conversion** (`i64(n)`, `UserId(n)`). A positional `User("ana")` would look like conversion. That clash is why this is not closed.
- No `new`. That refusal stays.

**Likely shape (not decided):** keep `Name { fields }` as the only *literal*. Public construction is associated (`Type.empty()`, `Type.of(name)`), maybe plus a later **primary constructor** that is still named fields, not `new`:

```zee
// possible later — Kotlin-shaped, still no `new`
pub class UsersController(const service: UserService) {
  pub fn index(self) { … }
}

const users = UsersController(usersService)   // or still UsersController { service: usersService }?
```

**Open:**

1. Is associated `Type.of(…)` / `Type.empty()` **enough**, forever? Then §9a is “document the pattern”, not new syntax.
2. If a primary constructor exists: call is `UsersController(svc)` or still `UsersController { service: svc }`? The first collides with `T(x)` conversion.
3. `init` after fields: yes/no. If yes, it cannot fail with exceptions (`err` tuple or `panic` only).
4. Overloads: **no** (Zee has no overloading). Named associated fns (`empty`, `of`, `withCap`) instead.
5. `var self` methods on a **`const` field** of `class`: v0 requires `var service = self.service` then `service.add(…)`. Constructor/DI should not paper over this — either calling `var self` on an identity field is allowed, or the field is `var`.

### 9b. Dependency injection

v0 today: pass the dependency as a field, or a module-level `pub var usersService` (process-wide mutable state — already discouraged).

`zee generate` creates **layer file names** (controller → action → service → resource | repository → api | model). It does **not** create a container. `*.module.zee` is a comment. `main` wires by hand:

```zee
const users = users.UsersController { service: users.usersService }
const companies = companies.CompaniesController {
  service: companies.CompanyService.empty()
}
```

That is honest. It does not scale past a handful of modules.

**Wanted:** a checkable graph so a controller does not construct its service, and `main` does not list every field. Nest-shaped: module lists what it **provides** and what it **needs**. Cross-module (`companies` reads `users.UserService`) is the interesting case — import cycles stay illegal.

**Refused (will not grow later “for a minute”):**

| Refused | Why |
|---|---|
| `@Inject` / attributes / annotations | no macros, no hidden wiring |
| classpath / folder scan | modules are directories you `import`, not a scan |
| reflection container at runtime | Zee is checked; the graph should fail at **check** |
| PHP/Laravel facades / service locator | pass the object, or a generated `App` value |
| Spring XML / YAML as the graph | wiring is Zee source, or `zee generate` files |

**Likely shape (not decided):** constructor injection as the *only* injection. The module file becomes the graph (provides / imports), compiled, not a service locator you `get(UserService)` from anywhere. Scope is at least **one instance per process** for services (today’s `pub var`); per-request wait until there is HTTP.

**Open:**

1. Language feature vs **stdlib** `App` vs **`zee generate`** writing the wiring in `main` / `*.module.zee`?
2. Does `*.module.zee` grow real declarations (`provides UserService`, `import users`), or stay a convention and `main` stays the composition root?
3. Bind by **type** (`UserService`) or by **name** (`usersService`)? Type-only is Nest/Spring; Zee already has module-qualified names.
4. Interface + impl (`UserRepo` implemented by `MapUserRepo`): who chooses the impl — the module, or `main`?
5. Cycles in the **instance** graph (A needs B, B needs A) — import cycles are already errors; instance cycles need a rule (`lazy`, forbid, or two-phase init).
6. Mutating a injected `const` service field (`var self` on the dependency) — same as §9a Q5.

### 9c. Collection methods

v0 today: **`List<T>`** has `map` / `filter` / `forEach`. `T[]` has `toList`. `List` has `toArray`. `Map` and `T[]` walk only with `for`.

Lambda spelling is already **Kotlin** (`{ a, b -> … }`, trailing). Not JS `(id, company) -> { … }`.

`for x in xs` / `for (k, v) in m` stay.

**Catalog (wanted).** `List` never mutates in place — those rows return a new `List`. Mutating rows need `var` `T[]` / `var` `Map`.

| Method | Meaning | `List<T>` | `T[]` | `Map<K, V>` |
|---|---|---|---|---|
| `each` | walk, `Unit` | alias/`forEach` already | yes | `{ K, V -> }` |
| `map` | transform | **in** | yes | `{ K, V -> U }` → `List<U>`? |
| `filter` | keep if true | **in** | yes | `{ K, V -> bool }` |
| `unique` | drop duplicates (`T: Eq`) | new `List` | copy or in-place? | keys already unique |
| `flat` | one level flatten | `List<List<T>>` → `List<T>` | `T[][]` → `T[]` | no |
| `find` | first match → `Option<T>` | yes | yes | `{ K, V -> bool }` → `Option<(K, V)>` |
| `some` | any match → `bool` | yes | yes | yes |
| `all` | every match → `bool` | yes | yes | yes |
| `first` / `last` | ends → `Option<T>` | yes | yes | no (not ordered) |
| `contains` | `T: Eq` → `bool` | yes | yes | key? or value? |
| `join` | `List<String>` → `String` | yes | yes | no |
| `toString` | debug dump | yes | yes | yes |
| `push` | add at **end** | new `List` or no | **`var`**, grows | no |
| `pop` | take last → `Option<T>` | new `List` + value, or no | **`var`**, shrinks | no |
| `fill` | write every slot | no (immutable) | **`var`** | no |
| `merge` | concat / putAll | `+` or `merge` → new `List` | `var` grow or new | `var` putAll (right wins) |
| `keys` / `values` | project | no | no | `List<K>` / `List<V>` |
| `slice` / `take` / `drop` | window | new `List` | copy | no |
| `reverse` | reverse order | new `List` | `var` or copy | no |
| `sort` | `T: Ord` | new `List` | `var` or copy | no |

**`push` is the opposite of `pop`** (add vs remove at the end). `shift` / `unshift` (front) are **not** in this catalog unless we need a deque later.

**Refused:**

| Refused | Why |
|---|---|
| `(x) -> { }` as a second lambda | `{ a, b -> … }` (§1) |
| PHP `foreach` / JS `for…of` keywords | `for in` exists |
| LINQ query syntax | methods + lambdas |
| mutating `each` that resizes under the callback | iterator is not the owner |
| `pop`/`push`/`fill` on `List` in place | `List` is immutable |
| `some` as a second name next to `any` | pick **one** (JS `some` vs Kotlin `any`) |

**Open:**

1. `each` vs `forEach` (already on `List`) — one name.
2. `some` vs `any` — same method, JS vs Kotlin. Pair is `all`.
3. `map` on `Map`: `List<U>` vs `mapValues` → `Map<K, U>` (no overloading → two names if both).
4. `toString` vs extending `str()` (today `str` is integer/`bool` only). Debug dump should not pretend to be `Eq`.
5. `unique` order: first-seen vs sorted. Needs `Eq`; `Hash` would be faster.
6. `flat` depth: one level only (no recursive `flat(n)`).
7. `merge` name vs `+` on `List` / `T[]`. Map right-hand wins on duplicate keys.
8. `pop` return: `Option<T>` (empty is `None`) — no panic, no dummy.
9. `slice` vs `take`/`drop` — one window API, not both styles.
10. `find` / `any` / `all` / `fold` extras (`count`, `zip`, `groupBy`, `flatMap`, `min`/`max`) wait until this table is in the interpreter.

### 9d. Checker holes the demo hit — **in the interpreter** (ZEE-7)

Not new grammar. Was a check-order bug:

- Imported types work in signatures and fields (`import users.UserService` + `const service: UserService`).
- `import users.usersService` resolves a `pub var` (module graph: exporter binds, then importer).
- Methods are names **on the type**, not the module: `UserService.create` and `UsersController.create` coexist. Call is `svc.create()`, not a free `create`.

### 9e. Emptiness, blank, none (Kotlin predicates)

v0 today: `xs.len == 0`, `s.len == 0`, `x == None` / `x != None`. No truthiness (`if xs` is illegal). No `null`.

Kotlin’s set, mapped onto Zee:

| Kotlin | Zee | On |
|---|---|---|
| `isEmpty()` | `isEmpty()` | `String`, `List`, `T[]`, `Map` |
| `isNotEmpty()` | `isNotEmpty()` | same |
| `isBlank()` | `isBlank()` | `String` only — empty or only whitespace `Char`s |
| `isNotBlank()` | `isNotBlank()` | `String` |
| `isNullOrEmpty()` | `isNoneOrEmpty()` | `Option<String>` / `Option<List<T>>` / `Option<T[]>` / `Option<Map<K,V>>` |
| `isNullOrBlank()` | `isNoneOrBlank()` | `Option<String>` |
| `== null` | `isNone()` or `x == None` | `Option<T>` |
| `!= null` | `isSome()` or `x != None` | `Option<T>` |

Negated versions are **named methods**, not `!` only — same as Kotlin (`isNotEmpty`, not only `!isEmpty`). `!` still works on the `bool` they return.

**Why not `empty()`:** `Type.empty()` is already the associated factory (`CompanyService.empty()`). Predicate is `isEmpty` so the two do not share a name. `null` is not a method and not a value.

```zee
if name.isBlank() { return }
if xs.isNoneOrEmpty() { return }     // Option<List<T>>: None or Some([])
if err != None { return ("", err) } // Go slot stays; isSome() is sugar
```

**Refused:**

| Refused | Why |
|---|---|
| `null` / `isNull()` | no `null`; absence is `None` |
| `if xs` / PHP empty() truthiness | `cond` is `bool` |
| `isBlank` on `List` / `Map` | blank is a **string** idea |
| treating `Some("  ")` as `None` | `isNoneOrBlank` is explicit; `?:` does not trim |

**Open:**

1. `isEmpty` vs `empty` as the user spelled it — factory collision decides **`is*`**.
2. Whitespace: Unicode `Char` whitespace (Kotlin) vs ASCII only (` `, `\t`, `\n`, `\r`).
3. `isNone`/`isSome` vs only `== None` — sugar or skip?
4. `isNoneOrEmpty` on `Option<T>` when `T` is not a collection/`String` — only the four types above, or a bound later?
5. Byte-empty `String` (`len == 0`) vs scalar-empty — same for UTF-8 well-formed empty.

---

## 10. After definition

Next work is **implementation** (§6 order), not more syntax — except §9, which must be **decided in this file** before anyone parses it. A backend may lag (`asm` on Node, `task` before a scheduler). It may not invent a second grammar.

