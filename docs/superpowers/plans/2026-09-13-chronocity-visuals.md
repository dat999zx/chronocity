# chronocity Visuals Implementation Plan (Plan 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the live demo beautiful, with every effect tied to real data:
- buildings colored by language;
- data files drawn as low warehouses;
- a sky driven by the hours the authors committed;
- fog over quiet stretches;
- rain on bursts of code churn;
- lit windows on the files being touched;
- a camera that frames the growing city;
- click-to-inspect.

**Architecture:** All data logic is pure and tested in `packages/core`: `lang.ts` (extension → language/color/data flag), plus `signals()` in `timeline.ts` (sky / fog / rain as pure functions of playback time `u`). Everything that touches three.js lives in `packages/web`, one file per effect:
- `sky.ts`: lights, background, fog;
- `buildingMaterial.ts`: the window shader;
- `rain.ts`;
- `camera.ts`.

`city.ts` wires them together. The Model format does not change, so there's no re-bake.

**Tech Stack:** TypeScript (Node 24 runs `.ts` natively), Vite 8, three 0.186 (+ @types/three), `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-13-chronocity-design.md` ("What the visuals mean", "Timeline and render(u)"). This plan is build-order step 5. The previous plan is `docs/superpowers/plans/2026-09-13-chronocity-foundation.md`, executed and then converted to TypeScript.

## Decisions made while planning (checked against knowl's real data)

- **Data files** (`json jsonl ndjson csv tsv xml svg snap`) are capped at 2.5 units: low grey warehouses. In knowl the tallest towers were eval/benchmark JSON (up to 19,858 lines).
- **Colors**: GitHub linguist colors, pulled 25% toward grey, with ACES tone mapping.
- **Sky**: the circular mean of author-local commit hours, averaged at 16 points over the trailing 2 s and never over fewer than the last 12 commits. With a plain 2 s window the prototype flipped from night to day in 0.1 s; with this smoothing the worst change is 0.061 elevation per 0.05 s.
- **Fog**: full strength at a 7-day gap (GAP_CAP 3 days + FOG_RAMP 4 days). Knowl has exactly two 8-day gaps (steps 13 and 161).
- **Rain**: counts **code** churn only (data files excluded) over the trailing 0.5 s. Thresholds come from 600 even samples of the clip: dry below the 90th percentile, a full storm at the 99th. On knowl: wet 7% of the clip, heavy 1%, the big storm at u ≈ 13.6. Counting data files instead made rain nearly constant, because a few 20k-line JSON dumps dominated.
- **Windows**: a touched file's windows glow warm for 1.5 s; after dark every building shows faint lit windows.
- **Camera**: an auto-orbit that frames the built-up area. A drag over 5 px or a scroll takes over; double-click hands control back.
- **HUD**: adds the author-local time (`2026-09-10 23:12`) next to the date.
- **Bloom**: optional. Keep it only if the night screenshot is better with it.

## Global Constraints

- TypeScript rules (every file):
  - erasable syntax only: no enums, namespaces, or parameter properties;
  - relative imports carry `.ts`;
  - type-only imports use `import type` (or an inline `type`).
- After every task, `npm test` and `npm run typecheck` must pass.
- `packages/core` stays free of DOM and three.js. Anything importing `three` goes in `packages/web`.
- `render(u)` must stay a pure function of `u`: no `Date.now()`, no per-frame accumulators, no `Math.random()`. The only exception is the user-driven camera after a drag.
- Don't touch `walker.ts`, `layout.ts`, `model.ts`, or the demo JSON.
- Tuning knobs are named constants at the top of their file. Change them by eye against screenshots, and put final values in the commit message.
- Screenshot moments on the knowl demo:

  | Moment | `u` |
  |---|---|
  | day | 21.3 |
  | dusk | 26.35 |
  | night | 2.0 |
  | fog | 6.68 |
  | storm | 13.6 |
  | end | 31.5 |

