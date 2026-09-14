import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { sampleAt, signals, type Timeline } from '@chronocity/core/timeline.ts'
import { langOf } from '@chronocity/core/lang.ts'
import type { CityLayout } from '@chronocity/core/layout.ts'
import type { Model, Sample } from '@chronocity/core/model.ts'
import type { Selection } from './selection.ts'
import { createSky } from './sky.ts'
import { createBuildingMaterial } from './buildingMaterial.ts'
import { createRain } from './rain.ts'
import { autoCamera, extents } from './camera.ts'

export const HEIGHT_K = 0.25  // world units per sqrt(LOC) (tuning knob)
export const MAX_H = 24       // tallest possible building (tuning knob)
export const DATA_MAX_H = 2.5 // data files (json, csv, ...) stay low: warehouses, not towers
export const RISE = 0.6       // playback seconds for a height change to ease in
export const GLOW = 1.5       // playback seconds a touched file's windows stay lit
export const FLY_MS = 900     // camera flight to and from a selection
const MUTE = 0.15             // how far language colors are pulled toward grey (tuning knob)
const JITTER = 0.1            // per-building lightness spread, so a one-language city isn't one flat color
const GREY = new THREE.Color(0xb8bcc4)
const GROUND = new THREE.Color(0x2a2e35) // root plate: asphalt
const PLATE = new THREE.Color(0x5a6372)  // folder plates three levels deep; shallower levels blend toward GROUND

const easeOut = (p: number) => 1 - (1 - p) ** 3
const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2)
// Stable 0..1 hash of a path (FNV-1a), for per-building variation that never changes between frames.
const hash01 = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0) / 4294967296
}

interface Building { path: string; s: Sample[]; x: number; z: number; w: number; d: number; maxH: number; h: number }
type Pose = { pos: THREE.Vector3; target: THREE.Vector3 }

export interface City {
  render(u: number): void
  /** The standing building or district plate under a screen point; null over sky and open ground. */
  pick(clientX: number, clientY: number): Selection | null
  /** Brighten the building under the cursor (districts only get a label, from main.ts). */
  hover(sel: Selection | null): void
  /** Spotlight and fly to a selection; null or the root district flies back to the auto camera. */
  select(sel: Selection | null): void
  /** Screen point to pin the panel to; null when it's off-screen or the building isn't standing. */
  anchor(sel: Selection): { x: number; y: number } | null
}

