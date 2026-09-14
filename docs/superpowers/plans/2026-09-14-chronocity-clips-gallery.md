# chronocity Clips + Gallery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- One-click 15 s MP4 clips (landscape 1920×1080 or vertical 1080×1920) with a title/counter/watermark overlay, rendered frame by frame;
- a demo gallery (knowl + chronocity);
- a launch README with link-preview metadata.

**Architecture:**
- `core/stats.ts` gains `cityTotals()`.
- `bake.ts` maintains `demos/index.json`, and `main.ts` picks `?repo=`.
- `city.ts` gains a clip mode (`renderClip(u, w, h)` / `endClip()`): fixed size, auto camera, nothing time-based.
- `web/clip.ts` renders 450 frames, composites the overlay on a 2D canvas, and encodes H.264 into MP4 with Mediabunny.
- `scripts/drive.mjs` drives Chrome over the DevTools protocol to click the real button, capture the download, and check it.

**Tech Stack:** TypeScript, Vite 8, three 0.186, mediabunny 1.56 (`Output`, `Mp4OutputFormat`, `BufferTarget`, `CanvasSource`, `QUALITY_HIGH`, `canEncodeVideo`; in Node for probing: `Input`, `ALL_FORMATS`, `FilePathSource`), `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-14-chronocity-clips-gallery-design.md`

## Global Constraints

- TypeScript rules: erasable syntax only, `.ts` import extensions, `import type` for types. `npm test` and `npm run typecheck` must pass after every task.
- Clip frames must be a pure function of `u`: no `performance.now()`, no spotlight fade, no fly-to while clipping.
- Repo text is untrusted. In the DOM it goes through `textContent`; in the clip it is only ever `fillText`'d. Gallery names in URLs come only from `index.json` entries, and bake names must match `/^[a-z0-9-]+$/`.
- Demos are baked from fresh clones under `.bake/` (gitignored), never from someone's local checkout.
- Don't push. Task 6 ends by asking the user.
- Chrome on this machine: `C:/Program Files/Google/Chrome/Application/chrome.exe`. For headless WebGL use `--use-angle=swiftshader --enable-unsafe-swiftshader`. Software rendering is slow, so a 450-frame clip takes minutes headless; allow up to 15 minutes per clip.

## File Structure

```
packages/core/stats.ts        MOD  + cityTotals()
packages/core/test.ts         MOD  + cityTotals test
packages/bake/bake.ts         MOD  name check + demos/index.json upsert
packages/web/public/demos/index.json      NEW (generated)
packages/web/public/demos/chronocity.json NEW (generated)
packages/web/camera.ts        MOD  aspect-aware framing
packages/web/city.ts          MOD  drawScene(), renderClip(), endClip()
packages/web/clip.ts          NEW  canClip(), renderClip(): frame-stepped MP4 with overlay
packages/web/main.ts          REWRITE gallery + cityTotals HUD (Task 2); clip wiring (Task 4)
packages/web/index.html       MOD  repo select, clip button/menu/overlay, meta tags, ?ui=0
packages/web/public/og.png    NEW  1200×630 link-preview image (also the README hero)
scripts/drive.mjs             NEW  Chrome DevTools-protocol driver (mouse, keys, eval, shots, downloads)
README.md                     NEW
package.json                  MOD  "drive" script
```

---

### Task 1: `cityTotals()`

**Files:**
- Modify: `packages/core/stats.ts`
- Test: `packages/core/test.ts` (append)

**Interfaces:**
- Produces: `interface Totals { files: number; loc: number }` and `cityTotals(model, tl, u): Totals`, counting standing files and their lines at `u`.

- [ ] **Step 1: Append the failing test**

Change the stats import at the top of `packages/core/test.ts` to:
```ts
import { fileStats, districtStats, series, cityTotals } from './stats.ts'
```
Append (`statsModel`/`statsTl` already exist above):
```ts
test('cityTotals: standing files and lines at u', () => {
  assert.deepEqual(cityTotals(statsModel, statsTl, -1), { files: 0, loc: 0 })
  assert.deepEqual(cityTotals(statsModel, statsTl, 1.5), { files: 3, loc: 116 }) // a.ts 12 + b.md 4 + c.json 100
  assert.deepEqual(cityTotals(statsModel, statsTl, 2), { files: 2, loc: 104 })   // a.ts demolished
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`. Expected: FAIL, since `stats.ts` does not export `cityTotals`.

- [ ] **Step 3: Implement**

Append to `packages/core/stats.ts`:
```ts
export interface Totals { files: number; loc: number }

// Standing files and their lines at playback time u: the HUD and the clip overlay.
export function cityTotals(model: Model, tl: Timeline, u: number): Totals {
  let files = 0, loc = 0
  for (const [, s] of model.files) {
    const k = sampleAt(tl, s, u)
    if (k >= 0 && s[k][1] > 0) {
      files++
      loc += s[k][1]
    }
  }
  return { files, loc }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test && npm run typecheck`. Expected: `ℹ pass 28`, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core/stats.ts packages/core/test.ts
