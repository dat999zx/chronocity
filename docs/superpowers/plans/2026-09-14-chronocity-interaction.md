# chronocity Interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Click a building or district to get a glass card pinned to it, showing size, a sparkline, the last changes (`+added −removed` with commit messages) and the real diff from GitHub. Add hover highlight, fly-to with spotlight, a commit ticker, an activity scrubber, and keyboard control.

**Architecture:** The data comes first:
- Model v2 (+/- per change; commit sha, subject and author), re-baked;
- district folder paths from the layout;
- pure stats and ticker/scrubber helpers in `packages/core`, all unit-tested.

Then the web layer:
- `selection.ts` (a shared type);
- `github.ts` (diff fetch);
- `panel.ts` (the card);
- a rewritten `city.ts` (picking, spotlight, hover, focus camera);
- `ticker.ts`, `activity.ts`;
- a rewired `main.ts`.

**Tech Stack:** TypeScript (Node 24 runs `.ts`), Vite 8, three 0.186, isomorphic-git 1.42, `node:test`, the GitHub REST API (unauthenticated).

**Spec:** `docs/superpowers/specs/2026-09-14-chronocity-interaction-design.md`. The base spec is `docs/superpowers/specs/2026-09-13-chronocity-design.md`.

## Global Constraints

- TypeScript rules: erasable syntax only, relative imports end in `.ts`, type-only imports use `import type` or an inline `type`.
- After every task, `npm test` and `npm run typecheck` pass.
- `packages/core` stays DOM-free and three-free.
- Model v2, exactly:
  - `commits: [t, tz, churn, sha, subject, author]`;
  - `files: [path, [[step, loc, add, del], ...]]`;
  - `v: 2`.
- **Security:** every string that comes from a repo (paths, commit subjects, author names, patches) is inserted with `textContent` or `el(tag, cls, text)`, never `innerHTML`. GitHub URLs are built only from `owner/name` matching `/^[\w.-]+\/[\w.-]+$/` and SHAs matching `/^[0-9a-f]{40}$/`.
- `render(u)` stays pure in `u` for the city itself. The fly-to camera, spotlight fade and hover are interaction state and may use real time.
- Don't change `sky.ts`, `rain.ts`, `lang.ts`, `skip.ts`, or the signal math in `timeline.ts` (only move the churn helper out, see Task 3).
- Screenshots: run the dev server with `npm run dev` (port 5173) in the background, then call Chrome inline. A bash function wrapper silently wrote nothing on this machine, so use the loop form:
  ```bash
  OUT="$(cygpath -w "$PWD/.shots")"; PROF="$(cygpath -w "$TEMP/chrono-chrome")"; C="/c/Program Files/Google/Chrome/Application/chrome.exe"
  for m in "name1|u=31.5&select=src/cli/program.ts" "name2|u=20"; do n=${m%%|*}; q=${m#*|}; "$C" --headless=new --user-data-dir="$PROF" --use-angle=swiftshader --enable-unsafe-swiftshader --window-size=1280,800 --virtual-time-budget=9000 --screenshot="$OUT\\$n.png" "http://localhost:5173/?$q" 2>&1 | grep -o 'written to file.*'; done
  ```
  Load the page once first (`warmup|u=0`) so Vite pre-bundles three. Open PNGs with the Read tool.

## File Structure

```
packages/core/model.ts        MOD  v2 types
packages/core/walker.ts       MOD  lineCounts(), addDel(), commit sha/subject/author, [step, loc, add, del]
packages/core/layout.ts       MOD  District gains its folder path
packages/core/stats.ts        NEW  fileStats(), districtStats(), series()
packages/core/timeline.ts     MOD  codeChurn() (moved out of signals), activity(), headline(), TICK
packages/core/test.ts         MOD  v2 literals + new tests
packages/web/public/demos/knowl.json   re-baked as v2
packages/web/selection.ts     NEW  Selection type
packages/web/github.ts        NEW  stepPatch(), commitUrl()
packages/web/panel.ts         NEW  the anchored glass card
packages/web/buildingMaterial.ts MOD aSel/uSpot spotlight, uHover highlight
packages/web/city.ts          REWRITE pick(), hover(), select(), anchor(), focus camera
packages/web/ticker.ts        NEW  commit headline line
packages/web/activity.ts      NEW  churn histogram under the scrubber
packages/web/main.ts          REWRITE wiring, keys, ?select=
packages/web/index.html       REWRITE panel/leader/hover/ticker/scrubber markup + CSS
```

---

### Task 1: Model v2 — lines added/removed and commit meta

**Files:**
- Modify: `packages/core/model.ts`, `packages/core/walker.ts`
- Replace: `packages/core/test.ts`
- Re-bake: `packages/web/public/demos/knowl.json`

**Interfaces:**
- Produces:
  - `type Commit = [t, tz, churn, sha: string, subject: string, author: string]`;
  - `type Sample = [step, loc, add, del]`;
  - `Model.v: 2`;
  - `lineCounts(bytes): LineCounts`, where `LineCounts = Map<number, number>`;
  - `addDel(prev?, next?): [add, del]`.

- [ ] **Step 1: Replace `packages/core/model.ts`**

```ts
// The Model: the contract between the walker, the bake script and the renderer (spec: "Model").

/** [author unix seconds, minutes east of UTC, Σ|ΔLOC| this step, commit sha, first line of the message, author name] */
export type Commit = [t: number, tz: number, churn: number, sha: string, subject: string, author: string]
/** [step index, lines of code at that step (0 = deleted), lines added, lines removed] */
export type Sample = [step: number, loc: number, add: number, del: number]
/** A file and every step that touched it. */
export type FileHistory = [path: string, samples: Sample[]]

export interface Model {
  v: 2
  commits: Commit[]
  files: FileHistory[]
}

/** A baked demo: a Model plus the repo it came from (owner/name for GitHub repos). */
export interface Demo extends Model {
  repo: string
}
```

- [ ] **Step 2: Replace `packages/core/test.ts`**

These are the same 19 tests updated to v2 literals, plus one new `lineCounts / addDel` test. The walker fixture's second commit now *edits* a line (`2`→`two`) and has a multi-line message.

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as git from 'isomorphic-git'
import type { Commit, FileHistory, Model, Sample } from './model.ts'
import { skipPath, isBinary, countLines } from './skip.ts'
import { walk, sample, lineCounts, addDel } from './walker.ts'
import { layout } from './layout.ts'
import { timeline, stepAt, sampleAt, signals, elevation, GAP_CAP } from './timeline.ts'
import { langOf } from './lang.ts'

test('skipPath: lockfiles, minified, maps, vendored dirs', () => {
  for (const p of ['package-lock.json', 'web/yarn.lock', 'Cargo.lock', 'go.sum', 'a/b.min.js',
    'x.min.css', 'app.js.map', 'node_modules/x/i.js', 'dist/app.js', 'vendor/lib.go'])
    assert.equal(skipPath(p), true, p)
  for (const p of ['src/app.js', 'README.md', 'distance.js', 'src/vendors.ts', 'lock.json'])
    assert.equal(skipPath(p), false, p)
})

test('countLines: newline count, +1 for an unterminated last line', () => {
  const b = (s: string) => new TextEncoder().encode(s)
  assert.equal(countLines(b('')), 0)
  assert.equal(countLines(b('a')), 1)
  assert.equal(countLines(b('a\n')), 1)
  assert.equal(countLines(b('a\nb')), 2)
  assert.equal(countLines(b('1\n2\n3\n')), 3)
})

test('isBinary: NUL byte in the first 8000 bytes', () => {
  assert.equal(isBinary(new Uint8Array([137, 80, 78, 71, 0, 1])), true)
  assert.equal(isBinary(new TextEncoder().encode('plain text\n')), false)
  const late = new Uint8Array(9000).fill(65)
  late[8500] = 0
  assert.equal(isBinary(late), false)
})

test('lineCounts / addDel: lines added and removed, counted as multisets', () => {
  const lc = (s: string) => lineCounts(new TextEncoder().encode(s))
  assert.deepEqual(addDel(lc('1\n2\n3\n'), lc('1\ntwo\n3\n4\n5\n')), [3, 1])
  assert.deepEqual(addDel(undefined, lc('a\nb')), [2, 0])     // a new file: every line is added
  assert.deepEqual(addDel(lc('x\n\n'), undefined), [0, 2])     // a deleted file: every line, blank ones too
  assert.deepEqual(addDel(lc('a\nb\n'), lc('b\na\n')), [0, 0]) // moved lines are not changes
})

const T = 1_700_000_000
// A bare commit for timeline-only tests: [t, tz, churn, sha, subject, author]
const C = (t: number, tz = 0, churn = 0): Commit => [t, tz, churn, '', '', '']

// c1: add a.ts (3 lines), a lockfile, a binary · c2: edit a.ts (2→two, +4, +5), add src/b.rs · c3: delete a.ts (60 days later)
async function fixtureRepo(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chronocity-'))
  const write = (p: string, data: string | Uint8Array) => {
    fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true })
    fs.writeFileSync(path.join(dir, p), data)
  }
  const commit = (message: string, timestamp: number) => git.commit({
    fs, dir, message, author: { name: 't', email: 't@example.com', timestamp, timezoneOffset: -420 },
  })
  await git.init({ fs, dir, defaultBranch: 'main' })
  write('a.ts', '1\n2\n3\n')
  write('package-lock.json', '{}\n')
  write('img.png', new Uint8Array([137, 80, 78, 71, 0, 0, 1]))
  for (const f of ['a.ts', 'package-lock.json', 'img.png']) await git.add({ fs, dir, filepath: f })
  await commit('c1', T)
  write('a.ts', '1\ntwo\n3\n4\n5\n')
  write('src/b.rs', 'fn main() {}\n')
  for (const f of ['a.ts', 'src/b.rs']) await git.add({ fs, dir, filepath: f })
  await commit('c2 edit\n\nlonger body', T + 3600)
  fs.rmSync(path.join(dir, 'a.ts'))
  await git.remove({ fs, dir, filepath: 'a.ts' })
  await commit('c3', T + 60 * 86400)
  return dir
}

