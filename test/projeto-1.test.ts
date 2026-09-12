import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { executePath, runPackageTests } from '../src/zee.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '../examples/projeto-1')
const entry = join(root, 'src/main.zee')

describe('examples/projeto-1 CRUD (AC-example-crud)', () => {
  it('walks index store show update destroy through the HTTP slice', () => {
    expect(executePath(entry).stdout).toBe(
      [
        'index: []',
        'store ada: {"id":1,"name":"ada"}',
        'store grace: {"id":2,"name":"grace"}',
        'index: [{"id":1,"name":"ada"},{"id":2,"name":"grace"}]',
        'show 1: {"id":1,"name":"ada"}',
        'update 1 ana: {"id":1,"name":"ana"}',
        'destroy 2: ok',
        'index: [{"id":1,"name":"ana"}]',
        'show 2: not found',
        'store blank: name is blank',
        'orders index: []',
        'orders store user1 keyboard: {"id":1,"userId":1,"title":"keyboard"}',
        'orders store user2 mouse: user not found',
        'orders store blank: title is blank',
        'orders show 1: {"id":1,"userId":1,"title":"keyboard"}',
        'orders update 1 mouse: {"id":1,"userId":1,"title":"mouse"}',
        'orders destroy 1: ok',
        'orders index: []',
        'orders show 1: not found',
        'ui home: users=[{"id":1,"name":"ana"}] orders=[]',
        '',
      ].join('\n'),
    )
  })

  it('passes package tests for the users and orders slices', () => {
    const result = runPackageTests(root)
    expect(result.failed).toBe(0)
    expect(result.passed).toBeGreaterThan(0)
    expect(result.exitCode).toBe(0)
    expect(result.reports.some((item) => item.name === 'testRejectsUnknownUser')).toBe(true)
    expect(result.reports.some((item) => item.name === 'testHomeRendersLists')).toBe(true)
  })
})
