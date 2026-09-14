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