git commit -m "core: cityTotals for the HUD and clip overlay"
```

---

### Task 2: Gallery

**Files:**
- Modify: `packages/bake/bake.ts`, `packages/web/index.html`
- Replace: `packages/web/main.ts`
- Generate: `packages/web/public/demos/index.json`, `packages/web/public/demos/chronocity.json`

**Interfaces:**
- Produces:
  - `demos/index.json`: `[{ name, repo, steps, files }]`, where the first entry is the default;
  - URL `?repo=<name>`;
  - `main.ts` constants `demo` (`{ name, repo }`) and `model`;
  - the HUD now uses `cityTotals`.

- [ ] **Step 1: Bake writes the index**

In `packages/bake/bake.ts`, replace:
```ts
if (!repoPath || !name) {
  console.error('usage: node packages/bake/bake.ts <repoPath> <name> [label] [ref]')
  process.exit(1)
}
```
with:
```ts
if (!repoPath || !name) {
  console.error('usage: node packages/bake/bake.ts <repoPath> <name> [label] [ref]')
  process.exit(1)
}
if (!/^[a-z0-9-]+$/.test(name)) {
  console.error(`demo name must be lowercase letters, digits and dashes (it ends up in paths and URLs): ${name}`)
  process.exit(1)
}
```
Append to the end of the file:
```ts
// demos/index.json lists the gallery. Upsert this demo, keeping order: the first entry is the default demo.
type Entry = { name: string; repo: string; steps: number; files: number }
const indexFile = fileURLToPath(new URL('../web/public/demos/index.json', import.meta.url))
const index: Entry[] = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : []
const entry: Entry = { name, repo: label, steps: model.commits.length, files: model.files.length }
const at = index.findIndex(e => e.name === name)
if (at >= 0) index[at] = entry
else index.push(entry)
fs.writeFileSync(indexFile, JSON.stringify(index, null, 2) + '\n')
console.error(`gallery: ${index.map(e => e.name).join(', ')}`)
```

- [ ] **Step 2: Bake both demos (knowl first, so it's the default)**

```bash
test -d .bake/knowl || git clone --quiet https://github.com/dat999zx/knowl .bake/knowl
node packages/bake/bake.ts .bake/knowl knowl dat999zx/knowl main
test -d .bake/chronocity && git -C .bake/chronocity pull --quiet || git clone --quiet https://github.com/dat999zx/chronocity .bake/chronocity
node packages/bake/bake.ts .bake/chronocity chronocity dat999zx/chronocity main
cat packages/web/public/demos/index.json
git status --short packages/web/public/demos
```
Expected:
- the bakes print `738 steps, 1135 files` and then about `28+ steps, 51+ files`;
- `index.json` lists knowl first, then chronocity;
- `knowl.json` is unchanged, since the bake is deterministic, so `git status` shows only `index.json` and `chronocity.json` as new.

- [ ] **Step 3: Repo select in the bar**

In `packages/web/index.html`, replace:
```html
  <button id="play" aria-label="Play or pause">▶</button>
```
with:
```html
  <select id="repo" aria-label="Demo repo"></select>
  <button id="play" aria-label="Play or pause">▶</button>
```

- [ ] **Step 4: Replace `packages/web/main.ts`**

```ts
import { layout } from '@chronocity/core/layout.ts'
import { timeline, stepAt, codeChurn } from '@chronocity/core/timeline.ts'
import { cityTotals } from '@chronocity/core/stats.ts'
import type { Demo } from '@chronocity/core/model.ts'
import { createCity, RISE } from './city.ts'
import { createPanel } from './panel.ts'
import { createTicker } from './ticker.ts'
import { createActivity } from './activity.ts'
import type { Selection } from './selection.ts'

const D = 30, TAIL = 1.5 // playback seconds for the whole history, plus a hold at the end
const $ = <T extends Element>(id: string) => document.getElementById(id) as Element as T
const hudEl = $<HTMLDivElement>('hud'), playBtn = $<HTMLButtonElement>('play')
const scrub = $<HTMLInputElement>('scrub'), speed = $<HTMLSelectElement>('speed')
const canvas = $<HTMLCanvasElement>('city'), hoverEl = $<HTMLDivElement>('hover')
const repoSel = $<HTMLSelectElement>('repo')

// ?repo=<name> picks a gallery demo · ?u=12.5 opens paused there · ?select=<path | folder | /> opens its panel
const q = new URLSearchParams(location.search)