test('walk: LOC with lines added/removed, deletes, skips, commit meta', async () => {
  const dir = await fixtureRepo()
  const model = await walk({ git, fs, dir })
  assert.equal(model.v, 2)
  assert.deepEqual(model.commits.map(c => c.slice(0, 3)), [[T, 420, 3], [T + 3600, 420, 3], [T + 60 * 86400, 420, 5]])
  assert.deepEqual(model.commits.map(c => [c[4], c[5]]), [['c1', 't'], ['c2 edit', 't'], ['c3', 't']])
  for (const c of model.commits) assert.match(c[3], /^[0-9a-f]{40}$/)
  assert.deepEqual(Object.fromEntries(model.files), {
    'a.ts': [[0, 3, 3, 0], [1, 5, 3, 1], [2, 0, 0, 5]],
    'src/b.rs': [[1, 1, 1, 0]],
  })
  fs.rmSync(dir, { recursive: true, force: true })
})

test('walk: maxSteps samples history and diffs across the gap', async () => {
  const dir = await fixtureRepo()
  const model = await walk({ git, fs, dir, maxSteps: 2 })
  assert.deepEqual(model.commits.map(c => c[0]), [T, T + 60 * 86400])
  assert.deepEqual(Object.fromEntries(model.files), { 'a.ts': [[0, 3, 3, 0], [1, 0, 0, 3]], 'src/b.rs': [[1, 1, 1, 0]] })
  fs.rmSync(dir, { recursive: true, force: true })
})

test('sample: keeps first and last, evenly spaced', () => {
  const a = [...Array(10).keys()]
  assert.deepEqual(sample(a, 4), [0, 3, 6, 9])
  assert.equal(sample(a, 20), a)
})

function layoutPaths(): string[] {
  const paths: string[] = []
  for (let a = 0; a < 5; a++)
    for (let b = 0; b < a + 2; b++)
      for (let f = 0; f < ((a * 7 + b * 3) % 11) + 1; f++) paths.push(`d${a}/s${b}/f${f}.js`)
  paths.push('README.md', 'docs', 'docs/guide.md') // 'docs' was a file once and a folder later
  return paths
}

test('layout: one lot per path, independent of input order', () => {
  const paths = layoutPaths()
  const a = layout(paths)
  assert.equal(a.lots.size, paths.length)
  assert.deepEqual(layout([...paths].reverse()), a)
})

test('layout: lots stay inside the root and never overlap', () => {
  const { size, lots } = layout(layoutPaths())
  const eps = 1e-6
  const rects = [...lots.values()]
  for (const [x, z, w, d] of rects) {
    assert.ok(w > 0 && d > 0)
    assert.ok(x >= -eps && z >= -eps && x + w <= size + eps && z + d <= size + eps)
  }
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) {
      const [ax, az, aw, ad] = rects[i], [bx, bz, bw, bd] = rects[j]
      const ox = Math.min(ax + aw, bx + bw) - Math.max(ax, bx)
      const oz = Math.min(az + ad, bz + bd) - Math.max(az, bz)
      assert.ok(ox <= eps || oz <= eps, `lots ${i} and ${j} overlap`)
    }
})

const tlModel: Pick<Model, 'commits'> = { commits: [C(T, 0, 3), C(T + 3600, 0, 3), C(T + 60 * 86400, 0, 5)] }

test('timeline: gaps capped at GAP_CAP, scaled to [0, D]', () => {
  const { u } = timeline(tlModel, 30)
  assert.equal(u[0], 0)
  assert.equal(u[2], 30)
  assert.ok(Math.abs(u[1] - (30 * 3600) / (3600 + GAP_CAP)) < 1e-9)
})

test('timeline: identical timestamps spread evenly; a single commit sits at 0', () => {
  assert.deepEqual([...timeline({ commits: [C(T), C(T), C(T)] }, 10).u], [0, 5, 10])
  assert.deepEqual([...timeline({ commits: [C(T)] }, 10).u], [0])
})

test('timeline: author time going backwards never moves u backwards', () => {
  const { u } = timeline({ commits: [C(T), C(T - 500), C(T + 1000)] }, 10)
  assert.ok(u[0] <= u[1] && u[1] <= u[2])
})

test('stepAt / sampleAt: last entry at or before u', () => {
  const tl = timeline(tlModel, 30)
  assert.equal(stepAt(tl, -1), -1)
  assert.equal(stepAt(tl, 0), 0)
  assert.equal(stepAt(tl, 29.9), 1)
  assert.equal(stepAt(tl, 30), 2)
  const s: Sample[] = [[0, 3, 3, 0], [1, 5, 2, 0], [2, 0, 0, 5]]
  assert.equal(sampleAt(tl, s, -1), -1)
  assert.equal(sampleAt(tl, s, 1), 1)
  assert.equal(sampleAt(tl, [[1, 1, 1, 0]], 0), -1)
})

test('langOf: language by extension, data files flagged', () => {
  assert.equal(langOf('src/a.ts').name, 'TypeScript')
  assert.equal(langOf('web/App.test.TSX').name, 'TypeScript')
  assert.equal(langOf('lib/x.py').color, 0x3572a5)
  assert.equal(langOf('docs/evals/suite.JSON').data, true)
  assert.equal(langOf('src/a.ts').data, false)
  assert.equal(langOf('.gitignore').name, 'Other')
  assert.equal(langOf('Makefile').name, 'Other')
})

const DAY0 = 1_699_920_000 // 2023-11-14 00:00 UTC
// A commit at an author-local hour
const at = (hour: number, tz = 0, day = 0): Commit => C(DAY0 + day * 86400 + hour * 3600 - tz * 60, tz)
const mk = (commits: Commit[], files: FileHistory[] = []): Model => ({ v: 2, commits, files })

test('elevation: +1 at noon, -1 at midnight, 0 at 06:00, scaled by r', () => {
  assert.ok(Math.abs(elevation({ hour: 12, r: 1 }) - 1) < 1e-12)
  assert.ok(Math.abs(elevation({ hour: 0, r: 0.5 }) + 0.5) < 1e-12)
  assert.ok(Math.abs(elevation({ hour: 6, r: 1 })) < 1e-12)
})

test('sky: circular mean across midnight, author-local time, scattered hours', () => {
  let m = mk([at(23), at(1, 0, 1)])
  let s = signals(m, timeline(m, 1)).sky(4) // u past the end: every tap sees both commits
  assert.ok(Math.min(s.hour, 24 - s.hour) < 1e-9, `23:00 + 01:00 gave ${s.hour}`) // midnight, not noon
  assert.ok(Math.abs(s.r - Math.cos(Math.PI / 12)) < 1e-9)
  m = mk([at(23, 420)])
  s = signals(m, timeline(m, 1)).sky(3)
  assert.ok(Math.abs(s.hour - 23) < 1e-9) // 16:00 UTC at +0700 is 23:00 for the author
  m = mk([at(6), at(18)])
  assert.ok(signals(m, timeline(m, 1)).sky(4).r < 1e-9) // opposite hours cancel out: twilight
})

test('sky: changes smoothly even when the hours flip', () => {
  const m = mk([...Array(100).keys()].map(i => at(i < 50 ? 3 : 15, 0, i)))
  const sg = signals(m, timeline(m, 30))
  let prev = elevation(sg.sky(0)), maxJump = 0
  for (let u = 0.05; u <= 32; u += 0.05) {
    const e = elevation(sg.sky(u))
    maxJump = Math.max(maxJump, Math.abs(e - prev))
    prev = e
  }
  assert.ok(maxJump < 0.15, `sky jumped ${maxJump} in 0.05 s`)
  assert.ok(elevation(sg.sky(10)) < -0.5 && elevation(sg.sky(31)) > 0.5) // 03:00 commits first, 15:00 later
})

test('fog: only in squeezed quiet stretches, strongest mid-gap', () => {
  const m = mk(tlModel.commits), tl = timeline(m, 30), sg = signals(m, tl)
  assert.equal(sg.fog(-1), 0)
  assert.equal(sg.fog(0.2), 0)                       // 1-hour gap: clear
  assert.ok(sg.fog((tl.u[1] + tl.u[2]) / 2) > 0.999) // 60-day gap: full fog mid-way
  assert.equal(sg.fog(31), 0)                        // after the last commit
})

test('rain: storms on bursts of code churn, not data dumps', () => {
  const commits = [...Array(40).keys()].map(i => C(T + i * 3600))
  let loc = 0
  const a = commits.map((_, i): Sample => { const add = i === 20 ? 5000 : 10; return [i, (loc += add), add, 0] })
  const m = mk(commits, [['a.ts', a], ['big.json', [[5, 100000, 100000, 0]]]])
  const sg = signals(m, timeline(m, 39)) // one commit per playback second
  assert.equal(sg.rain(20.1), 1) // +5000 lines of code
  assert.equal(sg.rain(10.1), 0) // an ordinary commit
  assert.equal(sg.rain(5.1), 0)  // a 100k-line JSON dump is not a storm
})

