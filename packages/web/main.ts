import { layout } from '@chronocity/core/layout.ts'
import { timeline, stepAt, sampleAt } from '@chronocity/core/timeline.ts'
import type { Demo } from '@chronocity/core/model.ts'
import { createCity } from './city.ts'

const D = 30, TAIL = 1.5 // playback seconds for the whole history, plus a hold at the end
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const hudEl = $<HTMLDivElement>('hud'), playBtn = $<HTMLButtonElement>('play')
const scrub = $<HTMLInputElement>('scrub'), speed = $<HTMLSelectElement>('speed')

const res = await fetch('demos/knowl.json')
if (!res.ok) {
  hudEl.textContent = `could not load the demo (${res.status})`
  throw new Error(`demo fetch ${res.status}`)
}
const model: Demo = await res.json()
const lay = layout(model.files.map(f => f[0]))
const tl = timeline(model, D)
const city = createCity($<HTMLCanvasElement>('city'), model, lay, tl)

const q = new URLSearchParams(location.search) // ?u=12.5 opens paused at that moment
let u = q.has('u') ? +q.get('u')! : 0
let playing = !q.has('u')
let last = performance.now()

scrub.max = String(D + TAIL)
playBtn.onclick = () => {
  playing = !playing
  if (playing && u >= D + TAIL) u = 0
}
scrub.oninput = () => { u = +scrub.value; playing = false }

function hud() {
  const i = stepAt(tl, u)
  let files = 0, loc = 0
  for (const [, s] of model.files) {
    const k = sampleAt(tl, s, u)
    if (k >= 0 && s[k][1] > 0) { files++; loc += s[k][1] }
  }
  const [t, tz] = model.commits[Math.max(i, 0)]
  const date = new Date((t + tz * 60) * 1000).toISOString().slice(0, 10) // the author's local date
  hudEl.textContent = `${model.repo} · ${date} · commit ${i + 1}/${model.commits.length} · ${files} files · ${loc.toLocaleString()} lines`
}

function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000)
  last = now
  if (playing) {
    u = Math.min(D + TAIL, u + dt * +speed.value)
    if (u >= D + TAIL) playing = false
  }
  playBtn.textContent = playing ? '❚❚' : '▶'
  scrub.value = String(u)
  city.render(u)
  hud()
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
