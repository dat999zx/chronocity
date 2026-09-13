// Serves packages/web at / and packages/core at /core/: the same shape as the Pages deploy.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../packages/', import.meta.url))
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' }
const port = +process.env.PORT || 5173

http.createServer((req, res) => {
  let url = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (url.endsWith('/')) url += 'index.html'
  const file = url.startsWith('/core/') ? path.join(root, url) : path.join(root, 'web', url)
  if (!file.startsWith(root)) return res.writeHead(403).end()
  fs.readFile(file, (err, data) => {
    if (err) return res.writeHead(404).end('not found')
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
    res.end(data)
  })
}).listen(port, () => console.log(`http://localhost:${port}`))