test('signals: a one-commit repo has no weather', () => {
  const m = mk([C(T)]), sg = signals(m, timeline(m, 10))
  assert.equal(sg.rain(0), 0)
  assert.equal(sg.fog(0), 0)
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test`
Expected: FAIL, because `walker.ts` does not export `lineCounts`.

- [ ] **Step 4: Replace `packages/core/walker.ts`**

```ts
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
      subject: commit.message.split('\n')[0].trim().slice(0, 100),
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
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test && npm run typecheck`
Expected: `ℹ pass 20`, `ℹ fail 0`; typecheck clean. The web code only reads `[0]`/`[1]` of these tuples, so it compiles unchanged.

- [ ] **Step 6: Re-bake knowl and check it**

```bash
test -d .bake/knowl || git clone --quiet https://github.com/dat999zx/knowl .bake/knowl
node packages/bake/bake.ts .bake/knowl knowl dat999zx/knowl main
node -e "const m=require('./packages/web/public/demos/knowl.json');let bad=0,n=0;for(const[,s]of m.files){let l=0;for(const[,loc,a,d]of s){n++;if(a-d!==loc-l)bad++;l=loc}}console.log('v'+m.v,m.commits.length,'steps',n,'samples, add-del != dLOC:',bad,'| e.g.',JSON.stringify(m.commits[400].slice(3)))"
```
Expected:
- the bake prints `738 steps, 1135 files` in about 16 s;
- the check prints `v2 738 steps 4013 samples, add-del != dLOC: 0`, plus a 40-hex sha, a subject and an author name;
- the JSON is about 203 KB.

- [ ] **Step 7: Commit**

```bash
git add packages/core packages/web/public/demos/knowl.json
git commit -m "core: Model v2 (lines added/removed per change, commit sha/subject/author); re-bake knowl"
```

---

### Task 2: District folder paths

**Files:**
- Modify: `packages/core/layout.ts`
- Test: `packages/core/test.ts` (append)

**Interfaces:**
- Produces: `District = [x, z, w, d, depth, path]`; `path` is `''` for the root, otherwise `a/b` with no trailing slash.

- [ ] **Step 1: Append the failing test**

```ts
test('layout: every district knows its folder path', () => {
  const { districts } = layout(['a/b/c.ts', 'a/d.ts', 'e.ts'])
  assert.deepEqual(districts.map(d => [d[4], d[5]]).sort(), [[0, ''], [1, 'a'], [2, 'a/b']])
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`. Expected: FAIL; the typecheck-free run shows `[0, undefined]` pairs.

- [ ] **Step 3: Implement**

In `packages/core/layout.ts`:

Replace:
```ts
export type District = [x: number, z: number, w: number, d: number, depth: number]
```
with:
```ts
export type District = [x: number, z: number, w: number, d: number, depth: number, path: string] // path '' = root
```
Replace:
```ts
  place(root, { x: 0, z: 0, w: size, d: size }, 0, lots, districts)
```
with:
```ts
  place(root, { x: 0, z: 0, w: size, d: size }, 0, '', lots, districts)
```
Replace:
```ts
function place(node: Folder, r: Box, depth: number, lots: Map<string, Rect>, districts: District[]) {
  districts.push([r.x, r.z, r.w, r.d, depth])
```
with:
```ts
function place(node: Folder, r: Box, depth: number, path: string, lots: Map<string, Rect>, districts: District[]) {
  districts.push([r.x, r.z, r.w, r.d, depth, path])
```
Replace:
```ts
    if (it.dir) place(it.dir, { x, z, w, d }, depth + 1, lots, districts)
```
with:
```ts
    if (it.dir) place(it.dir, { x, z, w, d }, depth + 1, path ? `${path}/${it.dir.name}` : it.dir.name, lots, districts)
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test && npm run typecheck`
Expected: `ℹ pass 21`; typecheck clean. `city.ts` destructures only the first five fields, so it still compiles.

- [ ] **Step 5: Commit**

```bash
git add packages/core/layout.ts packages/core/test.ts
git commit -m "core: districts carry their folder path"
```

---

### Task 3: Stats, activity and headline helpers

**Files:**
- Create: `packages/core/stats.ts`
- Modify: `packages/core/timeline.ts`
- Test: `packages/core/test.ts` (append)

**Interfaces:**
- Produces, from `stats.ts`:
  - `interface Change { step: number; add: number; del: number }`;
  - `interface FileStats { loc; first; last; changes; recent: Change[] }` (first/last are step indices);
  - `fileStats(model, tl, index, u, recent = 5): FileStats | null`;
  - `interface LangShare { name; color; loc }`;
  - `interface DistrictStats { files; loc; changes; first; last; langs: LangShare[]; top: number[] }`;
  - `districtStats(model, tl, folder, u, topN = 3)`;
  - `series(model, tl, indices, points = 48): Float64Array`.
- Produces, from `timeline.ts`:
  - `codeChurn(model): Float64Array`;
  - `activity(churn, tl, bins, span): Float64Array`;
  - `TICK = 0.6`;
  - `headline(churn, tl, u, tick = TICK): number`.

- [ ] **Step 1: Append the failing tests**

Add to the imports at the top of `packages/core/test.ts`:
```ts
import { fileStats, districtStats, series } from './stats.ts'
```
and change the timeline import to:
```ts
import { timeline, stepAt, sampleAt, signals, elevation, GAP_CAP, activity, headline } from './timeline.ts'
```
Append:
```ts
const statsModel = mk([C(T), C(T + 3600), C(T + 7200)], [
  ['src/a.ts', [[0, 10, 10, 0], [1, 12, 3, 1], [2, 0, 0, 12]]],
  ['src/b.md', [[1, 4, 4, 0]]],
  ['c.json', [[0, 100, 100, 0]]],
])
const statsTl = timeline(statsModel, 2) // u = [0, 1, 2]

test('fileStats: size, first/last, recent changes newest first; null before it exists', () => {
  assert.deepEqual(fileStats(statsModel, statsTl, 0, 1.5), {
    loc: 12, first: 0, last: 1, changes: 2,
    recent: [{ step: 1, add: 3, del: 1 }, { step: 0, add: 10, del: 0 }],
  })
  assert.equal(fileStats(statsModel, statsTl, 1, 0.5), null)
})

test('districtStats: folder totals, languages, tallest; root covers everything', () => {
  assert.deepEqual(districtStats(statsModel, statsTl, 'src', 1.5), {
    files: 2, loc: 16, changes: 3, first: 0, last: 1,
    langs: [{ name: 'TypeScript', color: 0x3178c6, loc: 12 }, { name: 'Markdown', color: 0x083fa1, loc: 4 }],
    top: [0, 1],
  })
  const root = districtStats(statsModel, statsTl, '', 2) // a.ts demolished by now
  assert.deepEqual([root.files, root.loc, root.changes, root.first, root.last, root.top], [2, 104, 5, 0, 2, [2, 1]])
  assert.deepEqual(root.langs.map(l => l.name), ['Data', 'Markdown'])
})

test('series: total lines of the given files across the clip', () => {
  assert.deepEqual([...series(statsModel, statsTl, [0, 1], 3)], [10, 16, 4])
})

test('activity: code churn binned over playback time', () => {
  const tl = { u: Float64Array.from([0, 0.5, 1.5, 2]), D: 2 }
  assert.deepEqual([...activity(Float64Array.from([1, 2, 3, 4]), tl, 2, 2)], [3, 7])
})

test('headline: biggest commit of the previous window; the exact commit before that', () => {
  const tl = { u: Float64Array.from([0, 0.1, 0.2, 0.7, 0.8]), D: 1 }
  const churn = Float64Array.from([1, 5, 2, 9, 1])
  assert.equal(headline(churn, tl, 0.3), 2)   // first window: exactly the commit at u
  assert.equal(headline(churn, tl, 0.65), 1)  // window [0, 0.6): the +5
  assert.equal(headline(churn, tl, 1.3), 3)   // window [0.6, 1.2): the +9
  const sparse = { u: Float64Array.from([0, 5]), D: 5 }
  assert.equal(headline(Float64Array.from([1, 1]), sparse, 3), 0) // empty window: the commit at u
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`. Expected: FAIL, `ERR_MODULE_NOT_FOUND` for `stats.ts`.

- [ ] **Step 3: Move code churn out of `signals` and add the helpers**

In `packages/core/timeline.ts`, replace the block at the top of `signals()`:
```ts
  const c = model.commits, n = c.length
  // Code churn per step. Data files are left out: a regenerated JSON fixture is not a storm.
  const code = new Float64Array(n)
  for (const [path, s] of model.files) {
    if (langOf(path).data) continue
    let last = 0
    for (const [i, loc] of s) {
      code[i] += Math.abs(loc - last)
      last = loc
    }
  }
```
with:
```ts
  const c = model.commits, n = c.length
  const code = codeChurn(model)
```
Append to the end of the file:
```ts
// Code churn per step: Σ|ΔLOC| over code files. Data files are left out: a regenerated JSON fixture is not a storm.
export function codeChurn(model: Model): Float64Array {
  const code = new Float64Array(model.commits.length)
  for (const [path, s] of model.files) {
    if (langOf(path).data) continue
    let last = 0
    for (const [i, loc] of s) {
      code[i] += Math.abs(loc - last)
      last = loc
    }
  }
  return code
}

// Churn summed into `bins` equal slices of playback time [0, span]: the bars under the scrubber.
export function activity(churn: Float64Array, tl: Timeline, bins: number, span: number): Float64Array {
  const out = new Float64Array(bins)
  for (let i = 0; i < churn.length; i++) out[Math.min(bins - 1, Math.floor((tl.u[i] / span) * bins))] += churn[i]
  return out
}

export const TICK = 0.6 // playback seconds per ticker headline

// The commit the ticker names while playing: the biggest code change of the previous TICK window, so headlines
// change at a readable pace and describe what just happened. First window, or an empty one: the commit at u.
export function headline(churn: Float64Array, tl: Timeline, u: number, tick = TICK): number {
  const w = Math.floor(u / tick)
  const a = stepAt(tl, (w - 1) * tick - 1e-9) + 1 // first step with u_i >= (w-1)·tick
  const b = stepAt(tl, w * tick - 1e-9)           // last step with u_i < w·tick
  if (w < 1 || b < a) return stepAt(tl, u)
  let best = a
  for (let i = a + 1; i <= b; i++) if (churn[i] > churn[best]) best = i
  return best
}
```

- [ ] **Step 4: Create `packages/core/stats.ts`**

```ts
import { langOf } from './lang.ts'
import type { Model } from './model.ts'
import { sampleAt, type Timeline } from './timeline.ts'

export interface Change { step: number; add: number; del: number }
export interface FileStats {
  loc: number
  first: number   // step it first appeared
  last: number    // step of its latest change at or before u
  changes: number // changes at or before u, the first one included
  recent: Change[] // newest first
}
export interface LangShare { name: string; color: number; loc: number }
export interface DistrictStats {
  files: number    // standing files
  loc: number
  changes: number
  first: number    // step, -1 when nothing under the folder exists yet
  last: number
  langs: LangShare[] // by standing lines, largest first
  top: number[]      // indices into model.files of the tallest standing buildings
}

// One file at playback time u; null before it first appears.
export function fileStats(model: Model, tl: Timeline, index: number, u: number, recent = 5): FileStats | null {
  const s = model.files[index][1], k = sampleAt(tl, s, u)
  if (k < 0) return null
  const changes: Change[] = []
  for (let j = k; j >= 0 && changes.length < recent; j--) changes.push({ step: s[j][0], add: s[j][2], del: s[j][3] })
  return { loc: s[k][1], first: s[0][0], last: s[k][0], changes: k + 1, recent: changes }
}

// Everything under a folder ('' = the whole repo) at playback time u.
export function districtStats(model: Model, tl: Timeline, folder: string, u: number, topN = 3): DistrictStats {
  const prefix = folder ? folder + '/' : ''
  const langs = new Map<string, LangShare>()
  const standing: [index: number, loc: number][] = []
  let files = 0, loc = 0, changes = 0, first = -1, last = -1
  model.files.forEach(([path, s], i) => {
    if (!path.startsWith(prefix)) return
    const k = sampleAt(tl, s, u)
    if (k < 0) return
    changes += k + 1
    if (first < 0 || s[0][0] < first) first = s[0][0]
    if (s[k][0] > last) last = s[k][0]
    const l = s[k][1]
    if (l === 0) return
    files++
    loc += l
    standing.push([i, l])
    const lang = langOf(path)
    const share = langs.get(lang.name) ?? { name: lang.name, color: lang.color, loc: 0 }
    share.loc += l
    langs.set(lang.name, share)
  })
  return {
    files, loc, changes, first, last,
    langs: [...langs.values()].sort((a, b) => b.loc - a.loc),
    top: standing.sort((a, b) => b[1] - a[1]).slice(0, topN).map(([i]) => i),
  }
}

// Total lines of the given files at `points` evenly spaced playback times across [0, tl.D]: a sparkline.
export function series(model: Model, tl: Timeline, indices: number[], points = 48): Float64Array {
  const out = new Float64Array(points)
  for (let j = 0; j < points; j++) {
    const u = (j / (points - 1)) * tl.D
    for (const i of indices) {
      const s = model.files[i][1], k = sampleAt(tl, s, u)
      if (k >= 0) out[j] += s[k][1]
    }
  }
  return out
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `npm test && npm run typecheck`
Expected: `ℹ pass 26`, `ℹ fail 0`; typecheck clean. The rain test proves `codeChurn` behaves exactly like the old inline code.

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "core: file/district stats, sparkline series, activity bins, ticker headline"
```

---

### Task 4: Selection type, GitHub diff client, panel

**Files:**
- Create: `packages/web/selection.ts`, `packages/web/github.ts`, `packages/web/panel.ts`

**Interfaces:**
- Produces:
  - `type Selection = { kind: 'file'; index } | { kind: 'district'; index }`;
  - `commitUrl(repo, sha): string | null`;
  - `stepPatch(repo, commits, step, path): Promise<{ patch; url } | { error; url? }>`;
  - `createPanel(card: HTMLElement, leader: SVGSVGElement, ctx: PanelContext): { show(sel, u), update(u, anchor) }`, where `PanelContext = { model: Demo; lay; tl; local(step): string; select(sel) }`.

Nothing is wired to the page yet. This task ends with a clean typecheck; Task 5 puts the panel on screen.

- [ ] **Step 1: Create `packages/web/selection.ts`**

```ts
// What the user picked: a file's building or a folder's district (an index into model.files / layout.districts).
export type Selection = { kind: 'file'; index: number } | { kind: 'district'; index: number }
```

- [ ] **Step 2: Create `packages/web/github.ts`**

```ts
import type { Commit } from '@chronocity/core/model.ts'

export type DiffResult = { patch: string; url: string } | { error: string; url?: string }
interface GhFile { filename: string; previous_filename?: string; patch?: string }

const REPO = /^[\w.-]+\/[\w.-]+$/
const SHA = /^[0-9a-f]{40}$/
const cache = new Map<string, Promise<GhFile[]>>() // per API URL, for the session

// A commit's page on GitHub, only for well-formed owner/name and sha (both are baked data, so validate).
export function commitUrl(repo: string, sha: string): string | null {
  return REPO.test(repo) && SHA.test(sha) ? `https://github.com/${repo}/commit/${sha}` : null
}

// One file's unified diff at one step. It uses GitHub's compare of the previous step against this one, so the lines
// match the step even when it spans a merge or sampled history. Public repos only, unauthenticated: about 60
// requests an hour per visitor, so responses are cached and every failure becomes a sentence for the panel.
export async function stepPatch(repo: string, commits: Commit[], step: number, path: string): Promise<DiffResult> {
  const head = commits[step]?.[3] ?? '', base = commits[step - 1]?.[3]
  const url = commitUrl(repo, head)
  if (!url) return { error: 'No GitHub diff for this repo.' }
  const api = base && SHA.test(base)
    ? `https://api.github.com/repos/${repo}/compare/${base}...${head}`
    : `https://api.github.com/repos/${repo}/commits/${head}`
  let files = cache.get(api)
  if (!files) {
    files = load(api)
    cache.set(api, files)
  }
  try {
    const f = (await files).find(x => x.filename === path || x.previous_filename === path)
    if (!f) return { error: 'GitHub left this file out of the diff (too many files changed at once).', url }
    if (!f.patch) return { error: 'No text diff for this file (too large or binary).', url }
    return { patch: f.patch, url }
  } catch (e) {
    cache.delete(api)
    return { error: e instanceof TypeError ? 'Could not reach GitHub.' : (e as Error).message, url }
  }
}

async function load(api: string): Promise<GhFile[]> {
  const res = await fetch(api, { headers: { Accept: 'application/vnd.github+json' } })
  if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000
    const mins = reset ? Math.max(1, Math.ceil((reset - Date.now()) / 60000)) : 60
    throw new Error(`GitHub's hourly limit for anonymous visitors is used up; try again in ${mins} min.`)
  }
  if (!res.ok) throw new Error(`GitHub answered ${res.status}.`)
  return ((await res.json()).files ?? []) as GhFile[]
}
```

- [ ] **Step 3: Create `packages/web/panel.ts`**

```ts
import type { Demo } from '@chronocity/core/model.ts'
import type { CityLayout } from '@chronocity/core/layout.ts'
import { stepAt, type Timeline } from '@chronocity/core/timeline.ts'
import { fileStats, districtStats, series } from '@chronocity/core/stats.ts'
import { langOf } from '@chronocity/core/lang.ts'
import type { Selection } from './selection.ts'
import { commitUrl, stepPatch } from './github.ts'

const DIFF_LINES = 60 // patch lines shown before "… N more lines"
const SVG_NS = 'http://www.w3.org/2000/svg'
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0')

// Every repo-sourced string goes in through textContent: paths, subjects, authors and patches are untrusted.
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

function svg(tag: string, attrs: Record<string, string | number>): SVGElement {
  const e = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v))
  return e
}

export interface PanelContext {
  model: Demo
  lay: CityLayout
  tl: Timeline
  local(step: number): string         // a step's author-local ISO timestamp
  select(sel: Selection | null): void // breadcrumbs, "tallest" rows and ✕ re-select
}

export interface Panel {
  show(sel: Selection | null, u: number): void
  update(u: number, anchor: { x: number; y: number } | null): void
}

// The glass card pinned to the selection by a leader line.
export function createPanel(card: HTMLElement, leader: SVGSVGElement, ctx: PanelContext): Panel {
  const { model, lay, tl } = ctx
  const line = leader.querySelector('line')!
  const body = el('div'), diffBox = el('div', 'diffbox')
  const byPath = new Map(lay.districts.map((d, i) => [d[5], i]))
  const date = (step: number) => ctx.local(step).slice(0, 10)
  let sel: Selection | null = null
  let spark = new Float64Array(0)
  let renderedStep = -2, renderedAt = 0, diffToken = 0

  function crumbs(folder: string): HTMLElement {
    const nav = el('div', 'crumbs')
    const parts = folder ? folder.split('/') : []
    const link = (path: string, label: string) => {
      const b = el('button', '', label)
      b.onclick = () => ctx.select({ kind: 'district', index: byPath.get(path) ?? 0 })
      nav.append(b)
    }
    link('', model.repo)
    parts.forEach((p, i) => {
      nav.append(' / ')
      link(parts.slice(0, i + 1).join('/'), p)
    })
    return nav
  }

  function sparkline(u: number): SVGElement {
    const s = svg('svg', { class: 'spark', viewBox: '0 0 240 40', preserveAspectRatio: 'none' })
    const max = Math.max(1, ...spark)
    const points = Array.from(spark, (v, j) => `${((j / (spark.length - 1)) * 240).toFixed(1)},${(38 - (v / max) * 34).toFixed(1)}`).join(' ')
    const x = Math.min(1, Math.max(0, u / tl.D)) * 240
    s.append(
      svg('polyline', { points, fill: 'none', stroke: '#8fb3ff', 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke' }),
      svg('rect', { x, y: 0, width: 240 - x, height: 40, fill: 'rgba(16,20,28,.6)' }), // the future, shaded
    )
    return s
  }

  function renderFile(index: number, u: number): Node[] {
    const [path] = model.files[index]
    const lang = langOf(path), st = fileStats(model, tl, index, u)
    const chip = el('span', 'chip'), swatch = el('i')
    swatch.style.background = hex(lang.color)
    chip.append(swatch, lang.name)
    const nodes: Node[] = [crumbs(path.split('/').slice(0, -1).join('/')), el('div', 'title', path.slice(path.lastIndexOf('/') + 1)), chip]
    if (!st) return [...nodes, el('div', 'big', 'not built yet')]
    nodes.push(
      el('div', 'big', st.loc ? `${st.loc.toLocaleString()} lines` : 'demolished'),
      sparkline(u),
      el('div', 'meta', `${st.changes} change${st.changes === 1 ? '' : 's'} · since ${date(st.first)} · last ${date(st.last)}`),
    )
    const rows = el('div', 'rows')
    for (const c of st.recent) {
      const row = el('button', 'row'), nums = el('span')
      nums.append(el('span', 'add', `+${c.add}`), ' ', el('span', 'del', `−${c.del}`))
      row.append(el('span', 'muted', date(c.step).slice(5)), el('span', 'msg', model.commits[c.step][4]), nums)
      row.title = 'Show this change'
      row.onclick = () => showDiff(c.step, path)
      rows.append(row)
    }
    nodes.push(rows)
    if (commitUrl(model.repo, model.commits[0][3])) nodes.push(el('div', 'muted hint', 'click a change to see its diff'))
    return nodes
  }

  function renderDistrict(index: number, u: number): Node[] {
    const folder = lay.districts[index][5], st = districtStats(model, tl, folder, u)
    const nodes: Node[] = folder
      ? [crumbs(folder.split('/').slice(0, -1).join('/')), el('div', 'title', folder.slice(folder.lastIndexOf('/') + 1) + '/')]
      : [el('div', 'title', model.repo)]
    nodes.push(el('div', 'big', `${st.files.toLocaleString()} files · ${st.loc.toLocaleString()} lines`))
    if (st.loc) {
      const bar = el('div', 'langbar')
      for (const l of st.langs.slice(0, 6)) {
        const seg = el('i')
        seg.style.flex = String(l.loc)
        seg.style.background = hex(l.color)
        seg.title = l.name
        bar.append(seg)
      }
      nodes.push(bar, el('div', 'meta', st.langs.slice(0, 3).map(l => `${l.name} ${Math.round((l.loc / st.loc) * 100)}%`).join(' · ')))
    }
    nodes.push(sparkline(u))
    if (st.first >= 0) nodes.push(el('div', 'meta', `${st.changes.toLocaleString()} changes · since ${date(st.first)} · last ${date(st.last)}`))
    const rows = el('div', 'rows')
    st.top.forEach((i, rank) => {
      const [path] = model.files[i], row = el('button', 'row')
      row.append(
        el('span', 'muted', `#${rank + 1}`),
        el('span', 'msg', folder ? path.slice(folder.length + 1) : path),
        el('span', 'muted', (fileStats(model, tl, i, u)?.loc ?? 0).toLocaleString()),
      )
      row.title = 'Select this building'
      row.onclick = () => ctx.select({ kind: 'file', index: i })
      rows.append(row)
    })
    nodes.push(rows)
    return nodes
  }

  async function showDiff(step: number, path: string) {
    const token = ++diffToken
    diffBox.hidden = false
    diffBox.replaceChildren(el('div', 'muted', 'loading the diff from GitHub…'))
    const r = await stepPatch(model.repo, model.commits, step, path)
    if (token !== diffToken) return // the selection or the requested change moved on meanwhile
    const [, , , sha, subject, author] = model.commits[step]
    const nodes: Node[] = [el('div', 'meta', `${date(step)} · ${author} · ${subject}`)]
    if ('error' in r) nodes.push(el('div', 'muted', r.error))
    else {
      const pre = el('pre'), lines = r.patch.split('\n')
      for (const l of lines.slice(0, DIFF_LINES))
        pre.append(el('span', l.startsWith('@@') ? 'hunk' : l[0] === '+' ? 'add' : l[0] === '-' ? 'del' : '', l + '\n'))
      if (lines.length > DIFF_LINES) pre.append(el('span', 'muted', `… ${lines.length - DIFF_LINES} more lines`))
      nodes.push(pre)
    }
    const url = commitUrl(model.repo, sha)
    if (url) {
      const a = el('a', 'gh', 'view on GitHub ↗')
      a.href = url
      a.target = '_blank'
      a.rel = 'noopener'
      nodes.push(a)
    }
    diffBox.replaceChildren(...nodes)
  }

  function render(u: number) {
    if (sel) body.replaceChildren(...(sel.kind === 'file' ? renderFile(sel.index, u) : renderDistrict(sel.index, u)))
  }

  return {
    show(next, u) {
      sel = next
      diffToken++
      diffBox.hidden = true
      diffBox.replaceChildren()
      if (!next) {
        card.hidden = true
        leader.style.display = 'none'
        return
      }
      const folder = next.kind === 'district' ? lay.districts[next.index][5] : ''
      const prefix = folder ? folder + '/' : ''
      const indices = next.kind === 'file' ? [next.index] : model.files.flatMap(([p], i) => (p.startsWith(prefix) ? [i] : []))
      spark = series(model, tl, indices)
      const close = el('button', 'close', '✕')
      close.setAttribute('aria-label', 'Close')
      close.onclick = () => ctx.select(null)
      card.replaceChildren(close, body, diffBox)
      card.hidden = false
      card.classList.remove('pop')
      void card.offsetWidth // restart the pop-in animation
      card.classList.add('pop')
      render(u)
      renderedStep = stepAt(tl, u)
      renderedAt = performance.now()
    },
    update(u, anchor) {
      if (!sel) return
      const k = stepAt(tl, u), now = performance.now()
      if (k !== renderedStep && now - renderedAt > 120) {
        render(u)
        renderedStep = k
        renderedAt = now
      }
      if (!anchor) {
        leader.style.display = 'none'
        return
      }
      // Above-right of the anchor, flipped left near the right edge, kept on screen and above the controls.
      const w = card.offsetWidth, h = card.offsetHeight, m = 12
      const flip = anchor.x + 40 + w > innerWidth - m
      const left = Math.max(m, Math.min(innerWidth - w - m, flip ? anchor.x - 40 - w : anchor.x + 40))
      const top = Math.max(m, Math.min(innerHeight - h - 90, anchor.y - h - 30))
      card.style.left = `${left}px`
      card.style.top = `${top}px`
      card.classList.toggle('flip', flip)
      leader.style.display = ''
      line.setAttribute('x1', String(anchor.x))
      line.setAttribute('y1', String(anchor.y))
      line.setAttribute('x2', String(flip ? left + w : left))
      line.setAttribute('y2', String(top + h))
    },
  }
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck && npm test`
Expected: clean, `ℹ pass 26`.

- [ ] **Step 5: Commit**

```bash
git add packages/web/selection.ts packages/web/github.ts packages/web/panel.ts
git commit -m "web: GitHub step diffs and the anchored inspect panel"
```

---

### Task 5: Picking, spotlight, fly-to, and the panel on screen

**Files:**
- Modify: `packages/web/buildingMaterial.ts` (full replacement)
- Replace: `packages/web/city.ts`, `packages/web/main.ts`, `packages/web/index.html`

**Interfaces:**
- Consumes: `Selection`, `createPanel` (Task 4); district paths (Task 2).
- Produces:
  - `createBuildingMaterial({ night, spot, hover })`;
  - `City`: `render(u)`, `pick(x, y): Selection | null`, `hover(sel)`, `select(sel)`, `anchor(sel): {x, y} | null`;
  - URL parameter `?select=<file path | folder | />`.

- [ ] **Step 1: Replace `packages/web/buildingMaterial.ts`**

```ts
import * as THREE from 'three'

export const FLOOR = 0.45    // window row height in world units (tuning knob)
export const BAY = 0.35      // window column width in world units (tuning knob)
export const LIT_SHARE = 0.3 // share of windows lit after dark in an idle building
export const DIM = 0.22      // brightness left to buildings outside the spotlight
const WARM = 'vec3(1.0, 0.8, 0.5)'

export interface BuildingUniforms {
  night: { value: number } // 0..1: lights a random LIT_SHARE of windows after dark
  spot: { value: number }  // 0..1: how far buildings outside the selection (aSel = 0) are dimmed
  hover: { value: number } // instance index under the cursor, or -1
}

// MeshStandardMaterial with procedural windows on the walls (not roofs):
// - by day windows are darker glass, which gives the walls texture;
// - `night` lights a random LIT_SHARE of each building's windows, like a real city after dark;
// - per-instance `aGlow` (0..1) lights every window of a building whose file was just touched;
// - per-instance `aSel` plus `spot` dim everything outside a selection; `hover` brightens one building via gl_InstanceID.
export function createBuildingMaterial({ night, spot, hover }: BuildingUniforms): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.8 })
  mat.onBeforeCompile = shader => {
    shader.uniforms.uNight = night
    shader.uniforms.uSpot = spot
    shader.uniforms.uHover = hover
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aGlow;
attribute float aSel;
uniform float uHover;
varying float vGlow;
varying float vSel;
varying float vHover;
varying vec3 vWin;
varying vec3 vWinN;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vGlow = aGlow;
vSel = aSel;
vHover = abs(float(gl_InstanceID) - uHover) < 0.5 ? 1.0 : 0.0;
vWin = (instanceMatrix * vec4(transformed, 1.0)).xyz;
vWinN = normal;`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uNight;
uniform float uSpot;
varying float vGlow;
varying float vSel;
varying float vHover;
varying vec3 vWin;
varying vec3 vWinN;
float winHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float winMask = 0.0, winRnd = 0.0;
if (abs(vWinN.y) < 0.5) {
  float along = abs(vWinN.x) > 0.5 ? vWin.z : vWin.x;
  vec2 cell = vec2(along / ${BAY.toFixed(3)}, vWin.y / ${FLOOR.toFixed(3)});
  vec2 f = fract(cell);
  winMask = step(0.3, f.x) * step(0.35, f.y) * step(f.y, 0.85);
  winRnd = winHash(floor(cell) + vWinN.xz * 17.0);
  diffuseColor.rgb *= mix(1.0, 0.62, winMask);
}
float spotK = mix(1.0, ${DIM.toFixed(2)} + ${(1 - DIM).toFixed(2)} * vSel, uSpot);
diffuseColor.rgb *= spotK;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
float winLit = max(vGlow * mix(0.5, 1.0, uNight), step(winRnd, ${LIT_SHARE.toFixed(2)}) * uNight * (0.55 + 0.45 * fract(winRnd * 7.31)));
totalEmissiveRadiance += ${WARM} * winMask * winLit * 1.5 * spotK;
totalEmissiveRadiance += diffuseColor.rgb * 0.6 * vHover;`)
  }
  return mat
}
```

- [ ] **Step 2: Replace `packages/web/city.ts`**

This keeps everything from the refinement pass (sky dome, ground, shadows, colors, bloom) and adds picking, selection and the focus camera.

```ts
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { sampleAt, signals, type Timeline } from '@chronocity/core/timeline.ts'
import { langOf } from '@chronocity/core/lang.ts'
import type { CityLayout } from '@chronocity/core/layout.ts'
import type { Model, Sample } from '@chronocity/core/model.ts'
import type { Selection } from './selection.ts'
import { createSky } from './sky.ts'
import { createBuildingMaterial } from './buildingMaterial.ts'
import { createRain } from './rain.ts'
import { autoCamera, extents } from './camera.ts'

export const HEIGHT_K = 0.25  // world units per sqrt(LOC) (tuning knob)
export const MAX_H = 24       // tallest possible building (tuning knob)
export const DATA_MAX_H = 2.5 // data files (json, csv, ...) stay low: warehouses, not towers
export const RISE = 0.6       // playback seconds for a height change to ease in
export const GLOW = 1.5       // playback seconds a touched file's windows stay lit
export const FLY_MS = 900     // camera flight to and from a selection
const MUTE = 0.15             // how far language colors are pulled toward grey (tuning knob)
const JITTER = 0.1            // per-building lightness spread, so a one-language city isn't one flat color
const GREY = new THREE.Color(0xb8bcc4)
const GROUND = new THREE.Color(0x2a2e35) // root plate: asphalt
const PLATE = new THREE.Color(0x5a6372)  // folder plates three levels deep; shallower levels blend toward GROUND

const easeOut = (p: number) => 1 - (1 - p) ** 3
const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2)
// Stable 0..1 hash of a path (FNV-1a), for per-building variation that never changes between frames.
const hash01 = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0) / 4294967296
}

interface Building { path: string; s: Sample[]; x: number; z: number; w: number; d: number; maxH: number; h: number }
type Pose = { pos: THREE.Vector3; target: THREE.Vector3 }

export interface City {
  render(u: number): void
  /** The standing building or district plate under a screen point; null over sky and open ground. */
  pick(clientX: number, clientY: number): Selection | null
  /** Brighten the building under the cursor (districts only get a label, from main.ts). */
  hover(sel: Selection | null): void
  /** Spotlight and fly to a selection; null or the root district flies back to the auto camera. */
  select(sel: Selection | null): void
  /** Screen point to pin the panel to; null when it's off-screen or the building isn't standing. */
  anchor(sel: Selection): { x: number; y: number } | null
}

export function createCity(canvas: HTMLCanvasElement, model: Model, lay: CityLayout, tl: Timeline): City {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  const scene = new THREE.Scene()

  const S = lay.size
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, S * 20)
  camera.position.set(S * 0.9, S * 0.8, S * 0.9)
  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true

  // Camera modes: 'auto' flies by itself, 'manual' after a drag or scroll, 'focus' orbits a selection.
  let mode: 'auto' | 'manual' | 'focus' = 'auto'
  let fly: { from: Pose; to: (u: number) => Pose; t0: number; then: 'auto' | 'focus' } | null = null
  let down: { x: number; y: number } | null = null
  canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY } })
  canvas.addEventListener('pointermove', e => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) <= 5) return
    fly = null // the user grabbed the camera mid-flight
    if (mode === 'auto') mode = 'manual'
  })
  addEventListener('pointerup', () => { down = null })
  canvas.addEventListener('wheel', () => {
    fly = null
    if (mode === 'auto') mode = 'manual'
  }, { passive: true })
  canvas.addEventListener('dblclick', () => flyTo(autoPose, 'auto'))

  const sig = signals(model, tl)
  const sky = createSky(scene, S)

  // Bloom makes lit windows glow after dark; the threshold keeps daylit surfaces out of it.
  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.4, 0.8)
  composer.addPass(bloom)
  composer.addPass(new OutputPass())

  const group = new THREE.Group()
  group.position.set(-S / 2, 0, -S / 2) // lay out in [0, S], orbit around the centre
  scene.add(group)
  const box = new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5) // origin at the min corner, base on y=0
  const m = new THREE.Matrix4(), color = new THREE.Color()

  // A plain that runs out to the horizon, where the fog blends it into the sky: the city stands somewhere.
  const ground = new THREE.Mesh(new THREE.CircleGeometry(S * 14, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 1 }))
  ground.position.y = -0.02
  ground.receiveShadow = true
  scene.add(ground)

  // Plates: the ground is dark asphalt and each folder level is a little lighter, so streets read as gaps.
  const plates = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ roughness: 1 }), lay.districts.length)
  lay.districts.forEach(([x, z, w, d, depth], i) => {
    m.makeScale(w, 0.05, d).setPosition(x, depth * 0.05, z)
    plates.setMatrixAt(i, m)
    plates.setColorAt(i, color.copy(GROUND).lerp(PLATE, Math.min(1, depth / 3)))
  })
  plates.receiveShadow = true
  group.add(plates)

  const files: Building[] = model.files.map(([path, s]) => {
    const [x, z, w, d] = lay.lots.get(path)!
    const g = 0.15 * Math.min(w, d) // building footprint = lot inset by 15%
    return { path, s, x: x + g, z: z + g, w: w - 2 * g, d: d - 2 * g, maxH: langOf(path).data ? DATA_MAX_H : MAX_H, h: 0 }
  })
  const night = { value: 0 }, spot = { value: 0 }, hover = { value: -1 }
  const glow = new THREE.InstancedBufferAttribute(new Float32Array(files.length), 1).setUsage(THREE.DynamicDrawUsage)
  const inSel = new THREE.InstancedBufferAttribute(new Float32Array(files.length).fill(1), 1)
  const geo = box.clone()
  geo.setAttribute('aGlow', glow)
  geo.setAttribute('aSel', inSel)
  const mesh = new THREE.InstancedMesh(geo, createBuildingMaterial({ night, spot, hover }), files.length)
  files.forEach((f, i) =>
    mesh.setColorAt(i, color.setHex(langOf(f.path).color).lerp(GREY, MUTE).offsetHSL(0, 0, (hash01(f.path) - 0.5) * JITTER)))
  mesh.castShadow = mesh.receiveShadow = true
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  mesh.frustumCulled = false // instances change every frame; a cached bounding sphere would go stale
  group.add(mesh)
  const rain = createRain(S)
  group.add(rain.object)
  const ext = extents(model.files, lay, model.commits.length)
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), v = new THREE.Vector3()
  let spotTarget = 0, lastNow = performance.now()

  const heightOf = (f: Building, loc: number) => Math.min(f.maxH, HEIGHT_K * Math.sqrt(loc))
  function heightAt(f: Building, k: number, u: number): number {
    if (k < 0) return 0
    const from = k > 0 ? heightOf(f, f.s[k - 1][1]) : 0
    const to = heightOf(f, f.s[k][1])
    const p = Math.min(1, (u - tl.u[f.s[k][0]]) / RISE)
    return from + (to - from) * easeOut(p)
  }

  const world = (x: number, y: number, z: number) => new THREE.Vector3(x - S / 2, y, z - S / 2)
  const isRoot = (sel: Selection) => sel.kind === 'district' && lay.districts[sel.index][4] === 0

  function autoPose(u: number): Pose {
    const p = autoCamera(u, tl, ext, S)
    return { pos: new THREE.Vector3(p.x, p.y, p.z), target: new THREE.Vector3() }
  }

  // Frame the selection from the current viewing direction, so the flight feels like leaning in, not teleporting.
  function focusPose(sel: Selection): Pose {
    let target: THREE.Vector3, dist: number
    if (sel.kind === 'file') {
      const f = files[sel.index], top = Math.max(f.h, 1)
      target = world(f.x + f.w / 2, top * 0.6, f.z + f.d / 2)
      dist = Math.max(10, top * 2.2 + Math.max(f.w, f.d) * 4)
    } else {
      const [x, z, w, d] = lay.districts[sel.index]
      target = world(x + w / 2, 0, z + d / 2)
      dist = Math.max(10, Math.hypot(w, d) * 1.1)
    }
    const dir = camera.position.clone().sub(target).setY(0)
    if (dir.lengthSq() < 1e-6) dir.set(1, 0, 1)
    dir.normalize()
    return { pos: target.clone().addScaledVector(dir, dist * 0.85).setY(target.y + dist * 0.5), target }
  }

  function flyTo(to: (u: number) => Pose, then: 'auto' | 'focus') {
    fly = { from: { pos: camera.position.clone(), target: controls.target.clone() }, to, t0: performance.now(), then }
  }

  function resize() {
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false)
    composer.setSize(canvas.clientWidth, canvas.clientHeight)
    camera.aspect = canvas.clientWidth / canvas.clientHeight
    camera.updateProjectionMatrix()
  }
  resize()
  addEventListener('resize', resize)

  return {
    render(u) {
      const now = performance.now(), dt = Math.min(0.1, (now - lastNow) / 1000)
      lastNow = now
      if (fly) {
        const p = Math.min(1, (now - fly.t0) / FLY_MS), e = easeInOut(p), to = fly.to(u)
        camera.position.lerpVectors(fly.from.pos, to.pos, e)
        controls.target.lerpVectors(fly.from.target, to.target, e)
        camera.lookAt(controls.target)
        if (p === 1) {
          mode = fly.then
          fly = null
        }
      } else if (mode === 'auto') {
        const pose = autoPose(u)
        camera.position.copy(pose.pos)
        controls.target.copy(pose.target)
        camera.lookAt(pose.target)
      } else controls.update() // manual, or orbiting the focused selection
      spot.value += (spotTarget - spot.value) * (1 - Math.exp(-dt * 8))

      const wet = sig.rain(u)
      night.value = sky.update(sig.sky(u), sig.fog(u), wet, camera.position.length()).night
      rain.update(u, wet)
      for (let i = 0; i < files.length; i++) {
        const f = files[i], k = sampleAt(tl, f.s, u), h = heightAt(f, k, u)
        f.h = h
        glow.setX(i, k < 0 ? 0 : Math.max(0, 1 - (u - tl.u[f.s[k][0]]) / GLOW))
        if (h < 1e-3) m.makeScale(0, 0, 0)
        else m.makeScale(f.w, h, f.d).setPosition(f.x, 0, f.z)
        mesh.setMatrixAt(i, m)
      }
      mesh.instanceMatrix.needsUpdate = true
      glow.needsUpdate = true
      bloom.strength = 0.15 + 0.6 * night.value
      composer.render()
    },
    pick(clientX, clientY) {
      const r = canvas.getBoundingClientRect()
      ray.setFromCamera(ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), camera)
      mesh.computeBoundingSphere() // instances move every frame; the raycast pre-check needs a fresh sphere
      for (const hit of ray.intersectObjects([mesh, plates], false)) {
        if (hit.instanceId === undefined) continue
        if (hit.object === plates) return { kind: 'district', index: hit.instanceId }
        if (files[hit.instanceId].h > 1e-3) return { kind: 'file', index: hit.instanceId }
      }
      return null
    },
    hover(sel) {
      hover.value = sel?.kind === 'file' ? sel.index : -1
    },
    select(sel) {
      const arr = inSel.array as Float32Array
      if (!sel || isRoot(sel)) {
        arr.fill(1)
        spotTarget = 0
        if (mode === 'focus' || fly?.then === 'focus') flyTo(autoPose, 'auto')
      } else {
        if (sel.kind === 'file') {
          arr.fill(0)
          arr[sel.index] = 1
        } else {
          const prefix = lay.districts[sel.index][5] + '/'
          files.forEach((f, i) => { arr[i] = f.path.startsWith(prefix) ? 1 : 0 })
        }
        spotTarget = 1
        const pose = focusPose(sel)
        flyTo(() => pose, 'focus')
      }
      inSel.needsUpdate = true
    },
    anchor(sel) {
      if (sel.kind === 'file') {
        const f = files[sel.index]
        if (f.h <= 1e-3) return null
        v.copy(world(f.x + f.w / 2, f.h + 0.3, f.z + f.d / 2))
      } else {
        const [x, z, w, d, depth] = lay.districts[sel.index]
        v.copy(world(x + w / 2, depth * 0.05 + 0.1, z + d / 2))
      }
      v.project(camera)
      if (v.z < -1 || v.z > 1) return null
      const r = canvas.getBoundingClientRect()
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height }
    },
  }
}
```

- [ ] **Step 3: Replace `packages/web/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>chronocity</title>
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: #1b1f27; color: #e8eaf0; font: 14px system-ui, sans-serif }
  #city { display: block; width: 100vw; height: 100vh; touch-action: none }
  #hud { position: fixed; top: 12px; left: 16px; opacity: .9; pointer-events: none; text-shadow: 0 1px 3px rgba(0,0,0,.7) }
  #bar { position: fixed; left: 16px; right: 16px; bottom: 16px; display: flex; gap: 10px; align-items: center }
  #scrub { flex: 1 }
  button, select { background: #2a2f38; color: inherit; border: 1px solid #3a404c; border-radius: 6px; padding: 6px 10px; font: inherit }
  #hover { position: fixed; padding: 3px 8px; border-radius: 6px; background: rgba(15,18,24,.85); font-size: 12px; pointer-events: none; white-space: nowrap }
  #leader { position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: none }
  #leader line { stroke: rgba(255,255,255,.6); stroke-width: 1.2 }
  #panel { position: fixed; width: 320px; max-height: 64vh; overflow: auto; box-sizing: border-box; padding: 14px 16px 12px; border-radius: 12px;
    background: rgba(16,20,28,.72); -webkit-backdrop-filter: blur(12px) saturate(1.3); backdrop-filter: blur(12px) saturate(1.3);
    border: 1px solid rgba(255,255,255,.12); box-shadow: 0 20px 60px rgba(0,0,0,.45);
    transform: perspective(900px) rotateY(-4deg); transform-origin: left center }
  #panel.flip { transform: perspective(900px) rotateY(4deg); transform-origin: right center }
  #panel.pop { animation: pop .24s cubic-bezier(.2,.9,.3,1.2) }
  @keyframes pop { from { opacity: 0; scale: .92 } }
  #panel .close { position: absolute; top: 8px; right: 8px; padding: 2px 8px; background: none; border: 0; opacity: .7; cursor: pointer }
  #panel .crumbs { font-size: 12px; opacity: .8; margin-right: 24px }
  #panel .crumbs button { background: none; border: 0; padding: 0; color: #9fb3d9; cursor: pointer; font: inherit }
  #panel .title { font-size: 18px; font-weight: 600; margin: 2px 24px 6px 0; word-break: break-all }
  #panel .chip { display: inline-flex; gap: 6px; align-items: center; font-size: 12px; opacity: .85 }
  #panel .chip i { width: 10px; height: 10px; border-radius: 2px; display: inline-block }
  #panel .big { font-size: 22px; font-variant-numeric: tabular-nums; margin: 8px 0 4px }
  #panel .meta, #panel .muted { font-size: 12px; opacity: .7 }
  #panel .hint { margin-top: 6px }
  #panel .spark { display: block; width: 100%; height: 40px; margin: 6px 0 }
  #panel .langbar { display: flex; height: 8px; border-radius: 4px; overflow: hidden; margin: 8px 0 4px }
  #panel .rows { margin-top: 10px; display: grid; gap: 2px }
  #panel .row { display: grid; grid-template-columns: 44px 1fr auto; gap: 8px; align-items: baseline; width: 100%; background: none; border: 0;
    color: inherit; text-align: left; padding: 4px 6px; border-radius: 6px; cursor: pointer; font-size: 12px }
  #panel .row:hover { background: rgba(255,255,255,.07) }
  #panel .row .msg { overflow: hidden; white-space: nowrap; text-overflow: ellipsis }
  #panel pre { margin: 8px 0 4px; padding: 8px; max-height: 260px; overflow: auto; background: rgba(0,0,0,.35); border-radius: 6px;
    font: 11px/1.45 ui-monospace, SFMono-Regular, Consolas, monospace; white-space: pre }
  #panel .gh { font-size: 12px; color: #9fb3d9 }
  .add { color: #7ee2a8 } .del { color: #ff8f8f } .hunk { color: #8fb3ff }
</style>
</head>
<body>
<canvas id="city"></canvas>
<div id="hud">loading…</div>
<svg id="leader" aria-hidden="true" style="display:none"><line/></svg>
<div id="panel" hidden></div>
<div id="hover" hidden></div>
<div id="bar">
  <button id="play" aria-label="Play or pause">▶</button>
  <input id="scrub" type="range" min="0" step="0.01" value="0" aria-label="Timeline">
  <select id="speed" aria-label="Playback speed">
    <option value="0.5">0.5×</option>
    <option value="1" selected>1×</option>
    <option value="2">2×</option>
  </select>
</div>
<script type="module" src="./main.ts"></script>
</body>
</html>
```

- [ ] **Step 4: Replace `packages/web/main.ts`**

```ts
import { layout } from '@chronocity/core/layout.ts'
import { timeline, stepAt, sampleAt } from '@chronocity/core/timeline.ts'
import type { Demo } from '@chronocity/core/model.ts'
import { createCity, RISE } from './city.ts'
import { createPanel } from './panel.ts'
import type { Selection } from './selection.ts'

const D = 30, TAIL = 1.5 // playback seconds for the whole history, plus a hold at the end
const $ = <T extends Element>(id: string) => document.getElementById(id) as Element as T
const hudEl = $<HTMLDivElement>('hud'), playBtn = $<HTMLButtonElement>('play')
const scrub = $<HTMLInputElement>('scrub'), speed = $<HTMLSelectElement>('speed')
const canvas = $<HTMLCanvasElement>('city'), hoverEl = $<HTMLDivElement>('hover')

const res = await fetch('demos/knowl.json')
if (!res.ok) {
  hudEl.textContent = `could not load the demo (${res.status})`
  throw new Error(`demo fetch ${res.status}`)
}
const model: Demo = await res.json()
const format: number = model.v // widened, so the check below doesn't narrow `model` to never
if (format !== 2) {
  hudEl.textContent = 'this demo was baked by an older chronocity; re-bake it'
  throw new Error(`demo format v${format}`)
}
const lay = layout(model.files.map(f => f[0]))
const tl = timeline(model, D)
const city = createCity(canvas, model, lay, tl)
// A step's author-local time as an ISO string ("2026-09-10T23:12:00.000Z" = 23:12 where the author was).
const local = (i: number) => { const [t, tz] = model.commits[i]; return new Date((t + tz * 60) * 1000).toISOString() }
const panel = createPanel($<HTMLDivElement>('panel'), $<SVGSVGElement>('leader'), { model, lay, tl, local, select })

const q = new URLSearchParams(location.search) // ?u=12.5 opens paused there; ?select=<path | folder | /> opens its panel
let u = q.has('u') ? +q.get('u')! : 0
let playing = !q.has('u')
let last = performance.now()
let sel: Selection | null = null

function select(next: Selection | null) {
  sel = next
  city.select(next)
  panel.show(next, u)
  const url = new URL(location.href)
  if (next) url.searchParams.set('select', next.kind === 'file' ? model.files[next.index][0] : lay.districts[next.index][5] || '/')
  else url.searchParams.delete('select')
  history.replaceState(null, '', url)
}

function togglePlay() {
  playing = !playing
  if (playing && u >= D + TAIL) u = 0
}

// Step to the neighbouring commit and hold just after its buildings have risen.
function stepBy(dir: 1 | -1) {
  const k = stepAt(tl, u) + dir
  if (k < 0 || k >= tl.u.length) return
  const next = k + 1 < tl.u.length ? tl.u[k + 1] - 1e-6 : Infinity
  u = Math.max(tl.u[k], Math.min(tl.u[k] + RISE, next))
  playing = false
}

scrub.max = String(D + TAIL)
playBtn.onclick = togglePlay
scrub.oninput = () => { u = +scrub.value; playing = false }
addEventListener('keydown', e => {
  const t = e.target
  if (t instanceof HTMLSelectElement || (t instanceof HTMLInputElement && t.type !== 'range')) return
  if (t instanceof HTMLButtonElement && (e.code === 'Space' || e.key === 'Enter')) return // the button handles it
  if (e.code === 'Space') togglePlay()
  else if (e.key === 'ArrowRight') stepBy(1)
  else if (e.key === 'ArrowLeft') stepBy(-1)
  else if (e.key === 'Escape') select(null)
  else return
  e.preventDefault()
})

let press = { x: 0, y: 0 }, dragging = false, pointer: { x: number; y: number } | null = null
canvas.addEventListener('pointerdown', e => { press = { x: e.clientX, y: e.clientY }; dragging = true })
addEventListener('pointerup', () => { dragging = false })
canvas.addEventListener('pointerup', e => {
  if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 5) return // a drag, not a click
  select(city.pick(e.clientX, e.clientY))
})
canvas.addEventListener('pointermove', e => { pointer = { x: e.clientX, y: e.clientY } })
canvas.addEventListener('pointerleave', () => { pointer = null })

