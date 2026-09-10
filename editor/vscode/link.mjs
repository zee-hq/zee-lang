#!/usr/bin/env node
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const extensionDir = fileURLToPath(new URL('.', import.meta.url))
const name = 'zee-hq.zee-0.1.0'
const homes = [
  join(homedir(), '.cursor/extensions'),
  join(homedir(), '.vscode/extensions'),
]

for (const parent of homes) {
  mkdirSync(parent, { recursive: true })
  const dest = join(parent, name)
  rmSync(dest, { recursive: true, force: true })
  const stale = join(parent, 'zethsell.zee-0.1.0')
  rmSync(stale, { recursive: true, force: true })
  symlinkSync(extensionDir, dest)
  console.log(`linked ${dest}`)
}
