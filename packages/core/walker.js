import { skipPath, isBinary, countLines } from './skip.js'

export const MAX_STEPS = 2000

// Evenly spaced subset of arr with at most max items, always keeping the first and last.
export function sample(arr, max) {
  if (arr.length <= max) return arr
  return Array.from({ length: max }, (_, i) => arr[Math.round((i * (arr.length - 1)) / (max - 1))])
}

// Walk the first-parent history of `ref` and return a Model (spec: "Model").
// `git` is injected so the same code runs on npm isomorphic-git (Node) and the CDN build (browser).
export async function walk({ git, fs, dir, gitdir, ref = 'HEAD', maxSteps = MAX_STEPS, onProgress = () => {} }) {
  const cache = {} // shared packfile cache: without it every read re-parses the pack index
  const o = { fs, dir, gitdir, cache }

  const chain = []
  for (let oid = await git.resolveRef({ fs, dir, gitdir, ref }); oid; ) {
    const { commit } = await git.readCommit({ ...o, oid })
    // isomorphic-git's timezoneOffset has Date#getTimezoneOffset's sign; the Model stores minutes east of UTC
    chain.push({ tree: commit.tree, t: commit.author.timestamp, tz: -commit.author.timezoneOffset || 0 })
    oid = commit.parent[0]
  }
  const steps = sample(chain.reverse(), maxSteps)

  const files = new Map() // path -> { s: [[step, loc]], last } or { binary: true }
  const locOf = new Map() // blob oid -> loc, or -1 for binary
  const commits = []
  let prevTree = null
  for (let i = 0; i < steps.length; i++) {
    const changed = []
    await diffTrees(git, o, prevTree, steps[i].tree, '', changed)
    prevTree = steps[i].tree
    let churn = 0
    for (const [path, blob] of changed) {
      if (skipPath(path)) continue
      let f = files.get(path)
      if (f?.binary) continue
      let loc = 0
      if (blob) {
        loc = locOf.get(blob)
        if (loc === undefined) {
          const bytes = (await git.readBlob({ ...o, oid: blob })).blob
          loc = isBinary(bytes) ? -1 : countLines(bytes)
          locOf.set(blob, loc)
        }
      }
      if (loc === -1) { files.set(path, { binary: true }); continue } // excluded for good
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
  return {
    v: 1,
    commits,
    files: [...files].filter(([, f]) => !f.binary).map(([path, f]) => [path, f.s]),
  }
}

const isFile = e => e?.type === 'blob' && e.mode !== '120000' // symlinks and submodules aren't buildings

// Push [path, blobOid | null] for every file that differs between tree oids a and b (either may be null).
// Only descends into subtrees whose oid changed.
async function diffTrees(git, o, a, b, prefix, out) {
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

async function entries(git, o, oid) {
  if (!oid) return new Map()
  const { tree } = await git.readTree({ ...o, oid })
  return new Map(tree.map(e => [e.path, e]))
}
