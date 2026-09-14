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
  top: number[]      // indices into model.files of the tallest standing buildings (data files excluded)
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
    const lang = langOf(path)
    if (!lang.data) standing.push([i, l]) // data files are drawn as low warehouses, so they're never "tallest"
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
