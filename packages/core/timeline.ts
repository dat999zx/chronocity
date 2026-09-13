import type { Model, Sample } from './model.ts'

export const GAP_CAP = 3 * 86400 // quiet stretches longer than this are squeezed (later drawn as fog)

export interface Timeline {
  u: Float64Array // playback seconds per commit
  D: number
}

// Playback time u (seconds, 0..D) for each commit, from real author-time gaps with long ones capped.
export function timeline(model: Pick<Model, 'commits'>, D: number): Timeline {
  const c = model.commits, n = c.length
  const u = new Float64Array(n)
  for (let i = 1; i < n; i++) u[i] = u[i - 1] + Math.min(Math.max(0, c[i][0] - c[i - 1][0]), GAP_CAP)
  const total = n > 1 ? u[n - 1] : 0
  for (let i = 0; i < n; i++) u[i] = total > 0 ? (u[i] / total) * D : n > 1 ? (D * i) / (n - 1) : 0
  return { u, D }
}

// Index of the last commit at or before u, or -1 before the first.
export function stepAt(tl: Timeline, u: number): number {
  return lastAtOrBefore(tl.u.length, i => tl.u[i], u)
}

// Index of the last sample in s at or before u, or -1.
export function sampleAt(tl: Timeline, s: Sample[], u: number): number {
  return lastAtOrBefore(s.length, k => tl.u[s[k][0]], u)
}

function lastAtOrBefore(n: number, at: (i: number) => number, u: number): number {
  let lo = 0, hi = n - 1, found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (at(mid) <= u) { found = mid; lo = mid + 1 } else hi = mid - 1
  }
  return found
}