- **Screenshot recipe** (this machine; a relative `--screenshot` path writes nothing). Start the dev server in the background with `npm run dev` (http://localhost:5173), then define:
  ```bash
  shot() {  # shot <name> <u>  → .shots/<name>.png
    "/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new \
      --user-data-dir="$(cygpath -w "$TEMP/chrono-chrome")" --use-angle=swiftshader --enable-unsafe-swiftshader \
      --window-size=1280,800 --virtual-time-budget=8000 \
      --screenshot="$(cygpath -w "$PWD/.shots")\\$1.png" "http://localhost:5173/?u=$2" 2>&1 | grep written
  }
  shot warmup 0   # first load makes Vite pre-bundle three; ignore this image
  ```
  Open PNGs with the Read tool. If buildings vanish or turn black after a shader change, get the console log: add `--enable-logging=stderr --v=0` to the command and grep for `ERROR`.

## File Structure

```
packages/core/lang.ts               NEW  langOf(path) → { name, color, data }
packages/core/timeline.ts           MOD  + elevation(), signals() → { sky, fog, rain }
packages/core/test.ts               MOD  + lang and signals tests
packages/web/city.ts                MOD  colors, warehouses, plates, wiring of every effect, pick()
packages/web/sky.ts                 NEW  lights + background + FogExp2 from sky/fog signals
packages/web/buildingMaterial.ts    NEW  MeshStandardMaterial + procedural windows (aGlow, uNight)
packages/web/rain.ts                NEW  LineSegments rain, pure in u
packages/web/camera.ts              NEW  extents() + autoCamera(u)
packages/web/main.ts                MOD  HUD local time, click tooltip
packages/web/index.html             MOD  #tip element, HUD text shadow
```

---

### Task 1: Language table

**Files:**
- Create: `packages/core/lang.ts`
- Test: `packages/core/test.ts` (append)

**Interfaces:**
- Produces: `interface Lang { name: string; color: number; data: boolean }` and `langOf(path: string): Lang`. `color` is a 0xRRGGBB number (GitHub linguist); `data` is true for data files.

- [ ] **Step 1: Append the failing test**

Add to the imports at the top of `packages/core/test.ts`:
```ts
import { langOf } from './lang.ts'
```
Append:
```ts
test('langOf: language by extension, data files flagged', () => {
  assert.equal(langOf('src/a.ts').name, 'TypeScript')
  assert.equal(langOf('web/App.test.TSX').name, 'TypeScript')
  assert.equal(langOf('lib/x.py').color, 0x3572a5)
  assert.equal(langOf('docs/evals/suite.JSON').data, true)
  assert.equal(langOf('src/a.ts').data, false)
  assert.equal(langOf('.gitignore').name, 'Other')
  assert.equal(langOf('Makefile').name, 'Other')
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL, `ERR_MODULE_NOT_FOUND` for `lang.ts`.

- [ ] **Step 3: Implement lang.ts**

`packages/core/lang.ts`:
```ts
// Language by file extension, colored like GitHub's linguist. Data files become low warehouses, not towers.
export interface Lang { name: string; color: number; data: boolean }

const OTHER: Lang = { name: 'Other', color: 0x9aa0a8, data: false }
const DATA: Lang = { name: 'Data', color: 0x8a8f98, data: true }
const lang = (name: string, color: number, ...exts: string[]) =>
  exts.map(e => [e, { name, color, data: false }] as const)

const BY_EXT = new Map<string, Lang>([
  ...lang('TypeScript', 0x3178c6, 'ts', 'tsx', 'mts', 'cts'),
  ...lang('JavaScript', 0xf1e05a, 'js', 'jsx', 'mjs', 'cjs'),
  ...lang('Python', 0x3572a5, 'py'),
  ...lang('Rust', 0xdea584, 'rs'),
  ...lang('Go', 0x00add8, 'go'),
  ...lang('Java', 0xb07219, 'java'),
  ...lang('Kotlin', 0xa97bff, 'kt', 'kts'),
  ...lang('Swift', 0xf05138, 'swift'),
  ...lang('C', 0x555555, 'c', 'h'),
  ...lang('C++', 0xf34b7d, 'cpp', 'cc', 'cxx', 'hpp', 'hh'),
  ...lang('C#', 0x178600, 'cs'),
  ...lang('Ruby', 0x701516, 'rb'),
  ...lang('PHP', 0x4f5d95, 'php'),
  ...lang('Lua', 0x000080, 'lua'),
  ...lang('Dart', 0x00b4ab, 'dart'),
  ...lang('HTML', 0xe34c26, 'html', 'htm'),
  ...lang('CSS', 0x663399, 'css'),
  ...lang('SCSS', 0xc6538c, 'scss', 'sass'),
  ...lang('Vue', 0x41b883, 'vue'),
  ...lang('Svelte', 0xff3e00, 'svelte'),
  ...lang('Shell', 0x89e051, 'sh', 'bash', 'zsh'),
  ...lang('PowerShell', 0x012456, 'ps1', 'psm1'),
  ...lang('SQL', 0xe38c00, 'sql'),
  ...lang('Markdown', 0x083fa1, 'md', 'mdx'),
  ...lang('YAML', 0xcb171e, 'yml', 'yaml'),
  ...lang('TOML', 0x9c4221, 'toml'),
  ...['json', 'jsonl', 'ndjson', 'csv', 'tsv', 'xml', 'svg', 'snap'].map(e => [e, DATA] as const),
])

export function langOf(path: string): Lang {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  const dot = name.lastIndexOf('.')
  return (dot > 0 && BY_EXT.get(name.slice(dot + 1))) || OTHER
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test && npm run typecheck`
Expected: `ℹ pass 13`, `ℹ fail 0`; typecheck prints no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/core/lang.ts packages/core/test.ts
git commit -m "core: language table with linguist colors and data-file flag"
```

---

### Task 2: Weather and daylight signals

**Files:**
- Modify: `packages/core/timeline.ts`
- Test: `packages/core/test.ts` (append)

**Interfaces:**
- Consumes: `langOf` (Task 1); `Timeline`, `stepAt`, `GAP_CAP` (same file).
- Produces:
  - `interface SkyState { hour: number; r: number }`;
  - `elevation(s: SkyState): number`, in [-1, 1];
  - `interface Signals { sky(u): SkyState; fog(u): number; rain(u): number }`;
  - `signals(model: Model, tl: Timeline): Signals`;
  - constants `FOG_RAMP`, `SKY_WINDOW`, `SKY_TAPS`, `SKY_MIN_COMMITS`, `RAIN_WINDOW`.

- [ ] **Step 1: Append the failing tests**

In `packages/core/test.ts`, change the model import to:
```ts
import type { Commit, FileHistory, Model, Sample } from './model.ts'
```
and the timeline import to:
```ts
import { timeline, stepAt, sampleAt, signals, elevation, GAP_CAP } from './timeline.ts'
```
Append (`T` and `tlModel` are defined above):
```ts
const DAY0 = 1_699_920_000 // 2023-11-14 00:00 UTC
// A commit at an author-local hour: [t, tz, churn]
const at = (hour: number, tz = 0, day = 0): Commit => [DAY0 + day * 86400 + hour * 3600 - tz * 60, tz, 0]
const mk = (commits: Commit[], files: FileHistory[] = []): Model => ({ v: 1, commits, files })

test('elevation: +1 at noon, -1 at midnight, 0 at 06:00, scaled by r', () => {
  assert.ok(Math.abs(elevation({ hour: 12, r: 1 }) - 1) < 1e-12)
  assert.ok(Math.abs(elevation({ hour: 0, r: 0.5 }) + 0.5) < 1e-12)
  assert.ok(Math.abs(elevation({ hour: 6, r: 1 })) < 1e-12)
})

test('sky: circular mean across midnight, author-local time, scattered hours', () => {
  let m = mk([at(23), at(1, 0, 1)])
  let s = signals(m, timeline(m, 1)).sky(4) // u past the end: every tap sees both commits
  assert.ok(Math.min(s.hour, 24 - s.hour) < 1e-9, `23:00 + 01:00 gave ${s.hour}`) // midnight, not noon
  assert.ok(Math.abs(s.r - Math.cos(Math.PI / 12)) < 1e-9)
  m = mk([at(23, 420)])
  s = signals(m, timeline(m, 1)).sky(3)
  assert.ok(Math.abs(s.hour - 23) < 1e-9) // 16:00 UTC at +0700 is 23:00 for the author
  m = mk([at(6), at(18)])
  assert.ok(signals(m, timeline(m, 1)).sky(4).r < 1e-9) // opposite hours cancel out: twilight
})

test('sky: changes smoothly even when the hours flip', () => {
  const m = mk([...Array(100).keys()].map(i => at(i < 50 ? 3 : 15, 0, i)))
  const sg = signals(m, timeline(m, 30))
  let prev = elevation(sg.sky(0)), maxJump = 0
  for (let u = 0.05; u <= 32; u += 0.05) {
    const e = elevation(sg.sky(u))
    maxJump = Math.max(maxJump, Math.abs(e - prev))
    prev = e
  }
  assert.ok(maxJump < 0.15, `sky jumped ${maxJump} in 0.05 s`)
  assert.ok(elevation(sg.sky(10)) < -0.5 && elevation(sg.sky(31)) > 0.5) // 03:00 commits first, 15:00 later
})

test('fog: only in squeezed quiet stretches, strongest mid-gap', () => {
  const m = mk(tlModel.commits), tl = timeline(m, 30), sg = signals(m, tl)
  assert.equal(sg.fog(-1), 0)
  assert.equal(sg.fog(0.2), 0)                       // 1-hour gap: clear
  assert.ok(sg.fog((tl.u[1] + tl.u[2]) / 2) > 0.999) // 60-day gap: full fog mid-way
  assert.equal(sg.fog(31), 0)                        // after the last commit
})

test('rain: storms on bursts of code churn, not data dumps', () => {
  const commits = [...Array(40).keys()].map(i => [T + i * 3600, 0, 0] as Commit)
  let loc = 0
  const a: Sample[] = commits.map((_, i) => [i, (loc += i === 20 ? 5000 : 10)])
  const m = mk(commits, [['a.ts', a], ['big.json', [[5, 100000]]]])
  const sg = signals(m, timeline(m, 39)) // one commit per playback second
  assert.equal(sg.rain(20.1), 1) // +5000 lines of code
  assert.equal(sg.rain(10.1), 0) // an ordinary commit
  assert.equal(sg.rain(5.1), 0)  // a 100k-line JSON dump is not a storm
})

test('signals: a one-commit repo has no weather', () => {
  const m = mk([[T, 0, 0]]), sg = signals(m, timeline(m, 10))
  assert.equal(sg.rain(0), 0)
  assert.equal(sg.fog(0), 0)
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL with a SyntaxError: `timeline.ts` does not provide an export named `signals`.

- [ ] **Step 3: Implement the signals**

In `packages/core/timeline.ts`, replace the first line (`import type { Model, Sample } from './model.ts'`) with:
```ts
import { langOf } from './lang.ts'
import type { Model, Sample } from './model.ts'
```
Append to the end of the file:
```ts
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
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test && npm run typecheck`
Expected: `ℹ pass 19`, `ℹ fail 0`; typecheck clean.

- [ ] **Step 5: Check the moments on the real demo**

Run:
```bash
node --input-type=module -e '
import fs from "node:fs"
import { timeline, signals, elevation } from "./packages/core/timeline.ts"
const m = JSON.parse(fs.readFileSync("packages/web/public/demos/knowl.json", "utf8"))
const tl = timeline(m, 30), sg = signals(m, tl)
for (const [name, u] of [["day", 21.3], ["dusk", 26.35], ["night", 2], ["fog", 6.68], ["storm", 13.6]])
  console.log(name.padEnd(6), "elev", elevation(sg.sky(u)).toFixed(2), "fog", sg.fog(u).toFixed(2), "rain", sg.rain(u).toFixed(2))
'
```
Expected (±0.02):
```
day    elev 0.53 fog 0.00 rain 0.00
dusk   elev -0.19 ...
night  elev -0.52 ...
fog    ... fog 1.00 ...
storm  ... rain 1.00
```
If these differ a lot, the signals don't match the prototype; STOP and compare against Step 3.

- [ ] **Step 6: Commit**

```bash
git add packages/core/timeline.ts packages/core/test.ts
git commit -m "core: sky, fog and rain signals, pure in playback time"
```

---

### Task 3: Colors, warehouses, plates

**Files:**
- Modify: `packages/web/city.ts` (full replacement below)

**Interfaces:**
- Consumes: `langOf` (Task 1).
- Produces: the same `createCity(canvas, model, lay, tl): City`, plus a per-building `maxH` and `heightAt(f, k, u)` that later tasks extend. New exports: `DATA_MAX_H`.

- [ ] **Step 1: Replace `packages/web/city.ts`**

```ts
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { sampleAt, type Timeline } from '@chronocity/core/timeline.ts'
import { langOf } from '@chronocity/core/lang.ts'
import type { CityLayout } from '@chronocity/core/layout.ts'
import type { Model, Sample } from '@chronocity/core/model.ts'

export const HEIGHT_K = 0.25  // world units per sqrt(LOC) (tuning knob)
export const MAX_H = 24       // tallest possible building (tuning knob)
export const DATA_MAX_H = 2.5 // data files (json, csv, ...) stay low: warehouses, not towers
export const RISE = 0.6       // playback seconds for a height change to ease in
const MUTE = 0.25             // how far language colors are pulled toward grey (tuning knob)
const GREY = new THREE.Color(0xb8bcc4)
const GROUND = new THREE.Color(0x1c2028) // root plate: asphalt
const PLATE = new THREE.Color(0x4a5160)  // folder plates three levels deep; shallower levels blend toward GROUND

const easeOut = (p: number) => 1 - (1 - p) ** 3

interface Building { path: string; s: Sample[]; x: number; z: number; w: number; d: number; maxH: number }
export interface City { render(u: number): void }

export function createCity(canvas: HTMLCanvasElement, model: Model, lay: CityLayout, tl: Timeline): City {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x1b1f27)

  const S = lay.size
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, S * 20)
  camera.position.set(S * 0.9, S * 0.8, S * 0.9)
  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.autoRotate = true
  controls.autoRotateSpeed = 0.4

  scene.add(new THREE.HemisphereLight(0xdde6ff, 0x30343c, 1.2))
  const sun = new THREE.DirectionalLight(0xffffff, 1.5)
  sun.position.set(S, S * 2, S * 0.5)
  scene.add(sun)

  const group = new THREE.Group()
  group.position.set(-S / 2, 0, -S / 2) // lay out in [0, S], orbit around the centre
  scene.add(group)
  const box = new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5) // origin at the min corner, base on y=0
  const m = new THREE.Matrix4(), color = new THREE.Color()

  // Plates: the ground is dark asphalt and each folder level is a little lighter, so streets read as gaps.
  const plates = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ roughness: 1 }), lay.districts.length)
  lay.districts.forEach(([x, z, w, d, depth], i) => {
    m.makeScale(w, 0.05, d).setPosition(x, depth * 0.05, z)
    plates.setMatrixAt(i, m)
    plates.setColorAt(i, color.copy(GROUND).lerp(PLATE, Math.min(1, depth / 3)))
  })
  group.add(plates)

  const files: Building[] = model.files.map(([path, s]) => {
    const [x, z, w, d] = lay.lots.get(path)!
    const g = 0.15 * Math.min(w, d) // building footprint = lot inset by 15%
    return { path, s, x: x + g, z: z + g, w: w - 2 * g, d: d - 2 * g, maxH: langOf(path).data ? DATA_MAX_H : MAX_H }
  })
  const mesh = new THREE.InstancedMesh(box.clone(), new THREE.MeshStandardMaterial({ roughness: 0.85 }), files.length)
  files.forEach((f, i) => mesh.setColorAt(i, color.setHex(langOf(f.path).color).lerp(GREY, MUTE)))
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  mesh.frustumCulled = false // instances change every frame; a cached bounding sphere would go stale
  group.add(mesh)

  const heightOf = (f: Building, loc: number) => Math.min(f.maxH, HEIGHT_K * Math.sqrt(loc))
  function heightAt(f: Building, k: number, u: number): number {
    if (k < 0) return 0
    const from = k > 0 ? heightOf(f, f.s[k - 1][1]) : 0
    const to = heightOf(f, f.s[k][1])
    const p = Math.min(1, (u - tl.u[f.s[k][0]]) / RISE)
    return from + (to - from) * easeOut(p)
  }

  function resize() {
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false)
    camera.aspect = canvas.clientWidth / canvas.clientHeight
    camera.updateProjectionMatrix()
  }
  resize()
  addEventListener('resize', resize)

  return {
    render(u) {
      for (let i = 0; i < files.length; i++) {
        const f = files[i], h = heightAt(f, sampleAt(tl, f.s, u), u)
        if (h < 1e-3) m.makeScale(0, 0, 0)
        else m.makeScale(f.w, h, f.d).setPosition(f.x, 0, f.z)
        mesh.setMatrixAt(i, m)
      }
      mesh.instanceMatrix.needsUpdate = true
      controls.update()
      renderer.render(scene, camera)
    },
  }
}
```

- [ ] **Step 2: Typecheck, then screenshot**

Run `npm run typecheck` (clean), start the dev server, define `shot` (see Global Constraints), then:
```bash
shot warmup 0
shot t3-end 31.5
```
Expected in `t3-end.png`:
- mostly TypeScript-blue buildings, with some dark-blue Markdown and yellow JavaScript;
- the eval/benchmark JSON files are now low grey blocks, and the tallest towers are code and docs (`src/cli/program.ts`, `CHANGELOG.md`, the long plan docs);
- streets read as darker gaps between lighter folder plates.

Tune `MUTE` (0.15–0.4) and the `GROUND`/`PLATE` colors until districts read clearly, then re-shoot.

- [ ] **Step 3: Commit**

```bash
git add packages/web/city.ts
git commit -m "web: language colors, data warehouses, district plates, ACES"
```

---

### Task 4: Sky, sun and fog

**Files:**
- Create: `packages/web/sky.ts`
- Modify: `packages/web/city.ts`

**Interfaces:**
- Consumes: `signals`, `elevation`, `SkyState` (Task 2).
- Produces: `createSky(scene, S): { update(state: SkyState, fog: number): number }`. The return value is `night`, in 0..1 (1 = full night); Task 5 feeds it to the windows.

- [ ] **Step 1: Write sky.ts**

`packages/web/sky.ts`:
```ts
import * as THREE from 'three'
import { elevation, type SkyState } from '@chronocity/core/timeline.ts'