function updateHover() {
  const h = pointer && !dragging ? city.pick(pointer.x, pointer.y) : null
  city.hover(h)
  const label = !h ? '' : h.kind === 'file' ? model.files[h.index][0] : lay.districts[h.index][5] ? lay.districts[h.index][5] + '/' : model.repo
  canvas.style.cursor = label ? 'pointer' : ''
  hoverEl.hidden = !label
  if (label && pointer) {
    hoverEl.textContent = label
    hoverEl.style.left = `${pointer.x + 14}px`
    hoverEl.style.top = `${pointer.y + 14}px`
  }
}

function hud() {
  const i = stepAt(tl, u)
  let files = 0, loc = 0
  for (const [, s] of model.files) {
    const k = sampleAt(tl, s, u)
    if (k >= 0 && s[k][1] > 0) { files++; loc += s[k][1] }
  }
  // Date only: the sky shows the recent commits' average hour, so a single commit's clock time would contradict it.
  const date = local(Math.max(i, 0)).slice(0, 10)
  hudEl.textContent = `${model.repo} · ${date} · commit ${i + 1}/${model.commits.length} · ${files} files · ${loc.toLocaleString()} lines`
}

function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000)
  last = now
  if (playing) {
    u = Math.min(D + TAIL, u + dt * +speed.value)
    if (u >= D + TAIL) playing = false
  }
  playBtn.textContent = playing ? '❚❚' : '▶'
  scrub.value = String(u)
  city.render(u)
  hud()
  panel.update(u, sel ? city.anchor(sel) : null)
  updateHover()
  requestAnimationFrame(frame)
}

