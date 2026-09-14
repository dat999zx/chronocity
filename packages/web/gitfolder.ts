import { githubRepoOf } from '@chronocity/core/remote.ts'

// Reading a dropped or picked repo folder's .git into memory. Three ways in, one result:
// - a <input webkitdirectory> file list (every browser's fallback picker);
// - a FileSystemDirectoryHandle (Chromium's showDirectoryPicker, which only descends into .git);
// - a drag-and-drop FileSystemEntry (every browser; also only descends into .git).
// Nothing is uploaded anywhere: the bytes go to a Web Worker in this tab.

export const MAX_GIT_BYTES = 400 * 1024 * 1024 // the whole .git is held in memory while it is walked

export interface GitFolder {
  name: string                   // the folder's name
  repo: string                   // "owner/name" for a GitHub origin, else the folder name
  files: Map<string, ArrayBuffer> // '.git/…' → bytes
}

// A problem with what was dropped, worded for the person who dropped it.
export class FolderError extends Error {}

const NOT_A_REPO = 'That folder has no .git inside. Clone the repo with git (not “Download ZIP”), then drop the folder.'
const POINTER = 'That .git is a pointer file (a worktree or submodule). Drop the main clone instead.'
const SHALLOW = 'That is a shallow clone, so most of its history is missing. Run `git fetch --unshallow` in it and drop it again.'
const tooBig = () => new FolderError(`That repo's .git is over ${MAX_GIT_BYTES / 1048576} MB, more than a browser tab can hold.`)

class Collector {
  files = new Map<string, ArrayBuffer>()
  bytes = 0
  onBytes: (n: number) => void
  constructor(onBytes: (n: number) => void) {
    this.onBytes = onBytes
  }
  async add(path: string, file: File) {
    this.bytes += file.size
    if (this.bytes > MAX_GIT_BYTES) throw tooBig()
    this.files.set(path, await file.arrayBuffer())
    this.onBytes(this.bytes)
  }
  finish(name: string): GitFolder {
    if (!this.files.has('.git/HEAD')) throw new FolderError(NOT_A_REPO)
    if (this.files.has('.git/shallow')) throw new FolderError(SHALLOW)
    const config = this.files.get('.git/config')
    return { name, repo: (config && githubRepoOf(new TextDecoder().decode(config))) || name, files: this.files }
  }
}

// <input type=file webkitdirectory>: paths look like "<picked folder>/.git/HEAD".
export async function fromFileList(list: FileList, onBytes: (n: number) => void): Promise<GitFolder> {
  const all = [...list]
  if (!all.length) throw new FolderError(NOT_A_REPO)
  const root = all[0].webkitRelativePath.split('/')[0]
  if (all.some(f => f.webkitRelativePath === `${root}/.git`)) throw new FolderError(POINTER)
  const c = new Collector(onBytes)
  for (const f of all) {
    const rel = f.webkitRelativePath.slice(root.length + 1)
    const path = root === '.git' ? `.git/${rel}` : rel // they picked the .git folder itself
    if (path.startsWith('.git/')) await c.add(path, f)
  }
  return c.finish(root)
}

type Picker = (options?: { id?: string; mode?: 'read' }) => Promise<FileSystemDirectoryHandle>
// Chromium's folder picker, when there is one.
export const directoryPicker = (globalThis as unknown as { showDirectoryPicker?: Picker }).showDirectoryPicker

export async function fromHandle(root: FileSystemDirectoryHandle, onBytes: (n: number) => void): Promise<GitFolder> {
  let gitDir = root
  if (root.name !== '.git') {
    try {
      gitDir = await root.getDirectoryHandle('.git')
    } catch {
      const pointer = await root.getFileHandle('.git').then(() => true, () => false)
      throw new FolderError(pointer ? POINTER : NOT_A_REPO)
    }
  }
  const c = new Collector(onBytes)
  const walkDir = async (dir: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
    for await (const [name, h] of dir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
      if (h.kind === 'directory') await walkDir(h as FileSystemDirectoryHandle, `${prefix}${name}/`)
      else await c.add(prefix + name, await (h as FileSystemFileHandle).getFile())
    }
  }
  await walkDir(gitDir, '.git/')
  return c.finish(root.name)
}

// Drag and drop. Call webkitGetAsEntry() inside the drop handler (the items expire after it) and pass the entry here.
export async function fromEntry(entry: FileSystemEntry | null, onBytes: (n: number) => void): Promise<GitFolder> {
  if (!entry?.isDirectory) throw new FolderError('Drop a folder (a cloned repo), not a file.')
  const root = entry as FileSystemDirectoryEntry
  const gitDir = root.name === '.git' ? root : await new Promise<FileSystemDirectoryEntry | null>(res =>
    root.getDirectory('.git', {}, d => res(d as FileSystemDirectoryEntry), () => res(null)))
  if (!gitDir) {
    const pointer = await new Promise<boolean>(res => root.getFile('.git', {}, () => res(true), () => res(false)))
    throw new FolderError(pointer ? POINTER : NOT_A_REPO)
  }
  const readAll = (dir: FileSystemDirectoryEntry) => new Promise<FileSystemEntry[]>((resolve, reject) => {
    const reader = dir.createReader(), out: FileSystemEntry[] = []
    const next = () => reader.readEntries(batch => { if (!batch.length) resolve(out); else { out.push(...batch); next() } }, reject)
    next()
  })
  const fileOf = (f: FileSystemFileEntry) => new Promise<File>((resolve, reject) => f.file(resolve, reject))
  const c = new Collector(onBytes)
  const walkDir = async (dir: FileSystemDirectoryEntry, prefix: string): Promise<void> => {
    for (const e of await readAll(dir)) {
      if (e.isDirectory) await walkDir(e as FileSystemDirectoryEntry, `${prefix}${e.name}/`)
      else await c.add(prefix + e.name, await fileOf(e as FileSystemFileEntry))
    }
  }
  await walkDir(gitDir, '.git/')
  return c.finish(root.name)
}