const NIGHT = new THREE.Color(0x070b16)
const DAY = new THREE.Color(0x87b3e6)
const HORIZON = new THREE.Color(0xe08a5a) // warm band while the sun is low
const HAZE = new THREE.Color(0x9aa3ad)    // fog pulls everything toward grey

export interface Sky { update(state: SkyState, fog: number): number }

// Lights, background and fog from the commit-hour sky. Returns how dark it is (0 day .. 1 night).
export function createSky(scene: THREE.Scene, S: number): Sky {
  const hemi = new THREE.HemisphereLight(0xdde6ff, 0x2a2e36, 1)
  const sun = new THREE.DirectionalLight(0xffffff, 1)
  scene.add(hemi, sun)
  const bg = new THREE.Color()
  const haze = new THREE.FogExp2(0x000000, 0)
  scene.background = bg
  scene.fog = haze
  return {
    update(state, fog) {
      const e = elevation(state)
      const day = THREE.MathUtils.smoothstep(e, -0.1, 0.4)
      const dusk = Math.max(0, 1 - Math.abs(e) / 0.3)
      const az = (state.hour / 24) * 2 * Math.PI
      sun.position.set(Math.sin(az) * S, Math.max(0.1, e) * S * 2, Math.cos(az) * S)
      sun.intensity = 0.15 + 2.2 * day
      sun.color.set(0xffffff).lerp(HORIZON, dusk * 0.6)
      hemi.intensity = 0.3 + 0.9 * day
      bg.copy(NIGHT).lerp(DAY, day).lerp(HORIZON, dusk * 0.35).lerp(HAZE, fog * 0.6)
      haze.color.copy(bg)
      haze.density = (0.25 + 1.3 * fog) / (S * 1.5)
      return 1 - day
    },
  }
}
```

- [ ] **Step 2: Wire it into city.ts**

In `packages/web/city.ts`:

Change the timeline import to:
```ts
import { sampleAt, signals, type Timeline } from '@chronocity/core/timeline.ts'
```
Add below the other local imports:
```ts
import { createSky } from './sky.ts'
```
Delete this line:
```ts
  scene.background = new THREE.Color(0x1b1f27)