async function load<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    hudEl.textContent = `could not load ${url} (${res.status})`
    throw new Error(`${url}: ${res.status}`)
  }
  return res.json()
}
const gallery = await load<{ name: string; repo: string }[]>('demos/index.json')
const demo = gallery.find(d => d.name === q.get('repo')) ?? gallery[0] // only listed names ever reach a URL
const model = await load<Demo>(`demos/${demo.name}.json`)
const format: number = model.v // widened, so the check below doesn't narrow `model` to never
if (format !== 2) {
  hudEl.textContent = 'this demo was baked by an older chronocity; re-bake it'
  throw new Error(`demo format v${format}`)
}
for (const d of gallery) repoSel.append(new Option(d.name, d.name, false, d === demo))
repoSel.onchange = () => { location.search = `?repo=${encodeURIComponent(repoSel.value)}` }

const lay = layout(model.files.map(f => f[0]))
const tl = timeline(model, D)
const city = createCity(canvas, model, lay, tl)
// A step's author-local time as an ISO string ("2026-09-10T23:12:00.000Z" = 23:12 where the author was).
const local = (i: number) => { const [t, tz] = model.commits[i]; return new Date((t + tz * 60) * 1000).toISOString() }
const panel = createPanel($<HTMLDivElement>('panel'), $<SVGSVGElement>('leader'), { model, lay, tl, local, select })
const churn = codeChurn(model)
const ticker = createTicker($<HTMLDivElement>('ticker'), model, tl, churn, local)
const bars = createActivity($<HTMLCanvasElement>('activity'), churn, tl, D + TAIL)

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
  const i = stepAt(tl, u), { files, loc } = cityTotals(model, tl, u)
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
```

- [ ] **Step 5: Verify**

Run `npm run typecheck && npm test` (clean, 28 passing). Start `npm run dev`, then:
```bash
OUT="$(cygpath -w "$PWD/.shots")"; PROF="$(cygpath -w "$TEMP/chrono-chrome")"; C="/c/Program Files/Google/Chrome/Application/chrome.exe"
for m in "warm|u=0" "g-chrono|repo=chronocity&u=31.5" "g-bogus|repo=../x&u=31.5"; do n=${m%%|*}; q=${m#*|}; "$C" --headless=new --user-data-dir="$PROF" --use-angle=swiftshader --enable-unsafe-swiftshader --window-size=1280,800 --virtual-time-budget=9000 --screenshot="$OUT\\$n.png" "http://localhost:5173/?$q" 2>&1 | grep -o 'written to file.*'; done
```
Expected:
- `g-chrono` shows a small city with the HUD `dat999zx/chronocity · … · commit 28/28 …`, and the bar's select reads `chronocity`;
- `g-bogus` falls back to knowl (an unknown name is ignored).

- [ ] **Step 6: Commit**

```bash
git add packages/bake/bake.ts packages/web/index.html packages/web/main.ts packages/web/public/demos
git commit -m "gallery: demos/index.json from bake, ?repo= switcher, chronocity demo"
```

---

### Task 3: Clip mode in the city

**Files:**
- Modify: `packages/web/camera.ts`, `packages/web/city.ts`

**Interfaces:**
- Produces:
  - `autoCamera(u, tl, ext, S, aspect = WIDE)`;
  - `City.renderClip(u, w, h): HTMLCanvasElement`, which renders one clip frame at w×h and returns the WebGL canvas holding it;
  - `City.endClip(): void`.

- [ ] **Step 1: Aspect-aware auto camera**

In `packages/web/camera.ts`, replace:
```ts
export const ELEV = 0.55  // camera height per unit of distance: ~29° down, low enough to read as a skyline
```
with:
```ts
export const ELEV = 0.55  // camera height per unit of distance: ~29° down, low enough to read as a skyline
export const WIDE = 1.6   // the aspect FRAME was tuned for
export const NARROW_PULL = 0.85 // how much narrower frames (vertical clips, phones) pull the camera back (tuning knob)
```
and replace:
```ts
export function autoCamera(u: number, tl: Timeline, ext: Float64Array, S: number) {
  let r = 0
  for (let k = 0; k < 8; k++) r += ext[Math.max(0, stepAt(tl, u - k * 0.25))] / 8
  const dist = Math.max(S * 0.25, r) * FRAME
```
with:
```ts
export function autoCamera(u: number, tl: Timeline, ext: Float64Array, S: number, aspect = WIDE) {
  let r = 0
  for (let k = 0; k < 8; k++) r += ext[Math.max(0, stepAt(tl, u - k * 0.25))] / 8
  const dist = Math.max(S * 0.25, r) * FRAME * Math.max(1, WIDE / aspect) ** NARROW_PULL
```

- [ ] **Step 2: Clip mode in `packages/web/city.ts`**

Make these five edits:

1. In `interface City`, after the `anchor(...)` line, add:
```ts
  /** Render one clip frame at w×h (auto camera, no spotlight or hover, nothing time-based); returns the WebGL canvas. */
  renderClip(u: number, w: number, h: number): HTMLCanvasElement
  /** Back to the on-screen size and interactive state after a clip. */
  endClip(): void
```

2. Replace:
```ts
  let spotTarget = 0, lastNow = performance.now()
```
with:
```ts
  let spotTarget = 0, lastNow = performance.now(), clipping = false
```

3. In `autoPose`, replace:
```ts
    const p = autoCamera(u, tl, ext, S)
```
with:
```ts
    const p = autoCamera(u, tl, ext, S, camera.aspect)
```

4. Replace the whole `resize` function and the two lines after it:
```ts
  function resize() {
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false)
    composer.setSize(canvas.clientWidth, canvas.clientHeight)
    camera.aspect = canvas.clientWidth / canvas.clientHeight
    camera.updateProjectionMatrix()
  }
  resize()
  addEventListener('resize', resize)
```
with:
```ts
  function resize() {
    if (clipping) return // a clip owns the canvas size until endClip()
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false)
    composer.setSize(canvas.clientWidth, canvas.clientHeight)
    camera.aspect = canvas.clientWidth / canvas.clientHeight
    camera.updateProjectionMatrix()
  }
  resize()
  addEventListener('resize', resize)

  // Everything after the camera: sky, weather, buildings, windows, bloom. Pure in u.
  function drawScene(u: number) {
    const wet = sig.rain(u)
    night.value = sky.update(sig.sky(u), sig.fog(u), wet, camera.position.length()).night
    rain.update(u, wet)
    for (let i = 0; i < files.length; i++) {
      const f = files[i], k = sampleAt(tl, f.s, u), h = heightAt(f, k, u)
      f.h = h
      glow.setX(i, k < 0 ? 0 : Math.max(0, 1 - (u - tl.u[f.s[k][0]]) / GLOW))
      if (h < 1e-3) m.makeScale(0, 0, 0)
      else m.makeScale(f.w, h, f.d).setPosition(f.x, 0, f.z)
      mesh.setMatrixAt(i, m)
    }
    mesh.instanceMatrix.needsUpdate = true
    glow.needsUpdate = true
    bloom.strength = 0.15 + 0.6 * night.value
    composer.render()
  }
```

5. In `render(u)`, replace everything from the spotlight line to the end of the method:
```ts
      spot.value += (spotTarget - spot.value) * (1 - Math.exp(-dt * 8))

      const wet = sig.rain(u)
      night.value = sky.update(sig.sky(u), sig.fog(u), wet, camera.position.length()).night
      rain.update(u, wet)
      for (let i = 0; i < files.length; i++) {
        const f = files[i], k = sampleAt(tl, f.s, u), h = heightAt(f, k, u)
        f.h = h
        glow.setX(i, k < 0 ? 0 : Math.max(0, 1 - (u - tl.u[f.s[k][0]]) / GLOW))
        if (h < 1e-3) m.makeScale(0, 0, 0)
        else m.makeScale(f.w, h, f.d).setPosition(f.x, 0, f.z)
        mesh.setMatrixAt(i, m)
      }
      mesh.instanceMatrix.needsUpdate = true
      glow.needsUpdate = true
      bloom.strength = 0.15 + 0.6 * night.value
      composer.render()
    },
