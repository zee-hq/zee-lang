import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createProject } from '../src/project.ts'
import { executePath, runPackageTests } from '../src/zee.ts'

const temps: string[] = []
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const TEST_LIB = join(repoRoot, 'libs/ZeeTest')
const require = createRequire(import.meta.url)
const tsx = require.resolve('tsx/cli')

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zee-test-cli-'))
  temps.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function write(root: string, rel: string, source: string): void {
  const full = join(root, rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, source)
}

/** Library package: `src/lib.zee`, no `main`. */
function writeLib(): string {
  const root = join(scratch(), 'mathlib')
  mkdirSync(join(root, 'src'), { recursive: true })
  write(
    root,
    'zee.toml',
    `[package]\nname = "mathlib"\nversion = "0.1.0"\nentry = "src/lib.zee"\n`,
  )
  write(root, 'src/lib.zee', `internal fn add(a: i32, b: i32) -> i32 { a + b }\n`)
  write(
    root,
    'src/lib.test.zee',
    `
fn testAdd() {
  if add(1, 2) != 3 { panic("add") }
}

fn testErr() -> Option<Error> {
  Some(error("nope"))
}
`,
  )
  write(root, 'src/lib_test.zee', `fn notDiscovered() { panic("should not run") }\n`)
  write(root, 'src/lib.spec.zee', `fn alsoNotDiscovered() { panic("should not run") }\n`)
  return root
}