city.render(u) // once up front, so buildings have heights before a ?select= flight is planned
const want = q.get('select')
if (want !== null) {
  const f = model.files.findIndex(([p]) => p === want)
  const d = lay.districts.findIndex(dd => dd[5] === (want === '/' ? '' : want))
  if (f >= 0) select({ kind: 'file', index: f })
  else if (d >= 0) select({ kind: 'district', index: d })
}
requestAnimationFrame(frame)
```

- [ ] **Step 5: Typecheck, test, screenshot**

Run: `npm run typecheck && npm test`, which should be clean with `ℹ pass 26`. Start the dev server, then take:
```
warmup|u=0
t5-file|u=31.5&select=src/cli/program.ts
t5-folder|u=31.5&select=src
t5-root|u=20&select=/
t5-none|u=21.3
```
Expected:
- `t5-file`: the camera has flown in close to the tall `program.ts` tower, everything else is dimmed, and a glass card sits above-right of it with a leader line to its top. The card shows crumbs `dat999zx/knowl / src / cli`, the title `program.ts`, a TypeScript chip, `4,902 lines`, a sparkline, a changes line, and 5 rows with `+N −N`.
- `t5-folder`: the `src/` district is lit and the rest dimmed; the card has a language bar and 3 tallest rows.
- `t5-root`: the camera is unchanged, nothing is dimmed, and the card is titled `dat999zx/knowl`.
- `t5-none`: the same as the refined day shot, with no card.

If the buildings are black or missing, the shader failed to compile: rerun one shot with `--enable-logging=stderr --v=0` and grep for `ERROR`.

- [ ] **Step 6: Commit**

```bash
git add packages/web
git commit -m "web: click to inspect — anchored panel, spotlight, fly-to, hover, keys, ?select= links"
```

---

### Task 6: Commit ticker and activity scrubber

**Files:**
- Create: `packages/web/ticker.ts`, `packages/web/activity.ts`
- Modify: `packages/web/main.ts`, `packages/web/index.html`

**Interfaces:**
- Consumes: `codeChurn`, `activity`, `headline`, `stepAt` (Task 3).
- Produces:
  - `createTicker(el, model, tl, churn, local): { update(u, playing) }`;
  - `createActivity(canvas, churn, tl, span): { draw(u) }`.

- [ ] **Step 1: Create `packages/web/ticker.ts`**

```ts
import { headline, stepAt, type Timeline } from '@chronocity/core/timeline.ts'
import type { Demo } from '@chronocity/core/model.ts'