```
with:
```ts
      spot.value += (spotTarget - spot.value) * (1 - Math.exp(-dt * 8))
      drawScene(u)
    },
    renderClip(u, w, h) {
      if (!clipping) {
        // First clip frame: clip size at pixel ratio 1, auto camera, no spotlight or hover.
        clipping = true
        mode = 'auto'
        fly = null
        spot.value = 0
        hover.value = -1
        renderer.setPixelRatio(1)
        renderer.setSize(w, h, false)
        composer.setPixelRatio(1)
        composer.setSize(w, h)
        camera.aspect = w / h
        camera.updateProjectionMatrix()
      }
      const pose = autoPose(u)
      camera.position.copy(pose.pos)
      controls.target.copy(pose.target)
      camera.lookAt(pose.target)
      drawScene(u)
      return renderer.domElement
    },
    endClip() {
      if (!clipping) return
      clipping = false
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
      composer.setPixelRatio(Math.min(devicePixelRatio, 2))
      resize()
    },
```

- [ ] **Step 3: Verify**

Run `npm run typecheck && npm test` (clean, 28). With the dev server running, take `warm|u=0` then `c-end|u=31.5`. The shot should be identical to before: on-screen rendering is unchanged.

- [ ] **Step 4: Commit**

```bash
git add packages/web/camera.ts packages/web/city.ts
git commit -m "web: clip mode in the city (fixed size, auto camera, pure in u); aspect-aware framing"
```

---

### Task 4: The exporter and its UI

**Files:**
- Create: `packages/web/clip.ts`
- Modify: `packages/web/index.html`, `packages/web/main.ts`
- Modify: `packages/web/package.json` (npm adds mediabunny)

**Interfaces:**
- Consumes: `City.renderClip/endClip` (Task 3), `cityTotals` (Task 1), `headline`, `TICK`, `stepAt` (timeline).
- Produces:
  - `SHAPES`, `type Shape = 'landscape' | 'vertical'`;
  - `canClip(): Promise<boolean>`;
  - `renderClip(ctx, shape, onProgress, signal): Promise<Blob | null>` (null when cancelled).

- [ ] **Step 1: Install Mediabunny**

Run: `npm install mediabunny@^1.56.2 -w @chronocity/web`
Expected: `packages/web/package.json` gains `dependencies.mediabunny`.

- [ ] **Step 2: Create `packages/web/clip.ts`**

```ts
import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, QUALITY_HIGH, canEncodeVideo } from 'mediabunny'
import { headline, stepAt, TICK, type Timeline } from '@chronocity/core/timeline.ts'
import { cityTotals } from '@chronocity/core/stats.ts'
import type { Demo } from '@chronocity/core/model.ts'
import type { City } from './city.ts'