describe('zee test (ZEE-12)', () => {
  it('runs fn test* in a library package and ignores foo_test.zee / .spec.zee', () => {
    const root = writeLib()
    const result = runPackageTests(root)
    expect(result.reports.map((item) => item.name).sort()).toEqual(['testAdd', 'testErr'])
    expect(result.reports.find((item) => item.name === 'testAdd')?.ok).toBe(true)
    expect(result.reports.find((item) => item.name === 'testErr')?.ok).toBe(false)
    expect(result.failed).toBe(1)
    expect(result.passed).toBe(1)
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toMatch(/testAdd/)
    expect(result.stdout).toMatch(/testErr/)
    expect(result.stdout).not.toMatch(/notDiscovered/)
  })

  it('fails a test that panics and returns exit code 1', () => {
    const root = writeLib()
    write(root, 'src/lib.test.zee', `fn testBoom() { panic("nope") }\n`)
    const result = runPackageTests(root)
    expect(result.exitCode).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.stdout).toMatch(/panic: nope/)
  })

  it('passes when every fn test* succeeds', () => {
    const root = writeLib()
    write(root, 'src/lib.test.zee', `fn testOk() {}\n`)
    const result = runPackageTests(root)
    expect(result.exitCode).toBe(0)
    expect(result.passed).toBe(1)
    expect(result.failed).toBe(0)
  })

  it('is an importable library: import ZeeTest and ZeeTest.run()', () => {
    const app = createProject({ name: 'app', parentDir: scratch(), mode: 'new' }).root
    write(
      app,
      'zee.toml',
      `[package]\nname = "app"\nversion = "0.1.0"\nentry = "src/main.zee"\n\n[deps]\nZeeTest = { path = "${TEST_LIB}" }\n`,
    )
    write(app, 'src/ok.test.zee', `fn testOk() {}\n`)
    write(
      app,
      'src/main.zee',
      `import ZeeTest
fn main() -> i32 {
  ZeeTest.run()
}
`,
    )
    const result = executePath(join(app, 'src/main.zee'))
    expect(result.stdout).toMatch(/testOk/)
    expect(result.stdout).toMatch(/Tests/)
    expect(result.stdout).toMatch(/1 passed/)
    expect(result.exitCode).toBe(0)
  })

  it('runs via the zee test CLI in a library package', () => {
    const root = writeLib()
    write(root, 'src/lib.test.zee', `fn testOk() {}\n`)
    const stdout = execFileSync(process.execPath, [tsx, join(repoRoot, 'src/cli.ts'), 'test'], {
      cwd: root,
      encoding: 'utf8',
    })
    expect(stdout).toMatch(/testOk/)
    expect(stdout).toMatch(/Test Files/)
    expect(stdout).toMatch(/1 passed/)
  })

  it('runs the example users.model.test.zee', () => {
    const root = join(scratch(), 'users')
    mkdirSync(join(root, 'src'), { recursive: true })
    write(root, 'zee.toml', `[package]\nname = "users"\nversion = "0.1.0"\nentry = "src/lib.zee"\n`)
    write(root, 'src/lib.zee', '')
    write(root, 'src/users.model.zee', readFileSync(join(repoRoot, 'examples/users.model.zee'), 'utf8'))
    write(
      root,
      'src/users.model.test.zee',
      readFileSync(join(repoRoot, 'examples/users.model.test.zee'), 'utf8'),
    )
    const result = runPackageTests(root)
    expect(result.exitCode).toBe(0)
    expect(result.reports.map((item) => item.name)).toEqual(['testRow'])
    expect(result.passed).toBe(1)
    expect(result.stdout).toMatch(/UserRow > testRow/)
  })

  it('runs the example users.controller.test.zee with nested hooks', () => {
    const root = join(scratch(), 'users')
    mkdirSync(join(root, 'src'), { recursive: true })
    write(root, 'zee.toml', `[package]\nname = "users"\nversion = "0.1.0"\nentry = "src/lib.zee"\n`)
    write(root, 'src/lib.zee', '')
    write(root, 'src/users.model.zee', readFileSync(join(repoRoot, 'examples/users.model.zee'), 'utf8'))
    write(
      root,
      'src/users.controller.zee',
      readFileSync(join(repoRoot, 'examples/users.controller.zee'), 'utf8'),
    )
    write(
      root,
      'src/users.controller.test.zee',
      readFileSync(join(repoRoot, 'examples/users.controller.test.zee'), 'utf8'),
    )
    const result = runPackageTests(root)
    expect(result.exitCode).toBe(0)
    expect(result.reports.map((item) => item.name)).toEqual([
      'testFirstPage',
      'testSecondPage',
      'testFindsAda',
      'testKeepsCatalog',
    ])
    expect(result.passed).toBe(4)
    expect(result.stdout).toMatch(/userController > userList > testFirstPage/)
    expect(result.stdout).toMatch(/userController > userList > testSecondPage/)
    expect(result.stdout).toMatch(/userController > userShow > testFindsAda/)
    expect(result.stdout).toMatch(/userController > userShow > testKeepsCatalog/)
  })

  it('groups following fn test* under describe("title")', () => {
    const root = writeLib()
    write(
      root,
      'src/lib.test.zee',
      `
describe("math")

fn testAdd() {}

describe("err")

fn testErr() {}
`,
    )
    const result = runPackageTests(root)
    expect(result.exitCode).toBe(0)
    expect(result.reports.map((item) => item.name)).toEqual(['testAdd', 'testErr'])
    expect(result.stdout).toMatch(/math > testAdd/)
    expect(result.stdout).toMatch(/err > testErr/)
    expect(result.stdout).not.toMatch(/math > testErr/)
  })

  it('leaves tests before describe ungrouped', () => {
    const root = writeLib()
    write(
      root,
      'src/lib.test.zee',
      `
fn testBare() {}

describe("grouped")

fn testNamed() {}
`,
    )
    const result = runPackageTests(root)
    expect(result.stdout).toMatch(/  testBare/)
    expect(result.stdout).toMatch(/grouped > testNamed/)
    expect(result.stdout).not.toMatch(/> testBare/)
  })

  it('nests describe("title") { fn test* } as suite > name', () => {
    const root = writeLib()
    write(
      root,
      'src/lib.test.zee',
      `
describe("userController") {
  describe("userList") {
    fn testIndex() {}
  }
  describe("userShow") {
    fn testFind() {}
  }
}
`,
    )
    const result = runPackageTests(root)
    expect(result.exitCode).toBe(0)
    expect(result.reports.map((item) => item.name)).toEqual(['testIndex', 'testFind'])
    expect(result.stdout).toMatch(/userController > userList > testIndex/)
    expect(result.stdout).toMatch(/userController > userShow > testFind/)
  })

  it('allows the same fn test name in two describe blocks', () => {
    const root = writeLib()
    write(
      root,
      'src/lib.test.zee',
      `
describe("a") {
  fn testWorks() {}
}
describe("b") {
  fn testWorks() {}
}
`,
    )
    const result = runPackageTests(root)
    expect(result.exitCode).toBe(0)
    expect(result.passed).toBe(2)
    expect(result.stdout).toMatch(/a > testWorks/)
    expect(result.stdout).toMatch(/b > testWorks/)
  })

  it('closes describe { } over a local var that beforeEach injects into tests', () => {
    const root = writeLib()
    write(
      root,
      'src/lib.test.zee',
      `
describe("math") {
  var n = 0

  fn beforeEach() {
    n = n + 1
  }

  fn testSeesN() {
    expect(n).toBe(1)
  }

  fn testSeesNAgain() {
    expect(n).toBe(2)
  }
}
`,
    )
    const result = runPackageTests(root)
    expect(result.exitCode).toBe(0)
    expect(result.passed).toBe(2)
  })

  it('keeps describe closures isolated', () => {
    const root = writeLib()
    write(
      root,
      'src/lib.test.zee',
      `
describe("a") {
  var n = 1
  fn testA() { expect(n).toBe(1) }
}

describe("b") {
  var n = 2
  fn testB() { expect(n).toBe(2) }
}
`,
    )
    const result = runPackageTests(root)
    expect(result.exitCode).toBe(0)
    expect(result.passed).toBe(2)
  })

  it('runs beforeAll once, beforeEach/afterEach per test, afterAll once', () => {
    const root = writeLib()
    write(
      root,
      'src/lib.test.zee',
      `
fn beforeAll() { println("all") }
fn beforeEach() { println("each") }
fn afterEach() { println("after-each") }
fn afterAll() { println("after-all") }

fn testA() { println("a") }
fn testB() { println("b") }
`,
    )
    const result = runPackageTests(root)
    expect(result.exitCode).toBe(0)
    expect(result.reports.map((item) => item.name)).toEqual(['testA', 'testB'])
    expect(result.stdout).not.toMatch(/\bbeforeEach\b/)
    expect(result.stdout).not.toMatch(/\bbeforeAll\b/)
    const markers = result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => ['all', 'each', 'a', 'b', 'after-each', 'after-all'].includes(line))
    expect(markers).toEqual(['all', 'each', 'a', 'after-each', 'each', 'b', 'after-each', 'after-all'])
  })

  it('lets fn beforeEach assign a file-level var that tests read', () => {
    const root = writeLib()
    write(
      root,
      'src/lib.test.zee',
      `
var n = 0

fn beforeAll() { n = 10 }
fn beforeEach() { n = n + 1 }
fn afterEach() { n = n - 1 }

fn testA() { expect(n).toBe(11) }
fn testB() { expect(n).toBe(11) }
`,
    )
    const result = runPackageTests(root)
    expect(result.exitCode).toBe(0)
    expect(result.passed).toBe(2)
  })

  it('does not run another file\'s hooks', () => {
    const root = writeLib()
    write(
      root,
      'src/lib.test.zee',
      `
fn beforeEach() { println("hook-lib") }
fn testLib() { println("test-lib") }
`,
    )
    write(
      root,
      'src/other.test.zee',
      `
fn beforeEach() { println("hook-other") }
fn testOther() { println("test-other") }
`,
    )
    const result = runPackageTests(root)
    expect(result.exitCode).toBe(0)
    const markers = result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('hook-') || line.startsWith('test-'))
    expect(markers.filter((line) => line === 'hook-lib')).toHaveLength(1)
    expect(markers.filter((line) => line === 'hook-other')).toHaveLength(1)
    const libAt = markers.indexOf('hook-lib')
    const otherAt = markers.indexOf('hook-other')
    expect(markers[libAt + 1]).toBe('test-lib')
    expect(markers[otherAt + 1]).toBe('test-other')
  })

  it('still runs afterEach and afterAll when a test panics', () => {
    const root = writeLib()
    write(
      root,
      'src/lib.test.zee',
      `
fn afterEach() { println("after-each") }
fn afterAll() { println("after-all") }
fn testBoom() { panic("nope") }
`,
    )
    const result = runPackageTests(root)
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toMatch(/after-each/)
    expect(result.stdout).toMatch(/after-all/)
    expect(result.stdout).toMatch(/panic: nope/)
  })

  it('fails the test when beforeEach panics and still runs afterEach', () => {
    const root = writeLib()
    write(
      root,
      'src/lib.test.zee',
      `
fn beforeEach() { panic("setup") }
fn afterEach() { println("after-each") }
fn testOk() { println("should-not-run") }
`,
    )
    const result = runPackageTests(root)
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toMatch(/beforeEach: panic: setup/)
    expect(result.stdout).toMatch(/after-each/)
    expect(result.stdout).not.toMatch(/should-not-run/)
  })

  it('skips remaining tests when beforeAll panics and still runs afterAll', () => {
    const root = writeLib()
    write(
      root,
      'src/lib.test.zee',
      `
fn beforeAll() { panic("once") }
fn beforeEach() { println("each") }
fn afterEach() { println("after-each") }
fn afterAll() { println("after-all") }
fn testA() { println("a") }
fn testB() { println("b") }
`,
    )
    const result = runPackageTests(root)
    expect(result.exitCode).toBe(1)
    expect(result.failed).toBe(2)
    expect(result.stdout).toMatch(/beforeAll: panic: once/)
    expect(result.stdout).toMatch(/after-all/)
    expect(result.stdout).not.toMatch(/^each$/m)
    expect(result.stdout).not.toMatch(/^a$/m)
    expect(result.stdout).not.toMatch(/^b$/m)
  })

  it('rejects a hook that takes parameters', () => {
    const root = writeLib()
    write(
      root,
      'src/lib.test.zee',
      `
fn beforeEach(n: i32) {}
fn testOk() {}
`,
    )
    expect(() => runPackageTests(root)).toThrow(/beforeEach/)
  })

  it('runs nested beforeEach only for tests in that describe', () => {
    const root = writeLib()
    write(
      root,
      'src/lib.test.zee',
      `
fn beforeEach() { println("file-each") }

describe("userController") {
  fn beforeEach() { println("ctrl-each") }

  describe("userList") {
    fn testIndex() { println("index") }
  }
}

fn testBare() { println("bare") }
`,
    )
    const result = runPackageTests(root)
    expect(result.exitCode).toBe(0)
    const markers = result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => ['file-each', 'ctrl-each', 'index', 'bare'].includes(line))
    expect(markers).toEqual(['file-each', 'ctrl-each', 'index', 'file-each', 'bare'])
  })
})

