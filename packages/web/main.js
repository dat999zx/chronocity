import { layout } from '@chronocity/core/layout.js'
import { timeline, stepAt, sampleAt } from '@chronocity/core/timeline.js'
import { createCity } from './city.js'

const D = 30, TAIL = 1.5 // playback seconds for the whole history, plus a hold at the end
const $ = id => document.getElementById(id)

const res = await fetch('demos/knowl.json')
if (!res.ok) {
  $('hud').textContent = `could not load the demo (${res.status})`
  throw new Error(`demo fetch ${res.status}`)
}
const model = await res.json()
const lay = layout(model.files.map(f => f[0]))
const tl = timeline(model, D)
const city = createCity($('city'), model, lay, tl)

const q = new URLSearchParams(location.search) // ?u=12.5 opens paused at that moment
let u = q.has('u') ? +q.get('u') : 0
let playing = !q.has('u')
let last = performance.now()

$('scrub').max = D + TAIL
$('play').onclick = () => {
  playing = !playing
  if (playing && u >= D + TAIL) u = 0
}
$('scrub').oninput = e => { u = +e.target.value; playing = false }

function hud() {
  const i = stepAt(tl, u)
  let files = 0, loc = 0
  for (const [, s] of model.files) {
    const k = sampleAt(tl, s, u)
    if (k >= 0 && s[k][1] > 0) { files++; loc += s[k][1] }
  }
  const [t, tz] = model.commits[Math.max(i, 0)]
  const date = new Date((t + tz * 60) * 1000).toISOString().slice(0, 10) // the author's local date
  $('hud').textContent = `${model.repo} · ${date} · commit ${i + 1}/${model.commits.length} · ${files} files · ${loc.toLocaleString()} lines`
}

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000)
  last = now
  if (playing) {
    u = Math.min(D + TAIL, u + dt * +$('speed').value)
    if (u >= D + TAIL) playing = false
  }
  $('play').textContent = playing ? '❚❚' : '▶'
  $('scrub').value = u
  city.render(u)
  hud()
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
