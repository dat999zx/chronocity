import type { Commit, Sample } from './model.ts'
import { stepAt, type Timeline } from './timeline.ts'

// A building's life: scaffolding while its file is being worked on, weathering once nobody has touched it in a while.

export const SCAFFOLD_WINDOW = 3 * 86400  // real seconds a change keeps its building scaffolded, fading as it ages
export const SCAFFOLD_FULL = 150          // lines changed (faded by age) that scaffold a building to the roof (tuning knob)
export const WEATHER_MIN = 60 * 86400     // untouched this long is fully weathered, at the least...
export const WEATHER_SHARE = 1 / 3        // ...or a third of the history so far, so a 3-month repo and a 12-year one both age

// Author time at playback u, moving linearly between steps (so a squeezed quiet stretch passes its days quickly).
export function realTime(commits: Commit[], tl: Timeline, u: number): number {
  const k = stepAt(tl, u), n = commits.length
  if (k < 0) return commits[0][0]
  if (k >= n - 1) return commits[n - 1][0]
  const span = tl.u[k + 1] - tl.u[k], p = span > 0 ? Math.min(1, (u - tl.u[k]) / span) : 0
  return commits[k][0] + p * (commits[k + 1][0] - commits[k][0])
}

// 0..1: lines changed in the last SCAFFOLD_WINDOW, each weighted by how recent it is. k = the file's sample at `now`.
export function scaffolding(commits: Commit[], s: Sample[], k: number, now: number): number {
  let lines = 0
  for (let j = k; j >= 0; j--) {
    const age = Math.max(0, now - commits[s[j][0]][0])
    if (age >= SCAFFOLD_WINDOW) break
    lines += (s[j][2] + s[j][3]) * (1 - age / SCAFFOLD_WINDOW)
  }
  return Math.min(1, lines / SCAFFOLD_FULL)
}

// 0..1: how long since the file last changed, against the history so far.
export function weathering(commits: Commit[], s: Sample[], k: number, now: number): number {
  if (k < 0) return 0
  const age = now - commits[s[k][0]][0], history = now - commits[0][0]
  return Math.min(1, Math.max(0, age / Math.max(WEATHER_MIN, history * WEATHER_SHARE)))
}