```
Replace the lights block:
```ts
  scene.add(new THREE.HemisphereLight(0xdde6ff, 0x30343c, 1.2))
  const sun = new THREE.DirectionalLight(0xffffff, 1.5)
  sun.position.set(S, S * 2, S * 0.5)
  scene.add(sun)
```
with:
```ts
  const sig = signals(model, tl)
  const sky = createSky(scene, S)
```
At the top of `render(u) {`, before the `for` loop, add:
```ts
      sky.update(sig.sky(u), sig.fog(u))
```

- [ ] **Step 3: Typecheck and screenshot the four moods**

```bash
npm run typecheck
shot t4-day 21.3
shot t4-dusk 26.35
shot t4-night 2
shot t4-fog 6.68
```
Expected:
- day: blue sky with sunlit and shaded faces;
- dusk: a warm orange/purple cast;
- night: a deep navy sky with dim buildings (windows come in Task 5);
- fog: grey haze, with distant buildings faded.

Tune the palette constants in `sky.ts` and the fog density numerators (0.25 base, 1.3 fog) until each mood is clearly distinct, then re-shoot.

- [ ] **Step 4: Commit**

```bash
git add packages/web/sky.ts packages/web/city.ts
git commit -m "web: sky, sun and fog driven by commit hours and quiet stretches"
```

---

### Task 5: Lit windows

**Files:**
- Create: `packages/web/buildingMaterial.ts`
- Modify: `packages/web/city.ts`

**Interfaces:**
- Consumes: the `night` value returned by `sky.update` (Task 4).
- Produces: `createBuildingMaterial(night: { value: number }): THREE.MeshStandardMaterial`. It reads a per-instance attribute named `aGlow` (a float, 0..1).

- [ ] **Step 1: Write buildingMaterial.ts**

`packages/web/buildingMaterial.ts`:
```ts
import * as THREE from 'three'

export const FLOOR = 0.45 // window row height in world units (tuning knob)
export const BAY = 0.35   // window column width in world units (tuning knob)
const WARM = 'vec3(1.0, 0.82, 0.55)'

// MeshStandardMaterial with procedural windows on the walls (not roofs). Per-instance `aGlow` (0..1) lights a
// building whose file was just touched; `night` (0..1) adds a faint lived-in glow to every building after dark.
export function createBuildingMaterial(night: { value: number }): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.85 })
  mat.onBeforeCompile = shader => {
    shader.uniforms.uNight = night
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aGlow;
varying float vGlow;
varying vec3 vWin;
varying vec3 vWinN;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vGlow = aGlow;
vWin = (instanceMatrix * vec4(transformed, 1.0)).xyz;
vWinN = normal;`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uNight;
varying float vGlow;
varying vec3 vWin;
varying vec3 vWinN;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
if (abs(vWinN.y) < 0.5) {
  float along = abs(vWinN.x) > 0.5 ? vWin.z : vWin.x;
  float win = step(0.3, fract(vWin.y / ${FLOOR.toFixed(3)})) * step(0.35, fract(along / ${BAY.toFixed(3)}));
  totalEmissiveRadiance += ${WARM} * win * max(vGlow, uNight * 0.18) * 1.6;
}`)
  }
  return mat
}
```
How it works: `vWin` is the vertex position in layout space (after the instance matrix), so the windows keep a fixed world-space size whatever the building's height. `vWinN` is the box's object-space normal, so it's axis-aligned and tells walls from roofs and picks the horizontal axis.

- [ ] **Step 2: Wire it into city.ts**

In `packages/web/city.ts`:

Add the import:
```ts
import { createBuildingMaterial } from './buildingMaterial.ts'
```
Add below `export const RISE = ...`:
```ts
export const GLOW = 1.5       // playback seconds a touched file's windows stay lit
```
Replace:
```ts
  const mesh = new THREE.InstancedMesh(box.clone(), new THREE.MeshStandardMaterial({ roughness: 0.85 }), files.length)
