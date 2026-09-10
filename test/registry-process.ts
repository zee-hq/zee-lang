import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

export async function startRegistryProcess(options: {
  root: string
  token: string
}): Promise<{ url: string; stop: () => void }> {
  const tsx = require.resolve('tsx/cli')
  const child: ChildProcess = spawn(
    process.execPath,
    [tsx, join(repoRoot, 'src/cli.ts'), 'registry', '--root', options.root, '--token', options.token, '--port', '0'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  return await new Promise((resolve, reject) => {
    let stdout = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`registry did not start: ${stdout}`))
    }, 15_000)
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
      const match = /listening (http:\/\/\S+)/.exec(stdout)
      if (!match) return
      clearTimeout(timer)
      resolve({
        url: match[1]!.replace(/\/$/, ''),
        stop: () => {
          child.kill('SIGTERM')
        },
      })
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('exit', (code) => {
      if (code) {
        clearTimeout(timer)
        reject(new Error(`registry exited ${code}: ${stdout}`))
      }
    })
  })
}
