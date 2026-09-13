// Files that would dominate the skyline without being code anyone wrote.
const LOCKFILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'Cargo.lock',
  'Gemfile.lock', 'poetry.lock', 'composer.lock', 'go.sum', 'uv.lock',
])
const SKIP_DIRS = new Set(['node_modules', 'dist', 'vendor'])
const GENERATED = /\.min\.(js|css)$|\.map$/

export function skipPath(path) {
  const parts = path.split('/')
  const name = parts.pop()
  return LOCKFILES.has(name) || GENERATED.test(name) || parts.some(p => SKIP_DIRS.has(p))
}

export function isBinary(bytes) {
  const end = Math.min(bytes.length, 8000)
  for (let i = 0; i < end; i++) if (bytes[i] === 0) return true
  return false
}

export function countLines(bytes) {
  let n = 0
  for (let i = 0; i < bytes.length; i++) if (bytes[i] === 10) n++
  return bytes.length && bytes[bytes.length - 1] !== 10 ? n + 1 : n
}