```
with:
```ts
  const night = { value: 0 }
  const glow = new THREE.InstancedBufferAttribute(new Float32Array(files.length), 1).setUsage(THREE.DynamicDrawUsage)
  const geo = box.clone()
  geo.setAttribute('aGlow', glow)
  const mesh = new THREE.InstancedMesh(geo, createBuildingMaterial(night), files.length)
```
In `render(u)`, replace:
```ts
      sky.update(sig.sky(u), sig.fog(u))
```
with:
```ts
      night.value = sky.update(sig.sky(u), sig.fog(u))
```
Replace the first line inside the `for` loop:
```ts
        const f = files[i], h = heightAt(f, sampleAt(tl, f.s, u), u)
```
with:
```ts
        const f = files[i], k = sampleAt(tl, f.s, u), h = heightAt(f, k, u)
        glow.setX(i, k < 0 ? 0 : Math.max(0, 1 - (u - tl.u[f.s[k][0]]) / GLOW))
```
After the loop's closing brace, next to `mesh.instanceMatrix.needsUpdate = true`, add:
```ts
      glow.needsUpdate = true
```

- [ ] **Step 3: Typecheck and screenshot**

```bash
npm run typecheck
shot t5-night 2
shot t5-dusk 26.35
shot t5-day 21.3
```
Expected: a grid of small window rectangles on walls only, not roofs. At night every building shows a faint warm grid, and the buildings touched in the last 1.5 s blaze. By day the touched buildings still show lit windows, but less contrast. If buildings are black or missing, the shader didn't compile: rerun `shot` with `--enable-logging=stderr --v=0` and read the error. Tune `FLOOR`, `BAY`, the `0.18` night level and the `1.6` brightness.

- [ ] **Step 4: Commit**

```bash
git add packages/web/buildingMaterial.ts packages/web/city.ts
git commit -m "web: procedural windows lit by touched files and by night"
```

---

### Task 6: Rain

**Files:**
- Create: `packages/web/rain.ts`
- Modify: `packages/web/city.ts`

**Interfaces:**
- Consumes: `sig.rain(u)` (Task 2).
- Produces: `createRain(S): { object: THREE.LineSegments; update(u: number, intensity: number): void }`. Coordinates are layout space, so add it to `group`.

- [ ] **Step 1: Write rain.ts**

`packages/web/rain.ts`:
```ts
import * as THREE from 'three'