export const FPS = 30
export const SECONDS = 15
export const SHAPES = { landscape: [1920, 1080], vertical: [1080, 1920] } as const
export type Shape = keyof typeof SHAPES
export const WATERMARK = 'chronocity · dat999zx.github.io/chronocity'

export interface ClipContext {
  model: Demo
  tl: Timeline
  city: City
  churn: Float64Array
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
  const video = new CanvasSource(out, { codec: 'avc', quality: QUALITY_HIGH })
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

// Headline, repo name and "date · lines" stacked bottom-left; the watermark bottom-right. Scaled to the frame.
function drawOverlay(g: CanvasRenderingContext2D, ctx: ClipContext, u: number, w: number, h: number) {
  const s = Math.min(w, h) / 1080, pad = 56 * s
  const { model, tl } = ctx
  const step = Math.max(0, stepAt(tl, u))
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
  g.fillText(`${ctx.local(step).slice(0, 10)} · ${loc.toLocaleString('en-US')} lines`, pad, y)
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
```

- [ ] **Step 3: Markup and CSS**

In `packages/web/index.html`, replace:
```html
  <select id="speed" aria-label="Playback speed">
```
with:
```html
  <span id="clipwrap">
    <button id="clip" hidden aria-haspopup="true" aria-label="Export a video clip">🎬 Clip</button>
    <span id="clipmenu" hidden><button data-shape="landscape">Landscape 16:9</button><button data-shape="vertical">Vertical 9:16</button></span>
  </span>
  <select id="speed" aria-label="Playback speed">
```
Add right before `<script type="module" src="./main.ts"></script>`:
```html
<div id="clipping" hidden><div class="box"><div id="clipmsg">Rendering…</div><progress id="clipbar" max="1" value="0"></progress><button id="clipcancel">Cancel</button></div></div>
```
Add before `</style>`:
```css
  #clipwrap { position: relative }
  #clipmenu { position: absolute; right: 0; bottom: 40px; display: flex; flex-direction: column; gap: 6px; padding: 8px; border-radius: 10px;
    background: rgba(16,20,28,.9); border: 1px solid rgba(255,255,255,.12); white-space: nowrap }
  #clipping { position: fixed; inset: 0; display: grid; place-items: center; background: rgba(10,12,16,.82); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px) }
  #clipping .box { display: grid; gap: 12px; min-width: 320px; padding: 20px 24px; border-radius: 12px; background: #1b1f27; border: 1px solid #3a404c; text-align: center }
  #clipping progress { width: 100% }
  #clipmenu[hidden], #clipping[hidden] { display: none } /* their display: flex/grid would otherwise beat the hidden attribute */
```

- [ ] **Step 4: Wire it in `packages/web/main.ts`**

Add the import:
```ts
import { canClip, renderClip, SHAPES, type Shape } from './clip.ts'
```
After `const bars = createActivity(...)`, add:
```ts
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
    const blob = await renderClip({ model, tl, city, churn, span: D + TAIL, local }, shape, (done, total) => {
      const left = (((performance.now() - t0) / done) * (total - done)) / 1000
      clipMsg.textContent = `Rendering ${w}×${h} · ${Math.round((done / total) * 100)}% · ~${Math.ceil(left)} s left`
      clipBar.value = done / total
    }, busy.signal)
    clipping.hidden = true
    if (blob) {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `chronocity-${demo.name}-${shape === 'landscape' ? '16x9' : '9x16'}.mp4`
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
```
In the keydown handler, replace:
```ts
  else if (e.key === 'Escape') select(null)
```
with:
```ts
  else if (e.key === 'Escape') busy ? busy.abort() : select(null)
```
At the very top of `frame()`, before `const dt = ...`, add:
```ts
  if (busy) { // a clip owns the renderer; keep the clock fresh so playback doesn't jump afterwards
    last = now
    requestAnimationFrame(frame)
    return
  }
```

- [ ] **Step 5: Typecheck, test, and check the button appears**

Run `npm run typecheck && npm test` (clean, 28). With the dev server running, take the screenshot `k-bar|u=31.5`. Expected: a `🎬 Clip` button sits between the scrubber and the speed select. Headless Chrome can encode avc, so the button shows there too.

- [ ] **Step 6: Commit**

```bash
git add packages/web package-lock.json
git commit -m "web: one-click MP4 clips (landscape/vertical, 15 s, frame-stepped) with title/counter/watermark overlay"
```

---

### Task 5: Drive the real button and check the MP4

**Files:**
- Create: `scripts/drive.mjs`
- Modify: root `package.json` (script `"drive": "node scripts/drive.mjs"`)

**Interfaces:**
- Produces: `node scripts/drive.mjs <outDir> <steps.json>`, where steps are one of:
  - `{go}`, `{wait}`, `{move:[x,y]}`, `{click:[x,y]}`, `{clickSel}`, `{key}`, `{eval, label}`, `{shot}`;
  - `{waitFile, timeout}`, which waits until `<outDir>/<waitFile>` exists and has stopped growing.

- [ ] **Step 1: Create `scripts/drive.mjs`**

```js
// Drive headless Chrome over the DevTools protocol (no dependencies): real mouse and keyboard input, evals,
// screenshots and file downloads. For checking interaction and clip export, which plain --screenshot can't.
// usage: node scripts/drive.mjs <outDir> <steps.json>
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const [outDir, stepsFile] = process.argv.slice(2)
if (!outDir || !stepsFile) {
  console.error('usage: node scripts/drive.mjs <outDir> <steps.json>')
  process.exit(1)
}
const steps = JSON.parse(fs.readFileSync(stepsFile, 'utf8'))
const out = path.resolve(outDir)
fs.mkdirSync(out, { recursive: true })
const port = 9333
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(process.env.TEMP ?? '/tmp', 'chrono-drive')}`,
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,800', '--hide-scrollbars', 'about:blank',
], { stdio: 'ignore' })
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function connect(url) {
  const ws = new WebSocket(url)
  await new Promise(r => ws.addEventListener('open', r, { once: true }))
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
    if (msg.method === 'Runtime.exceptionThrown') console.log('EXCEPTION', msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text)
    if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type))
      console.log('CONSOLE', msg.params.type, msg.params.args.map(a => a.value ?? a.description).join(' '))
  })
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
  return { ws, send }
}

let targets = []
for (let i = 0; i < 50 && !targets.length; i++) {
  try { targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter(t => t.type === 'page') } catch {}
  if (!targets.length) await sleep(200)
}
const browser = await connect((await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl)
await browser.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: out, eventsEnabled: true })
const page = await connect(targets[0].webSocketDebuggerUrl)
const { send } = page
await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra })
const click = async (x, y) => { await mouse('mouseMoved', x, y, { button: 'none' }); await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y) }
const KEYS = { Escape: 27, ' ': 32, ArrowRight: 39, ArrowLeft: 37 }

for (const s of steps) {
  if (s.go) { await send('Page.navigate', { url: s.go }); await sleep(s.settle ?? 4000) }
  else if (s.wait) await sleep(s.wait)
  else if (s.move) await mouse('mouseMoved', ...s.move, { button: 'none' })
  else if (s.click) await click(...s.click)
  else if (s.clickSel) {
    const r = await send('Runtime.evaluate', { returnByValue: true, expression:
      `(() => { const e = document.querySelector(${JSON.stringify(s.clickSel)}); if (!e) return null; const b = e.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2] })()` })
    const p = r.result?.result?.value
    console.log('clickSel', s.clickSel, JSON.stringify(p))
    if (p) await click(...p)
  }
  else if (s.key) {
    const code = s.key === ' ' ? 'Space' : s.key
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: s.key, code, windowsVirtualKeyCode: KEYS[s.key] })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: s.key, code })
  }
  else if (s.eval) {
    const r = await send('Runtime.evaluate', { expression: s.eval, returnByValue: true, awaitPromise: true })
    console.log('EVAL', s.label ?? '', JSON.stringify(r.result?.result?.value))
  }
  else if (s.shot) {
    const r = await send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(out, s.shot + '.png'), Buffer.from(r.result.data, 'base64'))
    console.log('shot', s.shot)
  }
  else if (s.waitFile) {
    const file = path.join(out, s.waitFile), until = Date.now() + (s.timeout ?? 600) * 1000
    let size = -1
    while (Date.now() < until) {
      const now = fs.existsSync(file) ? fs.statSync(file).size : -1
      if (now > 0 && now === size) break // present and no longer growing
      size = now
      await sleep(2000)
    }
    console.log('file', s.waitFile, fs.existsSync(file) ? `${fs.statSync(file).size} bytes` : 'MISSING')
  }
}
page.ws.close()
browser.ws.close()
chrome.kill()
```

