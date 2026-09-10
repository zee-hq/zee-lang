#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const outDir = join(dirname(fileURLToPath(import.meta.url)), 'catppuccin')
const repo = 'https://github.com/catppuccin/vscode-icons.git'

const tmp = mkdtempSync(join(tmpdir(), 'catppuccin-icons-'))
try {
  execFileSync('git', ['clone', '--depth', '1', '--filter=blob:none', '--sparse', repo, tmp], {
    stdio: 'inherit',
  })
  execFileSync('git', ['sparse-checkout', 'set', 'icons/mocha', 'src/defaults'], {
    cwd: tmp,
    stdio: 'inherit',
  })

  mkdirSync(outDir, { recursive: true })
  cpSync(join(tmp, 'icons/mocha'), join(outDir, 'mocha'), { recursive: true })
  execFileSync('curl', ['-fsSL', `${repo.replace(/\.git$/, '')}/raw/main/LICENSE`, '-o', join(outDir, 'LICENSE')], {
    stdio: 'inherit',
  })

  const files = await import(pathToFileURL(join(tmp, 'src/defaults/fileIcons.ts')).href)
  const folders = await import(pathToFileURL(join(tmp, 'src/defaults/folderIcons.ts')).href)
  writeFileSync(
    join(outDir, 'associations.json'),
    `${JSON.stringify(
      {
        source: 'https://github.com/catppuccin/vscode-icons',
        fileExtensions: files.fileExtensions,
        fileNames: files.fileNames,
        languageIds: files.languageIds,
        folderNames: folders.folderNames,
      },
      null,
      2,
    )}\n`,
  )
  writeFileSync(
    join(outDir, 'NOTICE'),
    `Catppuccin Icons for VSCode
https://github.com/catppuccin/vscode-icons
MIT License — see LICENSE in this folder.
Copyright (c) 2023 Catppuccin
Copyright (c) 2023 thang-nm
`,
  )
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
