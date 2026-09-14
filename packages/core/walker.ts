import type * as Git from 'isomorphic-git'
import type { Commit, FileHistory, Model, Sample } from './model.ts'
import { skipPath, isBinary, countLines } from './skip.ts'

export const MAX_STEPS = 2000

/** The slice of isomorphic-git the walker uses. Injected so Node and the browser can each pass their own build. */
export type GitApi = Pick<typeof Git, 'resolveRef' | 'readCommit' | 'readTree' | 'readBlob'>
type TreeEntry = Awaited<ReturnType<GitApi['readTree']>>['tree'][number]
type Fs = Parameters<GitApi['readBlob']>[0]['fs']
type ReadOpts = { fs: Fs; dir?: string; gitdir?: string; cache: object }

export interface WalkOptions {
  git: GitApi
  fs: Fs
  dir?: string
  gitdir?: string
  ref?: string
  maxSteps?: number
  onProgress?: (step: number, total: number) => void
}

/** How many times each line (32-bit FNV-1a hash of its bytes) occurs. The total equals countLines(). */
export type LineCounts = Map<number, number>

export function lineCounts(bytes: Uint8Array): LineCounts {
  const m: LineCounts = new Map()
  let h = 2166136261, len = 0
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]
    if (b === 10) {
      m.set(h, (m.get(h) ?? 0) + 1)
      h = 2166136261
      len = 0
      continue
    }
    h = Math.imul(h ^ b, 16777619)
    len++
  }
  if (len > 0) m.set(h, (m.get(h) ?? 0) + 1) // an unterminated last line
  return m
}

/** Lines added and removed between two versions, as multisets: add − del = ΔLOC, and a moved line is no change. */
export function addDel(prev?: LineCounts, next?: LineCounts): [add: number, del: number] {
  let add = 0, del = 0
  if (next) for (const [h, c] of next) add += Math.max(0, c - (prev?.get(h) ?? 0))
  if (prev) for (const [h, c] of prev) del += Math.max(0, c - (next?.get(h) ?? 0))
  return [add, del]
}

// Evenly spaced subset of arr with at most max items, always keeping the first and last.
export function sample<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr
  return Array.from({ length: max }, (_, i) => arr[Math.round((i * (arr.length - 1)) / (max - 1))])
}

// A commit's one-line subject (≤ 100 chars). GitHub merge commits say "Merge pull request #N from owner/branch" on the
// first line and carry the PR title in the next paragraph; on a first-parent walk they are most of the story, so
// use "<PR title> (#N)" instead.
export function subjectOf(message: string): string {
  const lines = message.split('\n').map(l => l.trim())
  const pr = /^Merge pull request (#\d+) from /.exec(lines[0])
  const title = pr ? lines.slice(1).find(l => l) : undefined
  return (pr && title ? `${title} (${pr[1]})` : lines[0]).slice(0, 100)
}

// Walk the first-parent history of `ref` and return a Model (spec: "Model v2").
export async function walk({ git, fs, dir, gitdir, ref = 'HEAD', maxSteps = MAX_STEPS, onProgress = () => {} }: WalkOptions): Promise<Model> {
  const cache = {} // shared packfile cache: without it every read re-parses the pack index
  const o: ReadOpts = { fs, dir, gitdir, cache }

  const chain: { oid: string; tree: string; t: number; tz: number; subject: string; author: string }[] = []
  for (let oid: string | undefined = await git.resolveRef({ fs, dir, gitdir, ref }); oid; ) {
    const { commit } = await git.readCommit({ ...o, oid })
    chain.push({
      oid,
      tree: commit.tree,
      t: commit.author.timestamp,
      // isomorphic-git's timezoneOffset has Date#getTimezoneOffset's sign; the Model stores minutes east of UTC
      tz: -commit.author.timezoneOffset || 0,
      subject: subjectOf(commit.message),
      author: commit.author.name,
    })
    oid = commit.parent[0]
  }
  const steps = sample(chain.reverse(), maxSteps)

  // Each live file keeps its current line counts so the next version can be diffed against it.
  const files = new Map<string, { s: Sample[]; last: number; lines?: LineCounts } | 'binary'>()
  const commits: Commit[] = []
  let prevTree: string | null = null
  for (let i = 0; i < steps.length; i++) {
    const changed: [string, string | null][] = []
    await diffTrees(git, o, prevTree, steps[i].tree, '', changed)
    prevTree = steps[i].tree
    let churn = 0
    for (const [path, blob] of changed) {
      if (skipPath(path)) continue
      let f = files.get(path)
      if (f === 'binary') continue
      let loc = 0, lines: LineCounts | undefined
      if (blob) {
        const bytes = (await git.readBlob({ ...o, oid: blob })).blob
        if (isBinary(bytes)) { files.set(path, 'binary'); continue } // excluded for good
        loc = countLines(bytes)
        lines = lineCounts(bytes)
      }
      if (!f) {
        if (!blob) continue
        f = { s: [], last: 0 }
        files.set(path, f)
      }
      const [add, del] = addDel(f.lines, lines)
      churn += Math.abs(loc - f.last)
      f.last = loc
      f.lines = lines
      f.s.push([i, loc, add, del])
    }
    const { oid, t, tz, subject, author } = steps[i]
    commits.push([t, tz, churn, oid, subject, author])
    if (i % 25 === 0) onProgress(i, steps.length)
  }
  onProgress(steps.length, steps.length)
  const out: FileHistory[] = []
  for (const [path, f] of files) if (f !== 'binary') out.push([path, f.s])
  return { v: 2, commits, files: out }
}

// Symlinks and submodules aren't buildings.
const isFile = (e?: TreeEntry): e is TreeEntry => e?.type === 'blob' && e.mode !== '120000'

// Push [path, blobOid | null] for every file that differs between tree oids a and b (either may be null).
// Only descends into subtrees whose oid changed.
async function diffTrees(git: GitApi, o: ReadOpts, a: string | null, b: string | null, prefix: string, out: [string, string | null][]) {
  if (a === b) return
  const A = await entries(git, o, a)
  const B = await entries(git, o, b)
  for (const name of new Set([...A.keys(), ...B.keys()])) {
    const x = A.get(name), y = B.get(name)
    if (x && y && x.oid === y.oid) continue
    const path = prefix + name
    const xt = x?.type === 'tree' ? x.oid : null
    const yt = y?.type === 'tree' ? y.oid : null
    if (xt || yt) await diffTrees(git, o, xt, yt, path + '/', out)
    if (isFile(y)) out.push([path, y.oid])
    else if (isFile(x)) out.push([path, null])
  }
}

async function entries(git: GitApi, o: ReadOpts, oid: string | null): Promise<Map<string, TreeEntry>> {
  if (!oid) return new Map()
  const { tree } = await git.readTree({ ...o, oid })
  return new Map(tree.map(e => [e.path, e]))
}
