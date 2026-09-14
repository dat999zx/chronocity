import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality, canEncodeVideo } from 'mediabunny'
import { headline, stepAt, TICK, type Timeline } from '@chronocity/core/timeline.ts'
import { cityTotals } from '@chronocity/core/stats.ts'
import type { Demo } from '@chronocity/core/model.ts'
import type { City } from './city.ts'

export const FPS = 30
export const SECONDS = 15
// ~9.5 MB per 15 s clip: fits Discord's 10 MB free upload limit, and social sites re-encode anyway.
// ('high' quality produced 22 Mbps / 42 MB at 1080p.)
export const BITRATE = 5_000_000
export const SHAPES = { landscape: [1920, 1080], vertical: [1080, 1920] } as const
export type Shape = keyof typeof SHAPES
export const WATERMARK = 'chronocity · dat999zx.github.io/chronocity'

export interface ClipContext {
  model: Demo
  tl: Timeline
  city: City
  churn: Float64Array
  upTo: Int32Array            // real commits so far at each step (commitsUpTo)
  span: number                // playback seconds the clip covers (D + TAIL)
  local(step: number): string // a step's author-local ISO timestamp
}

// The Clip button only shows where H.264 can be encoded at both clip sizes.
export async function canClip(): Promise<boolean> {
  if (!('VideoEncoder' in globalThis)) return false
  try {
    return (await canEncodeVideo('avc', { width: 1920, height: 1080 })) && (await canEncodeVideo('avc', { width: 1080, height: 1920 }))
  } catch {
    return false
  }
}

// The whole history as a 15 s MP4. Frame-stepped: each frame is rendered, composited and encoded before the next,
// so a slow machine renders slower but never drops a frame. Resolves null when cancelled.
export async function renderClip(ctx: ClipContext, shape: Shape, onProgress: (done: number, total: number) => void, signal: AbortSignal): Promise<Blob | null> {
  const [w, h] = SHAPES[shape]
  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const g = out.getContext('2d')!
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() })
  const video = new CanvasSource(out, { codec: 'avc', quality: new Quality({ bitrate: BITRATE, bitrateMode: 'variable' }) })
  output.addVideoTrack(video, { frameRate: FPS })
  await output.start()
  const total = FPS * SECONDS
  try {
    for (let k = 0; k < total; k++) {
      if (signal.aborted) {
        await output.cancel()
        return null
      }
      const u = (k / (total - 1)) * ctx.span
      // Same task as the WebGL render, so the frame is still in the drawing buffer (no preserveDrawingBuffer needed).
      g.drawImage(ctx.city.renderClip(u, w, h), 0, 0, w, h)
      drawOverlay(g, ctx, u, w, h)
      await video.add(k / FPS, 1 / FPS)
      onProgress(k + 1, total)
      if (k % 5 === 4) await new Promise(r => setTimeout(r)) // let the progress overlay paint
    }
    await output.finalize()
  } finally {
    ctx.city.endClip()
  }
  return new Blob([output.target.buffer!], { type: 'video/mp4' })
}

// Headline, repo name and "date · commits · lines" stacked bottom-left; the watermark bottom-right. Scaled to the frame.
function drawOverlay(g: CanvasRenderingContext2D, ctx: ClipContext, u: number, w: number, h: number) {
  const s = Math.min(w, h) / 1080, pad = 56 * s
  const { model, tl } = ctx
  const at = stepAt(tl, u), step = Math.max(0, at), commits = at >= 0 ? ctx.upTo[at] : 0
  const { loc } = cityTotals(model, tl, u)
  // The clip plays about 2.1× faster than the app, so widen the headline window to keep ~0.6 s per headline on screen.
  const head = headline(ctx.churn, tl, u, TICK * (ctx.span / SECONDS))
  g.save()
  g.fillStyle = '#fff'
  g.shadowColor = 'rgba(0,0,0,.75)'
  g.shadowBlur = 14 * s
  g.textAlign = 'right'
  g.globalAlpha = 0.75
  g.font = `500 ${22 * s}px system-ui, sans-serif`
  g.fillText(WATERMARK, w - pad, h - pad)
  g.textAlign = 'left'
  g.globalAlpha = 1
  let y = h - pad - 50 * s
  g.font = `400 ${32 * s}px system-ui, sans-serif`
  g.fillText(`${ctx.local(step).slice(0, 10)} · ${commits.toLocaleString('en-US')} commits · ${loc.toLocaleString('en-US')} lines`, pad, y)
  y -= 52 * s
  g.font = `700 ${46 * s}px system-ui, sans-serif`
  g.fillText(model.repo, pad, y)
  if (head >= 0) {
    y -= 64 * s
    g.globalAlpha = 0.9
    g.font = `400 ${28 * s}px system-ui, sans-serif`
    g.fillText(fit(g, model.commits[head][4], w - 2 * pad), pad, y)
  }
  g.restore()
}

// Truncate with an ellipsis to fit max pixels in the current font.
function fit(g: CanvasRenderingContext2D, text: string, max: number): string {
  if (g.measureText(text).width <= max) return text
  let t = text
  while (t && g.measureText(t + '…').width > max) t = t.slice(0, -1)
  return t + '…'
}
