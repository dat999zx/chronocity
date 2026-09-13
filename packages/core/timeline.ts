import { langOf } from './lang.ts'
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

export const FOG_RAMP = 4 * 86400 // gap beyond GAP_CAP at which fog is full: a 7-day gap is fully foggy
export const SKY_WINDOW = 2       // playback seconds of commits that set the sky...
export const SKY_TAPS = 16        // ...averaged at this many points, so the sky never snaps
export const SKY_MIN_COMMITS = 12 // a sparse stretch still averages at least this many commits
export const RAIN_WINDOW = 0.5    // playback seconds of code churn that make the weather

export interface SkyState {
  hour: number // circular mean of author-local commit hours, 0..24
  r: number    // how concentrated those hours are: 1 = all at one time, 0 = spread around the clock
}

export interface Signals {
  sky(u: number): SkyState
  fog(u: number): number  // 0..1, strongest in the middle of a squeezed quiet stretch
  rain(u: number): number // 0..1, dry below the clip's p90 of code churn, a full storm at p99
}

// Sun height: +1 at noon, -1 at midnight, 0 at 06:00 and 18:00. Scattered hours flatten it toward twilight.
export function elevation({ hour, r }: SkyState): number {
  return -Math.cos((hour / 24) * 2 * Math.PI) * r
}

// Daylight and weather as pure functions of playback time, built from prefix sums over commits.
export function signals(model: Model, tl: Timeline): Signals {
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
  // Prefix sums: unit vectors of each commit's author-local hour, and code churn.
  const cos = new Float64Array(n + 1), sin = new Float64Array(n + 1), churn = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) {
    const [t, tz] = c[i]
    const a = (((((t + tz * 60) % 86400) + 86400) % 86400) / 86400) * 2 * Math.PI
    cos[i + 1] = cos[i] + Math.cos(a)
    sin[i + 1] = sin[i] + Math.sin(a)
    churn[i + 1] = churn[i] + code[i]
  }
  const end = (u: number) => stepAt(tl, u) + 1 // prefix index just past the last commit at or before u
  const hourVec = (u: number): [number, number] => {
    const b = end(u)
    if (b === 0) return [0, 0]
    const a = Math.max(0, Math.min(end(u - SKY_WINDOW), b - SKY_MIN_COMMITS))
    return [(cos[b] - cos[a]) / (b - a), (sin[b] - sin[a]) / (b - a)]
  }
  const codeChurn = (u: number) => churn[end(u)] - churn[end(u - RAIN_WINDOW)]
  // Rain thresholds come from the whole clip sampled evenly, so "wet" means a share of playback time.
  const clip = Array.from({ length: 600 }, (_, j) => codeChurn((j / 599) * tl.D)).sort((x, y) => x - y)
  const dry = clip[540], storm = clip[594]

  return {
    sky(u) {
      let x = 0, y = 0
      for (let j = 0; j < SKY_TAPS; j++) {
        const [vx, vy] = hourVec(u - (j * SKY_WINDOW) / SKY_TAPS)
        x += vx / SKY_TAPS
        y += vy / SKY_TAPS
      }
      return { hour: ((Math.atan2(y, x) / (2 * Math.PI)) * 24 + 24) % 24, r: Math.hypot(x, y) }
    },
    fog(u) {
      const k = stepAt(tl, u)
      if (k < 0 || k >= n - 1) return 0
      const strength = Math.min(1, Math.max(0, (c[k + 1][0] - c[k][0] - GAP_CAP) / FOG_RAMP))
      const len = tl.u[k + 1] - tl.u[k]
      return len > 0 ? strength * Math.sin((Math.PI * (u - tl.u[k])) / len) : 0
    },
    rain(u) {
      return storm > dry ? Math.min(1, Math.max(0, (codeChurn(u) - dry) / (storm - dry))) : 0
    },
  }
}
