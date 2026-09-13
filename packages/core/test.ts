import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as git from 'isomorphic-git'
import type { Commit, FileHistory, Model, Sample } from './model.ts'
import { skipPath, isBinary, countLines } from './skip.ts'
import { walk, sample } from './walker.ts'
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

const T = 1_700_000_000

// c1: add a.ts (3 lines), a lockfile, a binary · c2: a.ts → 5 lines, add src/b.rs · c3: delete a.ts (60 days later)
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
  write('a.ts', '1\n2\n3\n4\n5\n')
  write('src/b.rs', 'fn main() {}\n')
  for (const f of ['a.ts', 'src/b.rs']) await git.add({ fs, dir, filepath: f })
  await commit('c2', T + 3600)
  fs.rmSync(path.join(dir, 'a.ts'))
  await git.remove({ fs, dir, filepath: 'a.ts' })
  await commit('c3', T + 60 * 86400)
  return dir
}

test('walk: per-file LOC samples, deletes, skips, author timezone', async () => {
  const dir = await fixtureRepo()
  const model = await walk({ git, fs, dir })
  assert.equal(model.v, 1)
  assert.deepEqual(model.commits, [[T, 420, 3], [T + 3600, 420, 3], [T + 60 * 86400, 420, 5]])
  assert.deepEqual(Object.fromEntries(model.files), {
    'a.ts': [[0, 3], [1, 5], [2, 0]],
    'src/b.rs': [[1, 1]],
  })
  fs.rmSync(dir, { recursive: true, force: true })
})

test('walk: maxSteps samples history and diffs across the gap', async () => {
  const dir = await fixtureRepo()
  const model = await walk({ git, fs, dir, maxSteps: 2 })
  assert.deepEqual(model.commits.map(c => c[0]), [T, T + 60 * 86400])
  assert.deepEqual(Object.fromEntries(model.files), { 'a.ts': [[0, 3], [1, 0]], 'src/b.rs': [[1, 1]] })
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

const tlModel: Pick<Model, 'commits'> = { commits: [[T, 0, 3], [T + 3600, 0, 3], [T + 60 * 86400, 0, 5]] }

test('timeline: gaps capped at GAP_CAP, scaled to [0, D]', () => {
  const { u } = timeline(tlModel, 30)
  assert.equal(u[0], 0)
  assert.equal(u[2], 30)
  assert.ok(Math.abs(u[1] - (30 * 3600) / (3600 + GAP_CAP)) < 1e-9)
})

test('timeline: identical timestamps spread evenly; a single commit sits at 0', () => {
  assert.deepEqual([...timeline({ commits: [[T, 0, 0], [T, 0, 0], [T, 0, 0]] }, 10).u], [0, 5, 10])
  assert.deepEqual([...timeline({ commits: [[T, 0, 0]] }, 10).u], [0])
})

test('timeline: author time going backwards never moves u backwards', () => {
  const { u } = timeline({ commits: [[T, 0, 0], [T - 500, 0, 0], [T + 1000, 0, 0]] }, 10)
  assert.ok(u[0] <= u[1] && u[1] <= u[2])
})

test('stepAt / sampleAt: last entry at or before u', () => {
  const tl = timeline(tlModel, 30)
  assert.equal(stepAt(tl, -1), -1)
  assert.equal(stepAt(tl, 0), 0)
  assert.equal(stepAt(tl, 29.9), 1)
  assert.equal(stepAt(tl, 30), 2)
  const s: Sample[] = [[0, 3], [1, 5], [2, 0]]
  assert.equal(sampleAt(tl, s, -1), -1)
  assert.equal(sampleAt(tl, s, 1), 1)
  assert.equal(sampleAt(tl, [[1, 1]], 0), -1)
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
// A commit at an author-local hour: [t, tz, churn]
const at = (hour: number, tz = 0, day = 0): Commit => [DAY0 + day * 86400 + hour * 3600 - tz * 60, tz, 0]
const mk = (commits: Commit[], files: FileHistory[] = []): Model => ({ v: 1, commits, files })

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
  const commits = [...Array(40).keys()].map(i => [T + i * 3600, 0, 0] as Commit)
  let loc = 0
  const a: Sample[] = commits.map((_, i) => [i, (loc += i === 20 ? 5000 : 10)])
  const m = mk(commits, [['a.ts', a], ['big.json', [[5, 100000]]]])
  const sg = signals(m, timeline(m, 39)) // one commit per playback second
  assert.equal(sg.rain(20.1), 1) // +5000 lines of code
  assert.equal(sg.rain(10.1), 0) // an ordinary commit
  assert.equal(sg.rain(5.1), 0)  // a 100k-line JSON dump is not a storm
})

test('signals: a one-commit repo has no weather', () => {
  const m = mk([[T, 0, 0]]), sg = signals(m, timeline(m, 10))
  assert.equal(sg.rain(0), 0)
  assert.equal(sg.fog(0), 0)
})


