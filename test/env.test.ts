import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { PanicError } from '../src/error.ts'
import { createProject } from '../src/project.ts'
import { execute, executePath } from '../src/zee.ts'

const temps: string[] = []
const ENV_LIB = join(fileURLToPath(new URL('.', import.meta.url)), '../libs/env')

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zee-env-'))
  temps.push(dir)
  return dir
}

function write(root: string, rel: string, source: string): void {
  const full = join(root, rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, source)
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('getenv builtin (AC-env-getenv)', () => {
  it('returns Some from process env and None when absent', () => {
    expect(execute('getenv("ZEE_TEST_KEY")', { processEnv: { ZEE_TEST_KEY: 'ok' } }).value).toEqual({
      type: 'option',
      tag: 'some',
      value: { type: 'string', value: 'ok' },
    })
    expect(execute('getenv("ZEE_TEST_ABSENT")', { processEnv: {} }).value).toEqual({
      type: 'option',
      tag: 'none',
    })
  })
})

describe('official env package (AC-env-lib)', () => {
  function appWithEnv(): string {
    const parent = scratch()
    const app = createProject({ name: 'app', parentDir: parent, mode: 'new' })
    write(
      app.root,
      'zee.toml',
      `[package]\nname = "app"\nversion = "0.1.0"\nentry = "src/main.zee"\n\n[deps]\nenv = { path = "${ENV_LIB}" }\n`,
    )
    return app.root
  }

  it('reads overlay files next to zee.toml and lets process env win', () => {
    const root = appWithEnv()
    write(root, '.env', 'APP_NAME=from-env\nPORT=3000\n')
    write(root, '.env.prod', 'PORT=8080\n')
    write(
      root,
      'src/main.zee',
      `import env
fn main() {
  println(env.profile())
  println(env.require("APP_NAME"))
  println(env.require("PORT"))
  println(env.getOr("MISSING", "fallback"))
}
`,
    )
    expect(executePath(join(root, 'src/main.zee'), { processEnv: { ZEE_PROFILE: 'prod' } }).stdout).toBe(
      'prod\nfrom-env\n8080\nfallback\n',
    )
    expect(
      executePath(join(root, 'src/main.zee'), { processEnv: { ZEE_PROFILE: 'prod', PORT: '9999' } }).stdout,
    ).toBe('prod\nfrom-env\n9999\nfallback\n')
  })

  it('panics from require when the key is missing', () => {
    const root = appWithEnv()
    write(
      root,
      'src/main.zee',
      `import env
fn main() {
  println(env.require("NOPE"))
}
`,
    )
    expect(() => executePath(join(root, 'src/main.zee'), { processEnv: {} })).toThrow(PanicError)
    expect(() => executePath(join(root, 'src/main.zee'), { processEnv: {} })).toThrow(/missing env NOPE/)
  })

  it('returns [package] identity from zee.toml (AC-env-app)', () => {
    const parent = scratch()
    const app = createProject({ name: 'hello', parentDir: parent, mode: 'new' })
    write(
      app.root,
      'zee.toml',
      `[package]
name = "hello"
version = "1.4.2"
description = "demo app"
author = "Ada"
company = "Zee HQ"
contact = "ada@zee.dev"
license = "MIT"
homepage = "https://zee.dev"
repository = "https://github.com/zee-hq/hello"
entry = "src/main.zee"

[deps]
env = { path = "${ENV_LIB}" }
`,
    )
    write(
      app.root,
      'src/main.zee',
      `import env
fn main() {
  println(env.appName())
  println(env.appVersion())
  println(env.appDescription() ?: "")
  println(env.appAuthor() ?: "")
  println(env.appCompany() ?: "")
  println(env.appContact() ?: "")
  println(env.appLicense() ?: "")
  println(env.appHomepage() ?: "")
  println(env.appRepository() ?: "")
  println(env.app("author") ?: "")
}
`,
    )
    expect(executePath(join(app.root, 'src/main.zee'), { processEnv: {} }).stdout).toBe(
      'hello\n1.4.2\ndemo app\nAda\nZee HQ\nada@zee.dev\nMIT\nhttps://zee.dev\nhttps://github.com/zee-hq/hello\nAda\n',
    )
  })
})
