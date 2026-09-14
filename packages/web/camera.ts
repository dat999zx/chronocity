import { stepAt, type Timeline } from '@chronocity/core/timeline.ts'
import type { CityLayout } from '@chronocity/core/layout.ts'
import type { FileHistory } from '@chronocity/core/model.ts'

export const ORBIT = 0.05 // radians per playback second (tuning knob)
export const FRAME = 2.0  // camera distance per unit of built-up radius (tuning knob)
export const ELEV = 0.55  // camera height per unit of distance: ~29° down, low enough to read as a skyline
export const WIDE = 1.6   // the aspect FRAME was tuned for
export const NARROW_PULL = 0.85 // how much narrower frames (vertical clips, phones) pull the camera back (tuning knob)

// Radius of the built-up area at each step: the farthest lot (from the centre) of any file that has appeared.
export function extents(files: FileHistory[], lay: CityLayout, steps: number): Float64Array {
  const ext = new Float64Array(steps), c = lay.size / 2
  for (const [path, s] of files) {
    const [x, z, w, d] = lay.lots.get(path)!
    const r = Math.hypot(Math.max(Math.abs(x - c), Math.abs(x + w - c)), Math.max(Math.abs(z - c), Math.abs(z + d - c)))
    ext[s[0][0]] = Math.max(ext[s[0][0]], r)
  }
  for (let i = 1; i < steps; i++) ext[i] = Math.max(ext[i], ext[i - 1])
  return ext
}

// Pure in u: a slow orbit whose distance follows the built-up radius, averaged over the last 2 s so it glides.
export function autoCamera(u: number, tl: Timeline, ext: Float64Array, S: number, aspect = WIDE) {
  let r = 0
  for (let k = 0; k < 8; k++) r += ext[Math.max(0, stepAt(tl, u - k * 0.25))] / 8
  const dist = Math.max(S * 0.25, r) * FRAME * Math.max(1, WIDE / aspect) ** NARROW_PULL
  const a = Math.PI / 4 + u * ORBIT
  return { x: Math.sin(a) * dist, y: dist * ELEV, z: Math.cos(a) * dist }
}
