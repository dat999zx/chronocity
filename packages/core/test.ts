import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as git from 'isomorphic-git'
import type { Commit, FileHistory, Model, Sample } from './model.ts'
import { skipPath, isBinary, countLines } from './skip.ts'
import { walk, sample, lineCounts, addDel, subjectOf } from './walker.ts'
import { layout } from './layout.ts'
import { timeline, stepAt, sampleAt, signals, elevation, GAP_CAP, FOG_MIN_LEN, activity, headline } from './timeline.ts'
import { langOf } from './lang.ts'
import { githubRepoOf } from './remote.ts'
import { fileStats, districtStats, series, cityTotals, commitsUpTo } from './stats.ts'
import { realTime, scaffolding, weathering, SCAFFOLD_FULL, WEATHER_MIN } from './aging.ts'

test('skipPath: lockfiles, minified, maps, vendored dirs', () => {
  for (const p of ['package-lock.json', 'web/yarn.lock', 'Cargo.lock', 'go.sum', 'a/b.min.js',
    'x.min.css', 'app.js.map', 'node_modules/x/i.js', 'dist/app.js', 'vendor/lib.go',
    '.yarn/releases/yarn-3.6.0.cjs', 'third_party/zlib/zlib.c', 'api/user.pb.go', 'api/user_pb2.py',
    'src/schema.generated.ts', 'src/__snapshots__/App.test.js.snap', 'Pipfile.lock'])
    assert.equal(skipPath(p), true, p)
  for (const p of ['src/app.js', 'README.md', 'distance.js', 'src/vendors.ts', 'lock.json',
    'src/snapshot.ts', 'src/generated.ts', 'yarn/cli.js'])
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

test('subjectOf: first line, or the PR title for GitHub merge commits', () => {
  assert.equal(subjectOf('fix: a thing\n\nbody'), 'fix: a thing')
  assert.equal(subjectOf('Merge pull request #2 from me/branch\n\nfeat: stop hook + lifecycle\n\nmore'), 'feat: stop hook + lifecycle (#2)')
  assert.equal(subjectOf('Merge pull request #3 from me/branch'), 'Merge pull request #3 from me/branch') // no title to use
  assert.equal(subjectOf('x'.repeat(150)).length, 100)
})

const T = 1_700_000_000
// A bare commit for timeline-only tests: [t, tz, churn, sha, subject, author, commits]
const C = (t: number, tz = 0, churn = 0): Commit => [t, tz, churn, '', '', '', 1]

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
  assert.equal(model.v, 3)
  assert.deepEqual(model.commits.map(c => c.slice(0, 3)), [[T, 420, 3], [T + 3600, 420, 3], [T + 60 * 86400, 420, 5]])
  assert.deepEqual(model.commits.map(c => [c[4], c[5], c[6]]), [['c1', 't', 1], ['c2 edit', 't', 1], ['c3', 't', 1]])
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
  assert.deepEqual(model.commits.map(c => c[6]), [1, 2]) // the c3 step also carries the skipped c2
  assert.deepEqual(Object.fromEntries(model.files), { 'a.ts': [[0, 3, 3, 0], [1, 0, 0, 3]], 'src/b.rs': [[1, 1, 1, 0]] })
  fs.rmSync(dir, { recursive: true, force: true })
})

