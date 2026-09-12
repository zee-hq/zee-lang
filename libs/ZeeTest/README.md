# ZeeTest

Official Zee test runner. `zee test` injects this package and calls `ZeeTest.run()`.

```bash
zee get ZeeTest
zee get env
```

Workspace `libs.toml` is still an overlay (path deps, private git, pin a different tag). Official names live in [catalog.json](https://github.com/zee-hq/zee-lang/blob/main/catalog.json).

`zee test` already injects ZeeTest — you only need the dep if you want to call `ZeeTest.run()` yourself.

```zee
import ZeeTest

fn main() -> i32 {
  ZeeTest.run()
}
```

```zee
describe("math") {
  fn testAdd() {
    expect(1 + 1).toBe(2)
  }
}
```

Cases are `fn test*` in `*.test.zee` (`users.service.test.zee`, not `foo_test.zee` or `.spec.zee`). `describe("title") { }` is a closure: inner `fn` get that env. Nested `describe` nests label + env. Sequential `describe("title")` labels following file-level cases. Lifecycle: `fn beforeAll()` / `fn beforeEach()` / `fn afterEach()` / `fn afterAll()`.

Assertions: `expect(x).toBe(y)` / `toEqual` / `.not` (panic on mismatch; Eq values only). No `test` keyword. No `it()` test helper — Zee `it` is the lambda parameter.

Releases are Git tags matching `[package] version` in `zee.toml` (`0.1.0`, not `v0.1.0`). Host builtins `testCases` / `testCall` / `expect` / `describe` live in [zee-lang](https://github.com/zee-hq/zee-lang). In-tree fixture: [`libs/ZeeTest`](https://github.com/zee-hq/zee-lang/tree/main/libs/ZeeTest).