Add to root `package.json` scripts:
```json
    "drive": "node scripts/drive.mjs"
```

- [ ] **Step 2: Export both shapes through the real UI**

Start `npm run dev`, then write `.shots/export.json`:
```json
[
  { "go": "http://localhost:5173/?u=0" },
  { "clickSel": "#clip" }, { "clickSel": "#clipmenu [data-shape=landscape]" },
  { "wait": 3000 }, { "shot": "x-progress" },
  { "waitFile": "chronocity-knowl-16x9.mp4", "timeout": 900 },
  { "clickSel": "#clip" }, { "clickSel": "#clipmenu [data-shape=vertical]" },
  { "waitFile": "chronocity-knowl-9x16.mp4", "timeout": 900 },
  { "eval": "[document.getElementById('clipping').hidden, document.getElementById('clipmsg').textContent]", "label": "overlay after" }
]
```
Run: `node scripts/drive.mjs .shots .shots/export.json`
Expected:
- `x-progress.png` shows the overlay `Rendering 1920×1080 · N% · ~S s left`;
- both `file … bytes` lines report sizes of a few MB, not MISSING;
- `overlay after` is `[true, …]`;
- no `EXCEPTION` lines.

- [ ] **Step 3: Probe the files with Mediabunny**

```bash
node --input-type=module -e '
import { Input, ALL_FORMATS, FilePathSource } from "mediabunny"
for (const f of [".shots/chronocity-knowl-16x9.mp4", ".shots/chronocity-knowl-9x16.mp4"]) {
  const input = new Input({ formats: ALL_FORMATS, source: new FilePathSource(f) })
  const v = await input.getPrimaryVideoTrack()
  console.log(f, await v.getCodecParameterString(), `${v.displayWidth}x${v.displayHeight}`, (await input.computeDuration()).toFixed(2) + "s", (await v.computePacketStats()).packetCount, "frames")
}'
```
Expected:
- `…16x9.mp4 avc1.… 1920x1080 15.00s 450 frames`;
- `…9x16.mp4 avc1.… 1080x1920 15.00s 450 frames`.

