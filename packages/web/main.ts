import { layout } from '@chronocity/core/layout.ts'
import { timeline, stepAt, sampleAt, codeChurn } from '@chronocity/core/timeline.ts'
import type { Demo } from '@chronocity/core/model.ts'
import { createCity, RISE } from './city.ts'
import { createPanel } from './panel.ts'
import type { Selection } from './selection.ts'
import { createTicker } from './ticker.ts'
import { createActivity } from './activity.ts'

const D = 30, TAIL = 1.5 // playback seconds for the whole history, plus a hold at the end
const $ = <T extends Element>(id: string) => document.getElementById(id) as Element as T
const hudEl = $<HTMLDivElement>('hud'), playBtn = $<HTMLButtonElement>('play')
const scrub = $<HTMLInputElement>('scrub'), speed = $<HTMLSelectElement>('speed')
const canvas = $<HTMLCanvasElement>('city'), hoverEl = $<HTMLDivElement>('hover')

const res = await fetch('demos/knowl.json')
if (!res.ok) {
  hudEl.textContent = `could not load the demo (${res.status})`
  throw new Error(`demo fetch ${res.status}`)
}
const model: Demo = await res.json()
const format: number = model.v // widened, so the check below doesn't narrow `model` to never
if (format !== 2) {
  hudEl.textContent = 'this demo was baked by an older chronocity; re-bake it'
  throw new Error(`demo format v${format}`)
}
const lay = layout(model.files.map(f => f[0]))
const tl = timeline(model, D)
const city = createCity(canvas, model, lay, tl)
// A step's author-local time as an ISO string ("2026-09-10T23:12:00.000Z" = 23:12 where the author was).
const local = (i: number) => { const [t, tz] = model.commits[i]; return new Date((t + tz * 60) * 1000).toISOString() }
const panel = createPanel($<HTMLDivElement>('panel'), $<SVGSVGElement>('leader'), { model, lay, tl, local, select })
const churn = codeChurn(model)
const ticker = createTicker($<HTMLDivElement>('ticker'), model, tl, churn, local)
const bars = createActivity($<HTMLCanvasElement>('activity'), churn, tl, D + TAIL)

const q = new URLSearchParams(location.search) // ?u=12.5 opens paused there; ?select=<path | folder | /> opens its panel
let u = q.has('u') ? +q.get('u')! : 0
let playing = !q.has('u')
let last = performance.now()
let sel: Selection | null = null

function select(next: Selection | null) {
  sel = next
  city.select(next)
  panel.show(next, u)
  const url = new URL(location.href)
  if (next) url.searchParams.set('select', next.kind === 'file' ? model.files[next.index][0] : lay.districts[next.index][5] || '/')
  else url.searchParams.delete('select')
  history.replaceState(null, '', url)
}

function togglePlay() {
  playing = !playing
  if (playing && u >= D + TAIL) u = 0
}

// Step to the neighbouring commit and hold just after its buildings have risen.
function stepBy(dir: 1 | -1) {
  const k = stepAt(tl, u) + dir
  if (k < 0 || k >= tl.u.length) return
  const next = k + 1 < tl.u.length ? tl.u[k + 1] - 1e-6 : Infinity
  u = Math.max(tl.u[k], Math.min(tl.u[k] + RISE, next))
  playing = false
}

scrub.max = String(D + TAIL)
playBtn.onclick = togglePlay
scrub.oninput = () => { u = +scrub.value; playing = false }
addEventListener('keydown', e => {
  const t = e.target
  if (t instanceof HTMLSelectElement || (t instanceof HTMLInputElement && t.type !== 'range')) return
  if (t instanceof HTMLButtonElement && (e.code === 'Space' || e.key === 'Enter')) return // the button handles it
  if (e.code === 'Space') togglePlay()
  else if (e.key === 'ArrowRight') stepBy(1)
  else if (e.key === 'ArrowLeft') stepBy(-1)
  else if (e.key === 'Escape') select(null)
  else return
  e.preventDefault()
})

let press = { x: 0, y: 0 }, dragging = false, pointer: { x: number; y: number } | null = null
canvas.addEventListener('pointerdown', e => { press = { x: e.clientX, y: e.clientY }; dragging = true })
addEventListener('pointerup', () => { dragging = false })
canvas.addEventListener('pointerup', e => {
  if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 5) return // a drag, not a click
  select(city.pick(e.clientX, e.clientY))
})
canvas.addEventListener('pointermove', e => { pointer = { x: e.clientX, y: e.clientY } })
canvas.addEventListener('pointerleave', () => { pointer = null })

function updateHover() {
  const h = pointer && !dragging ? city.pick(pointer.x, pointer.y) : null
  city.hover(h)
  const label = !h ? '' : h.kind === 'file' ? model.files[h.index][0] : lay.districts[h.index][5] ? lay.districts[h.index][5] + '/' : model.repo
  canvas.style.cursor = label ? 'pointer' : ''
  hoverEl.hidden = !label
  if (label && pointer) {
    hoverEl.textContent = label
    hoverEl.style.left = `${pointer.x + 14}px`
    hoverEl.style.top = `${pointer.y + 14}px`
  }
}

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
  ticker.update(u, playing)
  bars.draw(u)
  panel.update(u, sel ? city.anchor(sel) : null)
  updateHover()
  requestAnimationFrame(frame)
}

city.render(u) // once up front, so buildings have heights before a ?select= flight is planned
const want = q.get('select')
if (want !== null) {
  const f = model.files.findIndex(([p]) => p === want)
  const d = lay.districts.findIndex(dd => dd[5] === (want === '/' ? '' : want))
  if (f >= 0) select({ kind: 'file', index: f })
  else if (d >= 0) select({ kind: 'district', index: d })
}
requestAnimationFrame(frame)