const DROPS = 3000
const FALL = 18    // world units per playback second (tuning knob)
const STREAK = 0.7 // streak length in world units

const rand = (n: number) => { const s = Math.sin(n * 12.9898) * 43758.5453; return s - Math.floor(s) }

// Rain streaks over the city, pure in u: each drop's height is a function of u, so scrubbing and export agree.
export function createRain(S: number) {
  const top = S * 0.9
  const pos = new Float32Array(DROPS * 6)
  const attr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', attr)
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xb4c4da, transparent: true, opacity: 0.5 }))
  lines.frustumCulled = false
  return {
    object: lines,
    update(u: number, intensity: number) {
      const n = Math.floor(DROPS * intensity)
      lines.visible = n > 0
      geo.setDrawRange(0, n * 2)
      for (let i = 0; i < n; i++) {
        const x = rand(i * 3 + 1) * S, z = rand(i * 3 + 2) * S
        const y = top - ((u * FALL + rand(i * 3 + 3) * top) % top)
        const o = i * 6
        pos[o] = x; pos[o + 1] = y; pos[o + 2] = z
        pos[o + 3] = x - 0.08; pos[o + 4] = y + STREAK; pos[o + 5] = z
      }
      attr.needsUpdate = true
    },
  }
}
```

- [ ] **Step 2: Wire it into city.ts**

Add the import:
```ts
import { createRain } from './rain.ts'
```
After `group.add(mesh)`, add:
```ts
  const rain = createRain(S)
  group.add(rain.object)