- [ ] **Step 4: Look at the frames**

Write `.shots/frames.json`, replacing `<ABS>` with the absolute forward-slash path of `.shots` (for example `D:/coding/chronocity/.shots`):
```json
[
  { "go": "file:///<ABS>/chronocity-knowl-16x9.mp4", "settle": 2000 },
  { "eval": "(async () => { const v = document.querySelector('video'); v.pause(); v.currentTime = 1; await new Promise(r => v.addEventListener('seeked', r, { once: true })); return v.currentTime })()", "label": "seek 1" }, { "shot": "f-land-01" },
  { "eval": "(async () => { const v = document.querySelector('video'); v.currentTime = 7; await new Promise(r => v.addEventListener('seeked', r, { once: true })); return v.currentTime })()", "label": "seek 7" }, { "shot": "f-land-07" },
  { "eval": "(async () => { const v = document.querySelector('video'); v.currentTime = 14.5; await new Promise(r => v.addEventListener('seeked', r, { once: true })); return v.currentTime })()", "label": "seek 14.5" }, { "shot": "f-land-14" },
  { "go": "file:///<ABS>/chronocity-knowl-9x16.mp4", "settle": 2000 },
  { "eval": "(async () => { const v = document.querySelector('video'); v.pause(); v.currentTime = 10; await new Promise(r => v.addEventListener('seeked', r, { once: true })); return v.currentTime })()", "label": "seek 10" }, { "shot": "f-vert-10" }
]
```
Run: `node scripts/drive.mjs .shots .shots/frames.json` and open the PNGs.

Expected:
- the city, with bottom-left a commit headline, **dat999zx/knowl** in bold, and `YYYY-MM-DD · N lines`, with the watermark bottom-right;
- the lines count grows between 1 s, 7 s and 14.5 s;
- in the vertical frame the whole city fits the width, and none of the text overlaps.

If the vertical city is too small or cropped, tune `NARROW_PULL` in `camera.ts` (0.6–1.0), re-export and re-check. Put the value in the commit message.

- [ ] **Step 5: Commit**

```bash
git add scripts/drive.mjs package.json
git commit -m "scripts: DevTools-protocol driver; verified clip export (1920x1080 / 1080x1920, 15 s, 450 frames)"
```

---

### Task 6: README, link previews, and ship

**Files:**
- Create: `README.md`, `packages/web/public/og.png`
- Modify: `packages/web/index.html`, `packages/web/main.ts`

- [ ] **Step 1: `?ui=0` for clean stills**

