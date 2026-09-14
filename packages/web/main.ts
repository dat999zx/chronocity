import { layout } from '@chronocity/core/layout.ts'
import { timeline, stepAt, codeChurn } from '@chronocity/core/timeline.ts'
import { cityTotals, commitsUpTo } from '@chronocity/core/stats.ts'
import type { Demo } from '@chronocity/core/model.ts'
import { createCity, RISE } from './city.ts'
import { createPanel } from './panel.ts'
import { createTicker } from './ticker.ts'
import { createActivity } from './activity.ts'
import type { Selection } from './selection.ts'
import { canClip, renderClip, SHAPES, type Shape } from './clip.ts'
import { createIntro, type GalleryEntry } from './intro.ts'
import { loadLocal } from './local.ts'
import { createEffectsMenu, loadEffects } from './effects.ts'

const D = 30, TAIL = 1.5 // playback seconds for the whole history, plus a hold at the end
const $ = <T extends Element>(id: string) => document.getElementById(id) as Element as T
const hudEl = $<HTMLDivElement>('hud'), playBtn = $<HTMLButtonElement>('play')
const scrub = $<HTMLInputElement>('scrub'), speed = $<HTMLSelectElement>('speed')
const canvas = $<HTMLCanvasElement>('city'), hoverEl = $<HTMLDivElement>('hover')
const repoSel = $<HTMLSelectElement>('repo')

// ?repo=<name> picks a gallery demo · ?u=12.5 opens paused there · ?select=<path | folder | /> opens its panel
const q = new URLSearchParams(location.search)
if (q.get('ui') === '0') document.body.classList.add('bare') // clean stills: README hero, link previews

async function load<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-cache' }) // revalidate: Pages says max-age=600, which hid a new demo for 10 min

  if (!res.ok) {
    hudEl.textContent = `could not load ${url} (${res.status})`
    throw new Error(`${url}: ${res.status}`)
  }
  return res.json()
}
const gallery = await load<GalleryEntry[]>('demos/index.json')
const mine = await loadLocal().catch(() => null) // the last repo you dropped, kept in this browser only
const localEntry: GalleryEntry | null = mine && { name: 'local', repo: mine.repo, about: mine.about }
const [demo, model]: [GalleryEntry, Demo] = q.get('repo') === 'local' && mine && localEntry
  ? [localEntry, mine]
  : await (async () => {
    const d = gallery.find(g => g.name === q.get('repo')) ?? gallery[0] // only listed names ever reach a URL
    return [d, await load<Demo>(`demos/${d.name}.json`)] as [GalleryEntry, Demo]
  })()
const format: number = model.v // widened, so the check below doesn't narrow `model` to never
if (format !== 3) {
  hudEl.textContent = 'this demo was baked by an older chronocity; re-bake it'
  throw new Error(`demo format v${format}`)
}
const openRepo = (name: string) => { location.search = `?repo=${encodeURIComponent(name)}` }
for (const d of [...gallery, ...(localEntry ? [localEntry] : [])])
  repoSel.append(new Option(d.name === 'local' ? d.repo : d.name, d.name, false, d.name === demo.name))
repoSel.onchange = () => openRepo(repoSel.value)
repoSel.hidden = repoSel.options.length < 2 // one demo and nothing dropped yet: nothing to switch between

const lay = layout(model.files.map(f => f[0]))
const tl = timeline(model, D)
const upTo = commitsUpTo(model), totalCommits = upTo[upTo.length - 1] ?? 0
const fx = loadEffects()
const city = createCity(canvas, model, lay, tl, fx)
const fxMenu = $<HTMLDivElement>('fxmenu')
createEffectsMenu($<HTMLButtonElement>('fx'), fxMenu, fx)
// A step's author-local time as an ISO string ("2026-09-10T23:12:00.000Z" = 23:12 where the author was).
const local = (i: number) => { const [t, tz] = model.commits[i]; return new Date((t + tz * 60) * 1000).toISOString() }
const panel = createPanel($<HTMLDivElement>('panel'), $<SVGSVGElement>('leader'), { model, lay, tl, local, select })
const churn = codeChurn(model)
const ticker = createTicker($<HTMLDivElement>('ticker'), model, tl, churn, local)
const bars = createActivity($<HTMLCanvasElement>('activity'), churn, tl, D + TAIL)

// The intro card: once per visit (per browser session), reopened with ⓘ. Clean stills (?ui=0) never show it.
const intro = createIntro($<HTMLDivElement>('intro'), { gallery, current: demo, commits: totalCommits, local: localEntry, open: openRepo })
$<HTMLButtonElement>('about').onclick = () => intro.show()
if (q.get('ui') !== '0' && !sessionStorage.getItem('chronocity:intro-seen')) {
  sessionStorage.setItem('chronocity:intro-seen', '1')
  intro.show()
}
const clipBtn = $<HTMLButtonElement>('clip'), clipMenu = $<HTMLSpanElement>('clipmenu')
const clipping = $<HTMLDivElement>('clipping'), clipMsg = $<HTMLDivElement>('clipmsg')
const clipBar = $<HTMLProgressElement>('clipbar'), clipCancel = $<HTMLButtonElement>('clipcancel')
let busy: AbortController | null = null // set while a clip renders; the render loop pauses

