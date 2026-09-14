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
const canvas = $<HTMLCanvasElement>('city'), tip = $<HTMLDivElement>('tip')
const city = createCity(canvas, model, lay, tl)
// A commit's author-local time as an ISO string ("2026-09-10T23:12:00.000Z" = 23:12 where the author was).
const local = (i: number) => { const [t, tz] = model.commits[i]; return new Date((t + tz * 60) * 1000).toISOString() }

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
  // Date only: the sky shows the recent commits' average hour, so a single commit's clock time would contradict it.
  const date = local(Math.max(i, 0)).slice(0, 10)
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
let press = { x: 0, y: 0 }
canvas.addEventListener('pointerdown', e => { press = { x: e.clientX, y: e.clientY } })
canvas.addEventListener('pointerup', e => {
  if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 5) return // a drag, not a click
  const p = city.pick(e.clientX, e.clientY, u)
  tip.hidden = !p
  if (!p) return
  tip.textContent = `${p.path}\n${p.loc.toLocaleString()} lines · since ${local(p.first).slice(0, 10)} · last touched ${local(p.last).slice(0, 10)}`
  tip.style.left = `${e.clientX + 12}px`
  tip.style.top = `${e.clientY + 12}px`
})
requestAnimationFrame(frame)