export function createCity(canvas: HTMLCanvasElement, model: Model, lay: CityLayout, tl: Timeline): City {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap // three 0.186 dropped PCFSoft; softness comes from shadow.radius
  const scene = new THREE.Scene()

  const S = lay.size
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, S * 20)
  camera.position.set(S * 0.9, S * 0.8, S * 0.9)
  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true

  // Camera modes: 'auto' flies by itself, 'manual' after a drag or scroll, 'focus' orbits a selection.
  let mode: 'auto' | 'manual' | 'focus' = 'auto'
  let fly: { from: Pose; to: (u: number) => Pose; t0: number; then: 'auto' | 'focus' } | null = null
  let down: { x: number; y: number } | null = null
  canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY } })
  canvas.addEventListener('pointermove', e => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) <= 5) return
    fly = null // the user grabbed the camera mid-flight
    if (mode === 'auto') mode = 'manual'
  })
  addEventListener('pointerup', () => { down = null })
  canvas.addEventListener('wheel', () => {
    fly = null
    if (mode === 'auto') mode = 'manual'
  }, { passive: true })
  canvas.addEventListener('dblclick', () => flyTo(autoPose, 'auto'))

  const sig = signals(model, tl)
  const sky = createSky(scene, S)

  // Bloom makes lit windows glow after dark; the threshold keeps daylit surfaces out of it.
  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.4, 0.8)
  composer.addPass(bloom)
  composer.addPass(new OutputPass())

  const group = new THREE.Group()
  group.position.set(-S / 2, 0, -S / 2) // lay out in [0, S], orbit around the centre
  scene.add(group)
  const box = new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5) // origin at the min corner, base on y=0
  const m = new THREE.Matrix4(), color = new THREE.Color()

  // A plain that runs out to the horizon, where the fog blends it into the sky: the city stands somewhere.
  const ground = new THREE.Mesh(new THREE.CircleGeometry(S * 14, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 1 }))
  ground.position.y = -0.02
  ground.receiveShadow = true
  scene.add(ground)

  // Plates: the ground is dark asphalt and each folder level is a little lighter, so streets read as gaps.
  const plates = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ roughness: 1 }), lay.districts.length)
  lay.districts.forEach(([x, z, w, d, depth], i) => {
    m.makeScale(w, 0.05, d).setPosition(x, depth * 0.05, z)
    plates.setMatrixAt(i, m)
    plates.setColorAt(i, color.copy(GROUND).lerp(PLATE, Math.min(1, depth / 3)))
  })
  plates.receiveShadow = true
  group.add(plates)

  const files: Building[] = model.files.map(([path, s]) => {
    const [x, z, w, d] = lay.lots.get(path)!
    const g = 0.15 * Math.min(w, d) // building footprint = lot inset by 15%
    return { path, s, x: x + g, z: z + g, w: w - 2 * g, d: d - 2 * g, maxH: langOf(path).data ? DATA_MAX_H : MAX_H, h: 0 }
  })
  const night = { value: 0 }, spot = { value: 0 }, hover = { value: -1 }
  const glow = new THREE.InstancedBufferAttribute(new Float32Array(files.length), 1).setUsage(THREE.DynamicDrawUsage)
  const inSel = new THREE.InstancedBufferAttribute(new Float32Array(files.length).fill(1), 1)
  const geo = box.clone()
  geo.setAttribute('aGlow', glow)
  geo.setAttribute('aSel', inSel)
  const mesh = new THREE.InstancedMesh(geo, createBuildingMaterial({ night, spot, hover }), files.length)
  files.forEach((f, i) =>
    mesh.setColorAt(i, color.setHex(langOf(f.path).color).lerp(GREY, MUTE).offsetHSL(0, 0, (hash01(f.path) - 0.5) * JITTER)))
  mesh.castShadow = mesh.receiveShadow = true
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  mesh.frustumCulled = false // instances change every frame; a cached bounding sphere would go stale
  group.add(mesh)
  const rain = createRain(S)
  group.add(rain.object)
  const ext = extents(model.files, lay, model.commits.length)
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), v = new THREE.Vector3()
  let spotTarget = 0, lastNow = performance.now()

  const heightOf = (f: Building, loc: number) => Math.min(f.maxH, HEIGHT_K * Math.sqrt(loc))
  function heightAt(f: Building, k: number, u: number): number {
    if (k < 0) return 0
    const from = k > 0 ? heightOf(f, f.s[k - 1][1]) : 0
    const to = heightOf(f, f.s[k][1])
    const p = Math.min(1, (u - tl.u[f.s[k][0]]) / RISE)
    return from + (to - from) * easeOut(p)
  }

  const world = (x: number, y: number, z: number) => new THREE.Vector3(x - S / 2, y, z - S / 2)
  const isRoot = (sel: Selection) => sel.kind === 'district' && lay.districts[sel.index][4] === 0

  function autoPose(u: number): Pose {
    const p = autoCamera(u, tl, ext, S)
    return { pos: new THREE.Vector3(p.x, p.y, p.z), target: new THREE.Vector3() }
  }

  // Frame the selection from the current viewing direction, so the flight feels like leaning in, not teleporting.
  function focusPose(sel: Selection): Pose {
    let target: THREE.Vector3, dist: number
    if (sel.kind === 'file') {
      const f = files[sel.index], top = Math.max(f.h, 1)
      target = world(f.x + f.w / 2, top * 0.6, f.z + f.d / 2)
      dist = Math.max(10, top * 2.2 + Math.max(f.w, f.d) * 4)
    } else {
      // Frame the district's towers too, or the camera lands among them.
      const [x, z, w, d, , folder] = lay.districts[sel.index], prefix = folder + '/'
      let tallest = 0
      for (const f of files) if (f.path.startsWith(prefix)) tallest = Math.max(tallest, f.h)
      target = world(x + w / 2, tallest * 0.3, z + d / 2)
      dist = Math.max(10, Math.hypot(w, d) * 1.2, tallest * 2.4)
    }
    const dir = camera.position.clone().sub(target).setY(0)
    if (dir.lengthSq() < 1e-6) dir.set(1, 0, 1)
    dir.normalize()
    return { pos: target.clone().addScaledVector(dir, dist * 0.85).setY(target.y + dist * 0.5), target }
  }

  function flyTo(to: (u: number) => Pose, then: 'auto' | 'focus') {
    fly = { from: { pos: camera.position.clone(), target: controls.target.clone() }, to, t0: performance.now(), then }
  }

  function resize() {
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false)
    composer.setSize(canvas.clientWidth, canvas.clientHeight)
    camera.aspect = canvas.clientWidth / canvas.clientHeight
    camera.updateProjectionMatrix()
  }
  resize()
  addEventListener('resize', resize)

  return {
    render(u) {
      const now = performance.now(), dt = Math.min(0.1, (now - lastNow) / 1000)
      lastNow = now
      if (fly) {
        const p = Math.min(1, (now - fly.t0) / FLY_MS), e = easeInOut(p), to = fly.to(u)
        camera.position.lerpVectors(fly.from.pos, to.pos, e)
        controls.target.lerpVectors(fly.from.target, to.target, e)
        camera.lookAt(controls.target)
        if (p === 1) {
          mode = fly.then
          fly = null
        }
      } else if (mode === 'auto') {
        const pose = autoPose(u)
        camera.position.copy(pose.pos)
        controls.target.copy(pose.target)
        camera.lookAt(pose.target)
      } else controls.update() // manual, or orbiting the focused selection
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
    pick(clientX, clientY) {
      const r = canvas.getBoundingClientRect()
      ray.setFromCamera(ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), camera)
      mesh.computeBoundingSphere() // instances move every frame; the raycast pre-check needs a fresh sphere
      for (const hit of ray.intersectObjects([mesh, plates], false)) {
        if (hit.instanceId === undefined) continue
        if (hit.object === plates) return { kind: 'district', index: hit.instanceId }
        if (files[hit.instanceId].h > 1e-3) return { kind: 'file', index: hit.instanceId }
      }
      return null
    },
    hover(sel) {
      hover.value = sel?.kind === 'file' ? sel.index : -1
    },
    select(sel) {
      const arr = inSel.array as Float32Array
      if (!sel || isRoot(sel)) {
        arr.fill(1)
        spotTarget = 0
        if (mode === 'focus' || fly?.then === 'focus') flyTo(autoPose, 'auto')
      } else {
        if (sel.kind === 'file') {
          arr.fill(0)
          arr[sel.index] = 1
        } else {
          const prefix = lay.districts[sel.index][5] + '/'
          files.forEach((f, i) => { arr[i] = f.path.startsWith(prefix) ? 1 : 0 })
        }
        spotTarget = 1
        const pose = focusPose(sel)
        flyTo(() => pose, 'focus')
      }
      inSel.needsUpdate = true
    },
    anchor(sel) {
      if (sel.kind === 'file') {
        const f = files[sel.index]
        if (f.h <= 1e-3) return null
        v.copy(world(f.x + f.w / 2, f.h + 0.3, f.z + f.d / 2))
      } else {
        const [x, z, w, d, depth] = lay.districts[sel.index]
        v.copy(world(x + w / 2, depth * 0.05 + 0.1, z + d / 2))
      }
      v.project(camera)
      if (v.z < -1 || v.z > 1) return null
      const r = canvas.getBoundingClientRect()
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height }
    },
  }
}