```
In `render(u)`, right after the `night.value = sky.update(...)` line, add:
```ts
      rain.update(u, sig.rain(u))
```

- [ ] **Step 3: Typecheck and screenshot**

```bash
npm run typecheck
shot t6-storm 13.6
shot t6-dry 21.3
```
Expected: `t6-storm` shows dense, slightly slanted streaks over the city; `t6-dry` has none. Tune `DROPS`, `STREAK` and the opacity.

- [ ] **Step 4: Commit**

```bash
git add packages/web/rain.ts packages/web/city.ts
git commit -m "web: rain on bursts of code churn, pure in u"
```

---

### Task 7: Auto camera, click-to-inspect, HUD time

**Files:**
- Create: `packages/web/camera.ts`
- Modify: `packages/web/city.ts`, `packages/web/main.ts`, `packages/web/index.html`

**Interfaces:**
- Consumes: `stepAt`, `Timeline`, `CityLayout`, `FileHistory`.
- Produces:
  - `extents(files: FileHistory[], lay: CityLayout, steps: number): Float64Array`;
  - `autoCamera(u, tl, ext, S): { x: number; y: number; z: number }`;
  - `City.pick(clientX, clientY, u): Picked | null`, where `Picked = { path: string; loc: number; first: number; last: number }` and `first`/`last` are step indices.

- [ ] **Step 1: Write camera.ts**

`packages/web/camera.ts`:
```ts
import { stepAt, type Timeline } from '@chronocity/core/timeline.ts'
import type { CityLayout } from '@chronocity/core/layout.ts'
import type { FileHistory } from '@chronocity/core/model.ts'

export const ORBIT = 0.05 // radians per playback second (tuning knob)
export const FRAME = 2.6  // camera distance per unit of built-up radius; ~1 / sin(fov / 2) for a 45° lens

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
export function autoCamera(u: number, tl: Timeline, ext: Float64Array, S: number) {
  let r = 0
  for (let k = 0; k < 8; k++) r += ext[Math.max(0, stepAt(tl, u - k * 0.25))] / 8
  const dist = Math.max(S * 0.25, r) * FRAME
  const a = Math.PI / 4 + u * ORBIT
  return { x: Math.sin(a) * dist, y: dist * 0.75, z: Math.cos(a) * dist }
}
```

- [ ] **Step 2: Wire the camera and picking into city.ts**

Add the import:
```ts
import { autoCamera, extents } from './camera.ts'
```
Replace the `City` interface line:
```ts
export interface City { render(u: number): void }
```
with:
```ts
export interface Picked { path: string; loc: number; first: number; last: number } // first/last: step indices
export interface City { render(u: number): void; pick(clientX: number, clientY: number, u: number): Picked | null }
```
Replace the controls block:
```ts
  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.autoRotate = true
  controls.autoRotateSpeed = 0.4
```
with:
```ts
  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  // The auto camera flies until the user drags (> 5 px) or scrolls; double-click hands it back.
  let manual = false
  let down: { x: number; y: number } | null = null
  canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY } })
  canvas.addEventListener('pointermove', e => {
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) manual = true
  })
  addEventListener('pointerup', () => { down = null })
  canvas.addEventListener('wheel', () => { manual = true }, { passive: true })
  canvas.addEventListener('dblclick', () => { manual = false })
```
After `group.add(rain.object)`, add:
```ts
  const ext = extents(model.files, lay, model.commits.length)
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2()
```
In `render(u)`, replace:
```ts
      controls.update()
```
with:
```ts
      if (manual) controls.update()
      else {
        const p = autoCamera(u, tl, ext, S)
        camera.position.set(p.x, p.y, p.z)
        camera.lookAt(0, 0, 0)
      }