In `packages/web/index.html`, add before `</style>`:
```css
  .bare #hud, .bare #bar, .bare #ticker { display: none }
```
In `packages/web/main.ts`, right after `const q = new URLSearchParams(location.search)`, add:
```ts
if (q.get('ui') === '0') document.body.classList.add('bare') // clean stills: README hero, link previews
```

- [ ] **Step 2: Link-preview metadata**

In `packages/web/index.html`, replace:
```html
<title>chronocity</title>
```
with:
```html
<title>chronocity — watch your repo grow into a city</title>
<meta name="description" content="Every file is a building, every folder a district, height is lines of code. Press play and the whole git history replays as a timelapse.">
<meta property="og:title" content="chronocity — watch your repo grow into a city">
<meta property="og:description" content="Every file is a building, every folder a district, height is lines of code. Press play and the whole git history replays as a timelapse.">
<meta property="og:image" content="https://dat999zx.github.io/chronocity/og.png">
<meta property="og:url" content="https://dat999zx.github.io/chronocity/">
<meta name="twitter:card" content="summary_large_image">
```

- [ ] **Step 3: Make `og.png`**

With the dev server running:
```bash
OUT="$(cygpath -w "$PWD/packages/web/public")"; PROF="$(cygpath -w "$TEMP/chrono-chrome")"; C="/c/Program Files/Google/Chrome/Application/chrome.exe"
"$C" --headless=new --user-data-dir="$PROF" --use-angle=swiftshader --enable-unsafe-swiftshader --window-size=1200,630 --virtual-time-budget=9000 --screenshot="$OUT\\og.png" "http://localhost:5173/?u=26.35&ui=0" 2>&1 | grep -o 'written to file.*'
```
Open it. Expected: the golden-hour city with no UI. If another moment looks better (try `u=21.3` for day, or `u=13.6` for the storm), use that one.

- [ ] **Step 4: Write `README.md`**

````markdown
# chronocity

Watch a git repo grow into a city.

**[Live demo →](https://dat999zx.github.io/chronocity/)**

![knowl, rendered as a city at golden hour](packages/web/public/og.png)

Every file is a building, every folder a district, and height is lines of code. Press play and the whole history replays:
buildings rise when files are added and collapse when they're deleted, and windows light up on the files each commit touches.
Then export a 15-second MP4 of it, landscape or vertical.

Every effect means something:

- **Sky** — the hours the authors actually committed, in their own time zone. A night-owl repo stays dark; a 9-to-5 repo stays sunny.
- **Fog** — quiet stretches longer than 3 days, squeezed out of the timeline.
- **Rain** — bursts of code churn (data files don't count).
- **Color** — language, in GitHub's linguist palette. Data files are low grey warehouses, not towers.

Click any building or district for its story: size, history, its last changes with `+added −removed`, and the real diff from GitHub.
Links like `?select=src/cli/program.ts` open straight to it.

## Run it

```sh
npm install
npm run dev     # http://localhost:5173
npm test        # core unit tests
```

Bake another repo into a demo (from a clone, first-parent history, up to 2,000 steps):

```sh
node packages/bake/bake.ts <path-to-clone> <name> <owner/repo> [ref]
```

## How it works

- `packages/core`: pure TypeScript.
  - A first-parent history walker, with isomorphic-git injected and line-multiset `+/−` counts.
  - A squarified-treemap layout over every path that ever existed, so nothing moves as time passes.
  - Sky, fog and rain as pure functions of playback time.
- `packages/web`:
  - Three.js: instanced buildings, procedural windows, shadows, bloom.
  - The inspect card, with diffs fetched from GitHub's compare API.
  - Frame-stepped MP4 export through WebCodecs and [Mediabunny](https://github.com/Vanilagy/mediabunny).
- `packages/bake`: walks a repo in Node and writes the demo JSON.

## Prior art

[Gource](https://gource.io) (2009) has owned "watch my project get built" for years, and CodeCity (Wettel, 2008) started code cities.
JSCity, BabiaXR-CodeCity, code-city and [Gizual](https://gizual.com) are the neighbours.
chronocity is the browser-only, zero-install, timelapse-first take.
````

- [ ] **Step 5: Full check**

Stop the dev server, then:
```bash
npm test && npm run typecheck && npm run build
```
Expected: `ℹ fail 0`, typecheck clean, the build succeeds (a chunk-size warning is expected).

- [ ] **Step 6: Commit, then ask before deploying**

```bash
git add README.md packages/web
git commit -m "launch: README, link-preview metadata and og.png, ?ui=0 for clean stills"
```
Ask the user: "Push to deploy (clips, gallery, README, previews)?" Only on a yes:
```bash
git push
gh run watch "$(gh run list --workflow pages --limit 1 --json databaseId -q '.[0].databaseId')" --exit-status
```
