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

// Evenly spaced subset of arr with at most max items, always keeping the first and last.
export function sample<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr
  return Array.from({ length: max }, (_, i) => arr[Math.round((i * (arr.length - 1)) / (max - 1))])
}

// Walk the first-parent history of `ref` and return a Model (spec: "Model").
export async function walk({ git, fs, dir, gitdir, ref = 'HEAD', maxSteps = MAX_STEPS, onProgress = () => {} }: WalkOptions): Promise<Model> {
  const cache = {} // shared packfile cache: without it every read re-parses the pack index
  const o: ReadOpts = { fs, dir, gitdir, cache }

  const chain: { tree: string; t: number; tz: number }[] = []
  for (let oid: string | undefined = await git.resolveRef({ fs, dir, gitdir, ref }); oid; ) {
    const { commit } = await git.readCommit({ ...o, oid })
    // isomorphic-git's timezoneOffset has Date#getTimezoneOffset's sign; the Model stores minutes east of UTC
    chain.push({ tree: commit.tree, t: commit.author.timestamp, tz: -commit.author.timezoneOffset || 0 })
    oid = commit.parent[0]
  }
  const steps = sample(chain.reverse(), maxSteps)

  const files = new Map<string, { s: Sample[]; last: number } | 'binary'>()
  const locOf = new Map<string, number>() // blob oid -> loc, or -1 for binary
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
      let loc = 0
      if (blob) {
        let known = locOf.get(blob)
        if (known === undefined) {
          const bytes = (await git.readBlob({ ...o, oid: blob })).blob
          known = isBinary(bytes) ? -1 : countLines(bytes)
          locOf.set(blob, known)
        }
        loc = known
      }
      if (loc === -1) { files.set(path, 'binary'); continue } // excluded for good
      if (!f) {
        if (!blob) continue
        f = { s: [], last: 0 }
        files.set(path, f)
      }
      churn += Math.abs(loc - f.last)
      f.last = loc
      f.s.push([i, loc])
    }
    commits.push([steps[i].t, steps[i].tz, churn])
    if (i % 25 === 0) onProgress(i, steps.length)
  }
  onProgress(steps.length, steps.length)
  const out: FileHistory[] = []
  for (const [path, f] of files) if (f !== 'binary') out.push([path, f.s])
  return { v: 1, commits, files: out }
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