```
Add a `pick` method to the returned object, after `render`:
```ts
    pick(clientX, clientY, u) {
      const r = canvas.getBoundingClientRect()
      ray.setFromCamera(ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), camera)
      mesh.computeBoundingSphere() // instances move every frame; the raycast pre-check needs a fresh sphere
      const id = ray.intersectObject(mesh)[0]?.instanceId
      if (id === undefined) return null
      const f = files[id], k = sampleAt(tl, f.s, u)
      if (k < 0 || f.s[k][1] === 0) return null
      return { path: f.path, loc: f.s[k][1], first: f.s[0][0], last: f.s[k][0] }
    },
```

- [ ] **Step 3: HUD time and tooltip in main.ts and index.html**

In `packages/web/index.html`, replace the `#hud` CSS rule with:
```css
  #hud { position: fixed; top: 12px; left: 16px; opacity: .9; pointer-events: none; text-shadow: 0 1px 3px rgba(0,0,0,.7) }
  #tip { position: fixed; max-width: 420px; padding: 8px 10px; border-radius: 6px; background: rgba(15,18,24,.88); white-space: pre-wrap; pointer-events: none; font-size: 13px }
```
and add below `<div id="hud">loading…</div>`:
```html
<div id="tip" hidden></div>
```

In `packages/web/main.ts`:

Replace:
```ts
const city = createCity($<HTMLCanvasElement>('city'), model, lay, tl)
```
with:
```ts
const canvas = $<HTMLCanvasElement>('city'), tip = $<HTMLDivElement>('tip')
const city = createCity(canvas, model, lay, tl)
// A commit's author-local time as an ISO string ("2026-09-10T23:12:00.000Z" = 23:12 where the author was).
const local = (i: number) => { const [t, tz] = model.commits[i]; return new Date((t + tz * 60) * 1000).toISOString() }
```
In `hud()`, replace:
```ts
  const [t, tz] = model.commits[Math.max(i, 0)]
  const date = new Date((t + tz * 60) * 1000).toISOString().slice(0, 10) // the author's local date
```
with:
```ts
  const iso = local(Math.max(i, 0))
  const date = `${iso.slice(0, 10)} ${iso.slice(11, 16)}` // the author's local date and time
```
Append before `requestAnimationFrame(frame)` (the last line):
```ts
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
```

- [ ] **Step 4: Typecheck and screenshot**

```bash
npm test && npm run typecheck
shot t7-early 1
shot t7-mid 12
shot t7-end 31.5
```
Expected: in all three the city fills roughly the middle two-thirds of the frame (early is zoomed in on the first few buildings, end shows the whole city), and the HUD reads `… · 2026-09-10 HH:MM · commit 738/738 · …` at the end.

- [ ] **Step 5: Manual check (headless can't click)**

Ask the user to open `http://localhost:5173` and confirm:
1. Clicking a building shows its path, lines, since and last-touched dates.
2. Dragging takes over the camera and it stays where they leave it.
3. Double-clicking returns to the auto camera.

- [ ] **Step 6: Commit**

```bash
git add packages/web/camera.ts packages/web/city.ts packages/web/main.ts packages/web/index.html
git commit -m "web: auto camera framing the built-up area, click-to-inspect, HUD time"
```

---

### Task 8: Optional bloom, then ship

**Files:**
- Modify: `packages/web/city.ts` (only if bloom is kept)

- [ ] **Step 1: Try bloom**

In `packages/web/city.ts`, add the imports:
```ts
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
```
Right after `const sky = createSky(scene, S)` (the camera and scene exist by then, and `resize()` is defined later), add:
```ts
  // Bloom makes lit windows glow after dark; the threshold keeps daylit surfaces out of it.
  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.4, 0.8)
  composer.addPass(bloom)
  composer.addPass(new OutputPass())
```
In `resize()`, after `renderer.setSize(...)`, add:
```ts
    composer.setSize(canvas.clientWidth, canvas.clientHeight)
```
In `render(u)`, replace `renderer.render(scene, camera)` with:
```ts
      bloom.strength = 0.15 + 0.6 * night.value
      composer.render()
```
The `OutputPass` applies the renderer's ACES tone mapping, so leave `renderer.toneMapping` as it is.

- [ ] **Step 2: Compare and decide**

```bash
npm run typecheck
shot t8-night-bloom 2
shot t8-day-bloom 21.3
```
Compare with `t5-night.png` and `t5-day.png`. Keep bloom only if the night windows glow better AND daylight isn't washed out. If it doesn't help, revert the bloom changes: `git checkout packages/web/city.ts`.

- [ ] **Step 3: Full verification**

Stop the dev server, then:
```bash
npm test && npm run typecheck && npm run build
```
Expected: `ℹ fail 0`, typecheck clean, the build succeeds (the >500 kB chunk warning is expected, since it's three.js).

- [ ] **Step 4: Commit and deploy**

```bash
git add -A packages/web
git commit -m "web: bloom for night windows"   # skip if bloom was reverted and nothing is staged
git push
gh run watch "$(gh run list --workflow pages --limit 1 --json databaseId -q '.[0].databaseId')" --exit-status
```
Expected: the run is green.

- [ ] **Step 5: Check the live site**

Using the `shot` function with the live URL instead of localhost (copy the function body and swap in the URL):
- `https://dat999zx.github.io/chronocity/?u=13.6` shows the storm;
- `?u=2` shows night windows;
- `?u=31.5` shows the colored end state.

Give the user the link and ask them to watch one full playback and try clicking and dragging.