// The commit line above the scrubber. While playing it names the biggest commit of the previous 0.6 s, readable at
// 25 commits a second; paused or scrubbing, exactly the commit at u.
export function createTicker(el: HTMLElement, model: Demo, tl: Timeline, churn: Float64Array, local: (step: number) => string) {
  let shown = -2
  return {
    update(u: number, playing: boolean) {
      const k = playing ? headline(churn, tl, u) : stepAt(tl, u)
      if (k === shown) return
      shown = k
      if (k < 0) {
        el.textContent = ''
        return
      }
      const [, , , , subject, author] = model.commits[k]
      el.textContent = `${local(k).slice(0, 10)} · ${author} · ${subject}`
      el.classList.remove('tick')
      void el.offsetWidth // restart the fade-in
      el.classList.add('tick')
    },
  }
}
```

- [ ] **Step 2: Create `packages/web/activity.ts`**

```ts
import { activity, type Timeline } from '@chronocity/core/timeline.ts'

const BINS = 160
const PLAYED = '#8fb3ff', AHEAD = '#3a4252'

// Code churn as bars under the scrubber (sqrt-scaled so small weeks still show), brighter where already played.
export function createActivity(canvas: HTMLCanvasElement, churn: Float64Array, tl: Timeline, span: number) {
  const bars = activity(churn, tl, BINS, span)
  const max = Math.max(1, ...bars)
  const ctx = canvas.getContext('2d')!
  return {
    draw(u: number) {
      const dpr = Math.min(devicePixelRatio, 2), w = canvas.clientWidth, h = canvas.clientHeight
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      const bw = w / BINS
      for (let i = 0; i < BINS; i++) {
        const bh = Math.max(1, Math.sqrt(bars[i] / max) * (h - 6))
        ctx.fillStyle = ((i + 0.5) / BINS) * span <= u ? PLAYED : AHEAD
        ctx.fillRect(i * bw + 0.5, h - bh, Math.max(1, bw - 1), bh)
      }
    },
  }
}
```

- [ ] **Step 3: Markup and CSS**

In `packages/web/index.html`, replace:
```html
  <input id="scrub" type="range" min="0" step="0.01" value="0" aria-label="Timeline">