test('walk: a merged branch counts all its commits, so steps sum to the full commit count', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chronocity-'))
  const author = (timestamp: number) => ({ name: 't', email: 't@example.com', timestamp, timezoneOffset: 0 })
  const commitFile = async (file: string, message: string, timestamp: number) => {
    fs.writeFileSync(path.join(dir, file), `${message}\n`)
    await git.add({ fs, dir, filepath: file })
    await git.commit({ fs, dir, message, author: author(timestamp) })
  }
  await git.init({ fs, dir, defaultBranch: 'main' })
  await commitFile('a.ts', 'c1', T)
  await git.branch({ fs, dir, ref: 'feature', checkout: true })
  await commitFile('f1.ts', 'f1', T + 60)
  await commitFile('f2.ts', 'f2', T + 120)
  await git.checkout({ fs, dir, ref: 'main' })
  await commitFile('b.ts', 'c2', T + 180)
  await git.merge({ fs, dir, ours: 'main', theirs: 'feature', fastForward: false, message: 'Merge branch feature', author: author(T + 240) })
  const model = await walk({ git, fs, dir })
  // First-parent steps: c1, c2, the merge. The merge brings itself + f1 + f2: 5 commits in all, like `git rev-list --count`.
  assert.deepEqual(model.commits.map(c => [c[4], c[6]]), [['c1', 1], ['c2', 1], ['Merge branch feature', 3]])
  assert.deepEqual(model.files.map(f => f[0]).sort(), ['a.ts', 'b.ts', 'f1.ts', 'f2.ts'])
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
const mk = (commits: Commit[], files: FileHistory[] = []): Model => ({ v: 3, commits, files })

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

test('fog: sampled steps that bring many commits are busy, and a real quiet stretch lasts FOG_MIN_LEN on screen', () => {
  // Years of steps 4 days apart, each bringing 10 commits (a big repo sampled to 1,000 steps), then a real
  // 100-day silence before one lone commit, squeezed into a sliver of playback.
  const commits = [...Array(1000).keys()].map(i => { const c = C(T + i * 4 * 86400 + (i > 500 ? 100 * 86400 : 0)); c[6] = i === 501 ? 1 : 10; return c })
  const m = mk(commits), tl = timeline(m, 30), sg = signals(m, tl)
  assert.equal(sg.fog((tl.u[100] + tl.u[101]) / 2), 0) // 4 days but 10 commits: not quiet
  const mid = (tl.u[500] + tl.u[501]) / 2
  assert.ok(tl.u[501] - tl.u[500] < 0.1)                // squeezed to a flash...
  assert.ok(sg.fog(mid) > 0.999)
  assert.ok(sg.fog(mid - FOG_MIN_LEN / 4) > 0.5 && sg.fog(mid + FOG_MIN_LEN / 4) > 0.5) // ...but shown as a bank
})

test('aging: real time glides between steps; scaffolding fades over 3 days; weathering is age against history', () => {
  const day = 86400
  const commits = [C(T), C(T + 2 * day), C(T + 400 * day)]
  const tl = timeline(mk(commits), 30)
  assert.equal(realTime(commits, tl, -1), T)
  assert.equal(realTime(commits, tl, (tl.u[0] + tl.u[1]) / 2), T + day) // half-way between the first two steps
  assert.equal(realTime(commits, tl, 99), T + 400 * day)                // held after the last step

  const s: Sample[] = [[0, 50, 50, 0], [1, 80, 40, 10]] // written at step 0, edited (+40 −10) at step 1
  // the fresh edit (50 lines) plus the 2-day-old first version, a third left of its weight
  assert.ok(Math.abs(scaffolding(commits, s, 1, T + 2 * day) - (50 + 50 / 3) / SCAFFOLD_FULL) < 1e-9)
  assert.ok(scaffolding(commits, s, 1, T + 3.5 * day) < scaffolding(commits, s, 1, T + 2.5 * day)) // fading
  assert.equal(scaffolding(commits, s, 1, T + 5.1 * day), 0)                                 // 3+ days after the last change
  assert.equal(scaffolding(commits, s, -1, T), 0)

  assert.equal(weathering(commits, s, 1, T + 2 * day), 0)                // just changed
  assert.equal(weathering(commits, s, 1, T + 2 * day + WEATHER_MIN), 1)  // a young repo: fully weathered after 60 days
  assert.ok(weathering(commits, s, 1, T + 400 * day) > 0.99)             // 398 days untouched against 400 days of history
  assert.equal(weathering(commits, s, -1, T), 0)                         // not built yet
})

test('owners: lines added per author up to u, largest first; data files never crown an owner', () => {
  const by = (t: number, author: string): Commit => { const c = C(t); c[5] = author; return c }
  const m = mk([by(T, 'ann'), by(T + 3600, 'bob'), by(T + 7200, 'ann')], [
    ['src/a.ts', [[0, 60, 60, 0], [1, 80, 30, 10], [2, 90, 10, 0]]],
    ['src/b.json', [[1, 500, 500, 0]]],
  ])
  const tl = timeline(m, 10)
  assert.deepEqual(fileStats(m, tl, 0, 99)!.owners, [{ author: 'ann', share: 0.7 }, { author: 'bob', share: 0.3 }])
  assert.deepEqual(fileStats(m, tl, 0, tl.u[0])!.owners, [{ author: 'ann', share: 1 }]) // before bob's edit
  assert.deepEqual(districtStats(m, tl, 'src', 99).owners.map(o => o.author), ['ann', 'bob']) // bob's 500-line JSON doesn't count
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

test('layout: every district knows its folder path', () => {
  const { districts } = layout(['a/b/c.ts', 'a/d.ts', 'e.ts'])
  assert.deepEqual(districts.map(d => [d[4], d[5]]).sort(), [[0, ''], [1, 'a'], [2, 'a/b']])
})

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
    owners: [{ author: '', share: 1 }],
  })
  assert.equal(fileStats(statsModel, statsTl, 1, 0.5), null)
})

