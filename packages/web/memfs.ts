import { Buffer } from 'buffer'

// A read-only, in-memory filesystem over a dropped repo's .git, shaped like the node:fs promises API that
// isomorphic-git reads through (readFile, readdir, stat/lstat, readlink). Paths are relative to the repo root.
export function memfs(files: Map<string, Uint8Array>) {
  const dirs = new Map<string, Set<string>>([['', new Set()]])
  for (const p of files.keys()) {
    const parts = p.split('/')
    for (let i = 0; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/')
      let children = dirs.get(dir)
      if (!children) dirs.set(dir, (children = new Set()))
      children.add(parts[i])
    }
  }
  const norm = (p: string) => p.replace(/^\/+|\/+$/g, '')
  const enoent = (p: string) => Object.assign(new Error(`ENOENT: no such file or directory, '${p}'`), { code: 'ENOENT' })
  const entry = (dir: boolean, size: number) => ({
    isFile: () => !dir, isDirectory: () => dir, isSymbolicLink: () => false,
    size, mode: dir ? 0o40000 : 0o100644, mtimeMs: 0, ctimeMs: 0, uid: 1, gid: 1, dev: 1, ino: 1,
  })
  const stat = async (p: string) => {
    const n = norm(p), f = files.get(n)
    if (f) return entry(false, f.byteLength)
    if (dirs.has(n)) return entry(true, 0)
    throw enoent(p)
  }
  const readOnly = async () => { throw new Error('read-only filesystem') }
  return {
    promises: {
      async readFile(p: string, opts?: string | { encoding?: string }) {
        const b = files.get(norm(p))
        if (!b) throw enoent(p)
        const encoding = typeof opts === 'string' ? opts : opts?.encoding
        // zero-copy view; the bytes came from File.arrayBuffer(), so never a SharedArrayBuffer
        return encoding === 'utf8' ? new TextDecoder().decode(b) : Buffer.from(b.buffer as ArrayBuffer, b.byteOffset, b.byteLength)
      },
      async readdir(p: string) {
        const children = dirs.get(norm(p))
        if (!children) throw enoent(p)
        return [...children]
      },
      stat,
      lstat: stat,
      async readlink(p: string) { throw enoent(p) },
      writeFile: readOnly, mkdir: readOnly, rmdir: readOnly, unlink: readOnly, symlink: readOnly, chmod: readOnly,
    },
  }
}