```
with:
```html
  <div id="scrubwrap"><canvas id="activity" aria-hidden="true"></canvas><input id="scrub" type="range" min="0" step="0.01" value="0" aria-label="Timeline"></div>
```
Add above `<div id="bar">`:
```html
<div id="ticker"></div>
```
Replace the CSS line:
```css
  #scrub { flex: 1 }
```
with:
```css
  #scrubwrap { position: relative; flex: 1; height: 30px }
  #activity { position: absolute; inset: 0; width: 100%; height: 100% }
  #scrub { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; background: transparent; -webkit-appearance: none; appearance: none; cursor: pointer }
  #scrub::-webkit-slider-runnable-track { background: transparent; height: 30px }
  #scrub::-moz-range-track { background: transparent }
  #scrub::-webkit-slider-thumb { -webkit-appearance: none; width: 3px; height: 30px; background: #fff; border-radius: 2px; box-shadow: 0 0 6px rgba(255,255,255,.6) }
  #scrub::-moz-range-thumb { width: 3px; height: 30px; background: #fff; border: 0; border-radius: 2px }
  #ticker { position: fixed; left: 16px; right: 16px; bottom: 58px; text-align: center; font-size: 13px; opacity: .92; pointer-events: none;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-shadow: 0 1px 3px rgba(0,0,0,.85) }
  .tick { animation: tick .35s ease-out }
  @keyframes tick { from { opacity: 0; transform: translateY(6px) } }