test('districtStats: folder totals, languages, tallest; root covers everything', () => {
  assert.deepEqual(districtStats(statsModel, statsTl, 'src', 1.5), {
    files: 2, loc: 16, changes: 3, first: 0, last: 1,
    langs: [{ name: 'TypeScript', color: 0x3178c6, loc: 12 }, { name: 'Markdown', color: 0x083fa1, loc: 4 }],
    top: [0, 1],
    owners: [{ author: '', share: 1 }],
  })
  const root = districtStats(statsModel, statsTl, '', 2) // a.ts demolished by now
  assert.deepEqual([root.files, root.loc, root.changes, root.first, root.last, root.top], [2, 104, 5, 0, 2, [1]]) // c.json is a warehouse, not a tower
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

test('cityTotals: standing files and lines at u', () => {
  assert.deepEqual(cityTotals(statsModel, statsTl, -1), { files: 0, loc: 0 })
  assert.deepEqual(cityTotals(statsModel, statsTl, 1.5), { files: 3, loc: 116 }) // a.ts 12 + b.md 4 + c.json 100
  assert.deepEqual(cityTotals(statsModel, statsTl, 2), { files: 2, loc: 104 })   // a.ts demolished
})



test('commitsUpTo: running total of real commits, merges included', () => {
  const cs = [C(T), C(T + 1), C(T + 2)]
  cs[2][6] = 3 // a merge that brings two branch commits
  assert.deepEqual([...commitsUpTo(mk(cs))], [1, 2, 5])
})

test('githubRepoOf: owner/name of a GitHub origin in .git/config, else null', () => {
  const cfg = (url: string) => `[core]\n\tbare = false\n[remote "origin"]\n\turl = ${url}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`
  assert.equal(githubRepoOf(cfg('https://github.com/dat999zx/knowl.git')), 'dat999zx/knowl')
  assert.equal(githubRepoOf(cfg('https://github.com/dat999zx/knowl')), 'dat999zx/knowl')
  assert.equal(githubRepoOf(cfg('git@github.com:dat999zx/chrono.city.git')), 'dat999zx/chrono.city')
  assert.equal(githubRepoOf(cfg('ssh://git@github.com/a-b/c_d.git')), 'a-b/c_d')
  assert.equal(githubRepoOf(cfg('https://gitlab.com/a/b.git')), null)
  assert.equal(githubRepoOf('[remote "upstream"]\n\turl = https://github.com/x/y.git\n'), null) // only origin counts
  assert.equal(githubRepoOf(''), null)
})