canClip().then(ok => { clipBtn.hidden = !ok })
clipBtn.onclick = () => { clipMenu.hidden = !clipMenu.hidden }
clipMenu.querySelectorAll('button').forEach(b => { b.onclick = () => exportClip(b.dataset.shape as Shape) })
clipCancel.onclick = () => { if (busy) busy.abort(); else clipping.hidden = true }

async function exportClip(shape: Shape) {
  clipMenu.hidden = true
  select(null)
  playing = false
  busy = new AbortController()
  clipping.hidden = false
  clipCancel.textContent = 'Cancel'
  const [w, h] = SHAPES[shape], t0 = performance.now()
  clipMsg.textContent = `Rendering ${w}×${h}…`
  clipBar.value = 0
  try {
    const blob = await renderClip({ model, tl, city, churn, upTo, span: D + TAIL, local }, shape, (done, total) => {
      const left = (((performance.now() - t0) / done) * (total - done)) / 1000
      clipMsg.textContent = `Rendering ${w}×${h} · ${Math.round((done / total) * 100)}% · ~${Math.ceil(left)} s left`
      clipBar.value = done / total
    }, busy.signal)
    clipping.hidden = true
    if (blob) {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      const slug = (model.repo.split('/').pop() || 'repo').replace(/[^\w.-]+/g, '-')
      a.download = `chronocity-${slug}-${shape === 'landscape' ? '16x9' : '9x16'}.mp4`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 60_000)
    }
  } catch (e) {
    clipMsg.textContent = `Couldn't render the clip: ${(e as Error).message}`
    clipCancel.textContent = 'Close'
  } finally {
    busy = null
  }
}

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

// Drive mode: the car has its own keys (WASD / arrows / Shift); Space still plays and pauses the replay around it.
const driveBtn = $<HTMLButtonElement>('drive'), driveHint = $<HTMLDivElement>('drivehint')
let hintTimer = 0
function toggleDrive(on = !city.driving) {
  if (on) select(null)
  city.drive(on)
  driveBtn.textContent = on ? 'Exit drive' : '🚗 Drive'
  driveHint.hidden = !on
  clearTimeout(hintTimer)
  if (on) hintTimer = setTimeout(() => { driveHint.hidden = true }, 6000) // the keys stay in the button's tooltip
  driveBtn.blur() // so Space and Enter go to the car, not back to this button
}
driveBtn.onclick = () => toggleDrive()

scrub.max = String(D + TAIL)
playBtn.onclick = togglePlay
scrub.oninput = () => { u = +scrub.value; playing = false }
addEventListener('keydown', e => {
  const t = e.target
  if (t instanceof HTMLSelectElement || (t instanceof HTMLInputElement && t.type !== 'range')) return
  if (t instanceof HTMLButtonElement && (e.code === 'Space' || e.key === 'Enter')) return // the button handles it
  if (city.driving && e.key.startsWith('Arrow')) return // steering, not stepping commits
  if (e.code === 'Space') togglePlay()
  else if (e.key === 'ArrowRight') stepBy(1)
  else if (e.key === 'ArrowLeft') stepBy(-1)
  else if (e.key === 'Enter' && city.driving) select(city.ahead())
  else if (e.key === 'Escape') {
    if (busy) busy.abort()
    else if (intro.isOpen) intro.hide()
    else if (!fxMenu.hidden) fxMenu.hidden = true
    else if (sel) select(null)
    else if (city.driving) toggleDrive(false)
  }
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

// The label under the cursor, or while driving, the name of the building in front of the car, pinned to its roof.
function updateHover() {
  const h = city.driving ? city.ahead() : pointer && !dragging ? city.pick(pointer.x, pointer.y) : null
  city.hover(h)
  const label = !h ? '' : h.kind === 'file' ? model.files[h.index][0] : lay.districts[h.index][5] ? lay.districts[h.index][5] + '/' : model.repo
  const at = city.driving ? h && city.anchor(h) : pointer
  canvas.style.cursor = label && !city.driving ? 'pointer' : ''
  hoverEl.hidden = !label || !at
  if (label && at) {
    hoverEl.textContent = label
    hoverEl.style.left = `${at.x + 14}px`
    hoverEl.style.top = `${at.y + 14}px`
  }
}

function hud() {
  const i = stepAt(tl, u), { files, loc } = cityTotals(model, tl, u)
  // Date only: the sky shows the recent commits' average hour, so a single commit's clock time would contradict it.
  const date = local(Math.max(i, 0)).slice(0, 10)
  const done = i >= 0 ? upTo[i] : 0 // real commits so far, merged branches included (GitHub's count, not main-line steps)
  hudEl.textContent = `${model.repo} · ${date} · commit ${done.toLocaleString()}/${totalCommits.toLocaleString()} · ${files} files · ${loc.toLocaleString()} lines`
}

function frame(now: number) {
  // A clip owns the renderer, or a dropped repo is replaying under the card (on a software-WebGL machine the city would
  // take the worker's CPU: an 11k-commit repo went from ~1 min to ~13). Keep the clock fresh so playback doesn't jump.
  if (busy || intro.replaying) {
    last = now
    requestAnimationFrame(frame)
    return
  }
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
