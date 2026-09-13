import { test } from 'node:test'
import assert from 'node:assert/strict'
import { skipPath, isBinary, countLines } from './skip.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as git from 'isomorphic-git'
import { walk, sample } from './walker.js'
import { layout } from './layout.js'
import { timeline, stepAt, sampleAt, GAP_CAP } from './timeline.js'

test('skipPath: lockfiles, minified, maps, vendored dirs', () => {
  for (const p of ['package-lock.json', 'web/yarn.lock', 'Cargo.lock', 'go.sum', 'a/b.min.js',
    'x.min.css', 'app.js.map', 'node_modules/x/i.js', 'dist/app.js', 'vendor/lib.go'])
    assert.equal(skipPath(p), true, p)
  for (const p of ['src/app.js', 'README.md', 'distance.js', 'src/vendors.ts', 'lock.json'])
    assert.equal(skipPath(p), false, p)
})

test('countLines: newline count, +1 for an unterminated last line', () => {
  const b = s => new TextEncoder().encode(s)
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
async function fixtureRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chronocity-'))
  const write = (p, data) => {
    fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true })
    fs.writeFileSync(path.join(dir, p), data)
  }
  const commit = (message, timestamp) => git.commit({
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

function layoutPaths() {
  const paths = []
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

const tlModel = { commits: [[T, 0, 3], [T + 3600, 0, 3], [T + 60 * 86400, 0, 5]] }

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
  const s = [[0, 3], [1, 5], [2, 0]]
  assert.equal(sampleAt(tl, s, -1), -1)
  assert.equal(sampleAt(tl, s, 1), 1)
  assert.equal(sampleAt(tl, [[1, 1]], 0), -1)
})