```

- [ ] **Step 4: Wire into main.ts**

In `packages/web/main.ts`:

Change the timeline import to:
```ts
import { timeline, stepAt, sampleAt, codeChurn } from '@chronocity/core/timeline.ts'
```
Add the imports:
```ts
import { createTicker } from './ticker.ts'
import { createActivity } from './activity.ts'
```
After the `const panel = createPanel(...)` line, add:
```ts
const churn = codeChurn(model)
const ticker = createTicker($<HTMLDivElement>('ticker'), model, tl, churn, local)
const bars = createActivity($<HTMLCanvasElement>('activity'), churn, tl, D + TAIL)
```
In `frame()`, after `hud()`, add:
```ts
  ticker.update(u, playing)
  bars.draw(u)
```

- [ ] **Step 5: Typecheck and screenshot**

Run `npm run typecheck && npm test`, which should be clean with 26 passing. Then take:
```
t6-storm|u=13.6
t6-end|u=31.5
```
Expected:
- the bottom bar shows activity bars, bright up to the playhead and dim after it, with a thin white playhead;
- one centered ticker line above the bar reads `YYYY-MM-DD · <author> · <subject>`, the commit at that u;
- the storm frame's bars peak near the playhead.

- [ ] **Step 6: Commit**

```bash
git add packages/web
git commit -m "web: commit ticker and activity scrubber"
```

---

### Task 7: Verify and hand over

- [ ] **Step 1: Full check**

Stop the dev server, then:
```bash
npm test && npm run typecheck && npm run build
```
Expected: `ℹ fail 0`, typecheck clean, and a successful build (the >500 kB chunk warning is expected; it's three.js).

- [ ] **Step 2: Manual checklist for the user (real browser, `npm run dev`)**

Ask the user to confirm each item:
1. Hovering a building brightens it, shows its path and turns the cursor into a hand. Hovering a plate shows the folder.
2. Clicking a building flies the camera in over about 1 s, dims the rest, and pins the card with a line that follows as you drag to orbit.
3. Clicking a row in the card loads the GitHub diff (green/red lines plus "view on GitHub ↗").
4. Clicking a breadcrumb jumps to that folder; clicking a "#1" row jumps to that building.
5. Esc or clicking the sky flies back to the auto camera.
6. Space plays and pauses; ←/→ step one commit and the ticker shows exactly that commit.
7. After playing a while, the ticker changes about twice a second at 1×.
8. The URL shows `?select=…` and reloading it opens the same card.

- [ ] **Step 3: Deploy only after the user says yes**

```bash
git push
gh run watch "$(gh run list --workflow pages --limit 1 --json databaseId -q '.[0].databaseId')" --exit-status
```
