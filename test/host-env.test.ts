import { describe, expect, it } from 'vitest'
import { loadHostEnv, lookupEnv, parseDotenv } from '../src/host-env.ts'

describe('parseDotenv (AC-env-parse)', () => {
  it('skips blanks, comments, and export; strips quotes and unquoted inline comments', () => {
    const parsed = parseDotenv(`
# ignore
export NAME=zee
PORT = 3000
QUOTED="hello # still"
HASH=plain # gone
EMPTY=""
`)
    expect(parsed.get('NAME')).toBe('zee')
    expect(parsed.get('PORT')).toBe('3000')
    expect(parsed.get('QUOTED')).toBe('hello # still')
    expect(parsed.get('HASH')).toBe('plain')
    expect(parsed.get('EMPTY')).toBe('')
  })
})

describe('loadHostEnv profile overlay (AC-env-profile)', () => {
  function files(map: Record<string, string>) {
    return {
      processEnv: {} as NodeJS.Dict<string>,
      readText: (path: string) => map[path],
    }
  }

  it('defaults to dev and later files override earlier ones', () => {
    const loaded = loadHostEnv('/app', {
      ...files({
        '/app/.env': 'PORT=1\nNAME=base\n',
        '/app/.env.local': 'PORT=2\n',
        '/app/.env.dev': 'PORT=3\n',
        '/app/.env.dev.local': 'PORT=4\n',
      }),
    })
    expect(loaded.profile).toBe('dev')
    expect(loaded.overlay.get('PORT')).toBe('4')
    expect(loaded.overlay.get('NAME')).toBe('base')
  })

  it('takes profile from process ZEE_PROFILE, then ZEE_ENV, then .env', () => {
    const fromProcess = loadHostEnv('/app', {
      processEnv: { ZEE_PROFILE: 'prod', ZEE_ENV: 'ignored' },
      readText: (path) =>
        ({
          '/app/.env': 'PORT=1\n',
          '/app/.env.prod': 'PORT=9\n',
        })[path],
    })
    expect(fromProcess.profile).toBe('prod')
    expect(fromProcess.overlay.get('PORT')).toBe('9')

    const fromEnvAlias = loadHostEnv('/app', {
      processEnv: { ZEE_ENV: 'prod' },
      readText: (path) =>
        ({
          '/app/.env': 'PORT=1\n',
          '/app/.env.prod': 'PORT=8\n',
        })[path],
    })
    expect(fromEnvAlias.profile).toBe('prod')
    expect(fromEnvAlias.overlay.get('PORT')).toBe('8')

    const fromFile = loadHostEnv('/app', {
      processEnv: {},
      readText: (path) =>
        ({
          '/app/.env': 'ZEE_PROFILE=staging\nPORT=1\n',
          '/app/.env.staging': 'PORT=7\n',
        })[path],
    })
    expect(fromFile.profile).toBe('staging')
    expect(fromFile.overlay.get('PORT')).toBe('7')
  })

  it('ignores a process profile that is not a safe file suffix', () => {
    const loaded = loadHostEnv('/app', {
      processEnv: { ZEE_PROFILE: '../etc' },
      readText: (path) =>
        ({
          '/app/.env': 'PORT=1\n',
          '/app/.env.dev': 'PORT=2\n',
        })[path],
    })
    expect(loaded.profile).toBe('dev')
    expect(loaded.overlay.get('PORT')).toBe('2')
  })

  it('lets process env win over overlay (AC-env-process-wins)', () => {
    const loaded = loadHostEnv('/app', {
      processEnv: { PORT: '9999' },
      readText: () => 'PORT=3000\n',
    })
    expect(lookupEnv('PORT', loaded, { PORT: '9999' })).toBe('9999')
    expect(lookupEnv('PORT', loaded, {})).toBe(loaded.overlay.get('PORT'))
    expect(lookupEnv('MISSING', loaded, {})).toBeUndefined()
  })

  it('reads [package] identity from zee.toml (AC-env-app)', () => {
    const loaded = loadHostEnv('/app', {
      processEnv: {},
      readText: (path) =>
        ({
          '/app/zee.toml': `[package]
name = "hello"
version = "1.4.2"
description = "demo app"
author = "Ada"
company = "Zee HQ"
contact = "ada@zee.dev"
license = "MIT"
homepage = "https://zee.dev"
repository = "https://github.com/zee-hq/hello"
`,
        })[path],
    })
    expect(loaded.app.get('name')).toBe('hello')
    expect(loaded.app.get('version')).toBe('1.4.2')
    expect(loaded.app.get('description')).toBe('demo app')
    expect(loaded.app.get('author')).toBe('Ada')
    expect(loaded.app.get('company')).toBe('Zee HQ')
    expect(loaded.app.get('contact')).toBe('ada@zee.dev')
    expect(loaded.app.get('license')).toBe('MIT')
    expect(loaded.app.get('homepage')).toBe('https://zee.dev')
    expect(loaded.app.get('repository')).toBe('https://github.com/zee-hq/hello')
  })
})
