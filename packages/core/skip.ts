// Files that would dominate the skyline without being code anyone wrote.
const LOCKFILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'Cargo.lock',
  'Gemfile.lock', 'poetry.lock', 'composer.lock', 'go.sum', 'uv.lock',
  'npm-shrinkwrap.json', 'Pipfile.lock', 'flake.lock',
])
// ponytail: fixed list; honour .gitattributes linguist-generated/-vendored if repos slip through.
const SKIP_DIRS = new Set(['node_modules', 'dist', 'vendor', 'third_party', 'bower_components', 'Pods', '.yarn'])
const GENERATED = /\.min\.(js|css)$|\.map$|\.pb\.go$|_pb2\.py$|\.generated\.\w+$|\.snap$/

export function skipPath(path: string): boolean {
  const parts = path.split('/')
  const name = parts.pop()!
  return LOCKFILES.has(name) || GENERATED.test(name) || parts.some(p => SKIP_DIRS.has(p))
}

export function isBinary(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, 8000)
  for (let i = 0; i < end; i++) if (bytes[i] === 0) return true
  return false
}

export function countLines(bytes: Uint8Array): number {
  let n = 0
  for (let i = 0; i < bytes.length; i++) if (bytes[i] === 10) n++
  return bytes.length && bytes[bytes.length - 1] !== 10 ? n + 1 : n
}
