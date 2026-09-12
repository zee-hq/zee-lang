import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runPackageTests } from '../src/zee.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '../examples/shop-api')

describe('examples/shop-api HTTP with package-owned @Get (AC-http-example)', () => {
  it('passes package tests for dispatch, resource verbs, and domain rules', () => {
    const result = runPackageTests(root)
    expect(result.failed).toBe(0)
    expect(result.exitCode).toBe(0)
    expect(result.reports.some((item) => item.name === 'testHealth')).toBe(true)
    expect(result.reports.some((item) => item.name === 'testCorsLocalhost')).toBe(true)
    expect(result.reports.some((item) => item.name === 'testStoreThenShow')).toBe(true)
    expect(result.reports.some((item) => item.name === 'testPatchActiveThenShow')).toBe(true)
    expect(existsSync(join(root, 'src/bootstrap/main.zee'))).toBe(true)
    expect(existsSync(join(root, 'src/modules/application/health.controller.zee'))).toBe(true)
    expect(existsSync(join(root, 'test/modules/users/users.service.test.zee'))).toBe(true)
    expect(existsSync(join(root, 'src/modules/users'))).toBe(true)
    expect(existsSync(join(root, 'src/main.zee'))).toBe(false)
  })
})
