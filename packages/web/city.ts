import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { sampleAt, signals, type Timeline } from '@chronocity/core/timeline.ts'
import { langOf } from '@chronocity/core/lang.ts'
import type { CityLayout } from '@chronocity/core/layout.ts'
import type { Model, Sample } from '@chronocity/core/model.ts'
import { createSky } from './sky.ts'
import { createBuildingMaterial } from './buildingMaterial.ts'
import { createRain } from './rain.ts'
import { autoCamera, extents } from './camera.ts'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'

export const HEIGHT_K = 0.25  // world units per sqrt(LOC) (tuning knob)
export const MAX_H = 24       // tallest possible building (tuning knob)
export const DATA_MAX_H = 2.5 // data files (json, csv, ...) stay low: warehouses, not towers
export const RISE = 0.6       // playback seconds for a height change to ease in
export const GLOW = 1.5       // playback seconds a touched file's windows stay lit
const MUTE = 0.25             // how far language colors are pulled toward grey (tuning knob)
const GREY = new THREE.Color(0xb8bcc4)
const GROUND = new THREE.Color(0x1c2028) // root plate: asphalt
const PLATE = new THREE.Color(0x4a5160)  // folder plates three levels deep; shallower levels blend toward GROUND

const easeOut = (p: number) => 1 - (1 - p) ** 3

interface Building { path: string; s: Sample[]; x: number; z: number; w: number; d: number; maxH: number }
export interface Picked { path: string; loc: number; first: number; last: number } // first/last: step indices
export interface City { render(u: number): void; pick(clientX: number, clientY: number, u: number): Picked | null }

export function createCity(canvas: HTMLCanvasElement, model: Model, lay: CityLayout, tl: Timeline): City {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  const scene = new THREE.Scene()

  const S = lay.size
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, S * 20)
  camera.position.set(S * 0.9, S * 0.8, S * 0.9)
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
  const night = { value: 0 }
  const glow = new THREE.InstancedBufferAttribute(new Float32Array(files.length), 1).setUsage(THREE.DynamicDrawUsage)
  const geo = box.clone()
  geo.setAttribute('aGlow', glow)
  const mesh = new THREE.InstancedMesh(geo, createBuildingMaterial(night), files.length)
  files.forEach((f, i) => mesh.setColorAt(i, color.setHex(langOf(f.path).color).lerp(GREY, MUTE)))
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  mesh.frustumCulled = false // instances change every frame; a cached bounding sphere would go stale
  group.add(mesh)
  const rain = createRain(S)
  group.add(rain.object)
  const ext = extents(model.files, lay, model.commits.length)
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2()

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
    composer.setSize(canvas.clientWidth, canvas.clientHeight)
    camera.aspect = canvas.clientWidth / canvas.clientHeight
    camera.updateProjectionMatrix()
  }
  resize()
  addEventListener('resize', resize)

  return {
    render(u) {
      night.value = sky.update(sig.sky(u), sig.fog(u))
      rain.update(u, sig.rain(u))
      for (let i = 0; i < files.length; i++) {
        const f = files[i], k = sampleAt(tl, f.s, u), h = heightAt(f, k, u)
        glow.setX(i, k < 0 ? 0 : Math.max(0, 1 - (u - tl.u[f.s[k][0]]) / GLOW))
        if (h < 1e-3) m.makeScale(0, 0, 0)
        else m.makeScale(f.w, h, f.d).setPosition(f.x, 0, f.z)
        mesh.setMatrixAt(i, m)
      }
      mesh.instanceMatrix.needsUpdate = true
      glow.needsUpdate = true
      if (manual) controls.update()
      else {
        const p = autoCamera(u, tl, ext, S)
        camera.position.set(p.x, p.y, p.z)
        camera.lookAt(0, 0, 0)
      }
      bloom.strength = 0.15 + 0.6 * night.value
      composer.render()
    },
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
  }
}
