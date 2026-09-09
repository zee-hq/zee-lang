# Zee

**A strongly typed language.** Interpreter, REPL, and editor live here. The future OS is [`zee-os`](https://github.com/zethsell/zee-os).

[![test](https://github.com/zethsell/zee-lang/actions/workflows/test.yml/badge.svg)](https://github.com/zethsell/zee-lang/actions/workflows/test.yml)

Zee is a small systems language with **no implicit conversions**, **no null**, and a single syntax for every environment. v0 is a tree-walking interpreter. The compiler, WASM, and a freestanding kernel subset come later — they do not start until this interpreter is boringly solid.

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
| Interpreter + REPL | done |
| Editor (VS Code / Cursor) | syntax + Run File |
| Bytecode / LLVM / OS kernel | not here — see [`zee-os`](https://github.com/zethsell/zee-os) |

This is research software. The grammar will change.

## Quick start

Requires **Node 22+**.

```bash
git clone git@github.com:zethsell/zee-lang.git
cd zee-lang
npm install
npm test
npx tsx src/cli.ts run examples/hello.zee
npx tsx src/cli.ts            # REPL
```

Install the CLI on your `PATH`:

```bash
npm link
zee run examples/factorial.zee
zee check examples/greet.zee
```

```
zee> let x = 40
zee> fn add(a: i32, b: i32) -> i32 { a + b }
zee> add(x, 2)
42
```

## Language (v0)

**Types:** `i32`, `bool`, `String`, `Unit`, `fn(...) -> T`.

**Bindings:** `let` is immutable. The type may be written or inferred from the initializer — never from “whatever would make this compile”.

**Functions:** parameters are always annotated. The return type defaults to `Unit`. A trailing expression is the return value (Rust-style).

**Control flow:** `if` is an expression. Using it as a value requires `else` and matching branch types.

**Builtins:** `print`, `println` (`i32 | bool | String`), `str(i32 | bool) -> String`.

What the checker **refuses**:

```zee
1 + "zee"           // error: `+` is not defined for i32 and String
if true { 1 }       // error: if expression is missing `else`
let n: i32 = "1"    // error: cannot assign String to n: i32
```

`+` on two strings is concatenation, not coercion. `+` on two `i32`s is addition. Mixing them is a type error.

### Grammar (subset)

```
program     = statement*
statement   = fn | let | return | expression
fn          = "fn" ident "(" params? ")" ("->" type)? block
let         = "let" ident (":" type)? "=" expression
if          = "if" expression block ("else" (if | block))?
type        = "i32" | "bool" | "String" | "Unit"
```

See `examples/` for programs that actually run.

## Editor

The VS Code / Cursor extension is in [`editor/vscode`](editor/vscode). It highlights `.zee` files and adds **Zee: Run File**.

```bash
mkdir -p ~/.cursor/extensions
ln -sfn "$(pwd)/editor/vscode" ~/.cursor/extensions/zethsell.zee-0.1.0
```

Reload the window, open `examples/hello.zee`, run **Zee: Run File**.

## Design constraints

These exist because Zee is meant to grow into a language that can host its own OS:

1. **One language, several environments** — not dialects. Missing capabilities fail at type-check time, not in production.
2. **Strong and static.** No `null`. No implicit casts. Local inference only.
3. **The interpreter is a bootstrap.** It is written in TypeScript so we can move fast on syntax and types. A self-hosted / native compiler is a later milestone, not a v0 goal.
4. **Kernel profile comes after.** Freestanding Zee (`zee:kernel`: no hidden alloc, `repr(C)`, `asm`) belongs with [`zee-os`](https://github.com/zethsell/zee-os). This repo stays hosted: editor + interpreter.

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
| `zee run <file>` | interpret a program |
| `zee check <file>` | type-check only |
| `zee` | REPL |

## License

MIT. See [LICENSE](LICENSE).

---

### Português

Zee é uma linguagem **fortemente tipada**. Este repositório tem o **interpretador**, o **REPL** e o **editor**. O sistema operacional fica em [zee-os](https://github.com/zethsell/zee-os) e ainda não é o foco.

```bash
npm install && npm test
npx tsx src/cli.ts run examples/hello.zee
```
