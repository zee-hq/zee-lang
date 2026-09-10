import { stdin, stdout, stderr, exit } from 'node:process'

const chunks = []
for await (const chunk of stdin) chunks.push(chunk)
const req = JSON.parse(Buffer.concat(chunks).toString('utf8'))

try {
  const res = await fetch(req.url, {
    method: req.method,
    headers: req.headers,
    body: req.bodyBase64 ? Buffer.from(req.bodyBase64, 'base64') : undefined,
  })
  const body = Buffer.from(await res.arrayBuffer())
  stdout.write(
    JSON.stringify({
      status: res.status,
      contentType: res.headers.get('content-type') ?? '',
      bodyBase64: body.toString('base64'),
    }),
  )
} catch (error) {
  stderr.write(error instanceof Error ? error.message : String(error))
  exit(1)
}
