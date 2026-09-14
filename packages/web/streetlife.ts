import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { District } from '@chronocity/core/layout.ts'

// Traffic lights at the corners of the main blocks and pedestrians walking their curbs: only shown while driving,
// on real time like the car. People stop and hop out of the way when the car comes close.

const CYCLE = 9               // seconds: green 4, yellow 1, red 4
const MAX_PEOPLE = 160
const PERSON_SPEED = [0.25, 0.45] // world units per second
const SHIRTS = [0xe4573d, 0x3d8be4, 0xf2c14e, 0x5bbf7a, 0xf4f4f4, 0x9b6fd6, 0xe98fb0, 0x2a2f38]

export interface StreetLife {
  object: THREE.Group
  update(dt: number, carX: number, carZ: number): void
}

interface Walker { loop: [x: number, z: number, w: number, d: number]; s: number; speed: number; wait: number; hop: number; phase: number }

export function createStreetLife(districts: District[]): StreetLife {
  const group = new THREE.Group()
  const blocks = districts.filter(d => d[4] === 1)
  const hash = (a: number, b: number) => { const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return s - Math.floor(s) }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), c = new THREE.Color()

  // Traffic lights: one on each corner of every top-level block, just out in the street.
  const corners: [x: number, z: number, phase: number][] = []
  for (const [x, z, w, d] of blocks)
    for (const [cx, cz, ox, oz] of [[x, z, -1, -1], [x + w, z, 1, -1], [x, z + d, -1, 1], [x + w, z + d, 1, 1]])
      corners.push([cx + ox * 0.12, cz + oz * 0.12, hash(cx, cz) * CYCLE])
  const n = corners.length
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.025, 0.03, 1.15, 8).translate(0, 0.575, 0), new THREE.MeshStandardMaterial({ color: 0x3a3f47, metalness: 0.6, roughness: 0.4 }), n)
  const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.11, 0.32, 0.1).translate(0, 1.28, 0), new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.6 }), n)
  const lamp = new THREE.SphereGeometry(0.038, 12, 10)
  // Red / yellow / green on both faces of the head. Colours above 1 make a lit lamp bloom.
  const ON = [new THREE.Color(3, 0.25, 0.15), new THREE.Color(3, 2.1, 0.2), new THREE.Color(0.3, 3, 0.8)]
  const OFF = [new THREE.Color(0.25, 0.04, 0.03), new THREE.Color(0.25, 0.18, 0.03), new THREE.Color(0.03, 0.22, 0.08)]
  const lamps = [1.38, 1.28, 1.18].map((y, l) => {
    const mesh = new THREE.InstancedMesh(lamp, new THREE.MeshBasicMaterial({ toneMapped: false }), n * 2)
    corners.forEach(([x, z], i) => {
      for (const side of [0, 1]) {
        mesh.setMatrixAt(i * 2 + side, m.makeTranslation(x, y, z + (side ? 0.052 : -0.052)))
        mesh.setColorAt(i * 2 + side, OFF[l])
      }
    })
    return mesh
  })
  corners.forEach(([x, z], i) => {
    poles.setMatrixAt(i, m.makeTranslation(x, 0, z))
    heads.setMatrixAt(i, m.makeTranslation(x, 0, z))
  })
  poles.castShadow = heads.castShadow = true
  group.add(poles, heads, ...lamps)

  // Pedestrians walk loops just inside each block's edge (its curb), spread by block perimeter.
  const perimeter = blocks.reduce((sum, [, , w, d]) => sum + 2 * (w + d), 0)
  const walkers: Walker[] = []
  blocks.forEach(([x, z, w, d], b) => {
    const inset = Math.min(0.18, 0.035 * Math.min(w, d)), loop: Walker['loop'] = [x + inset, z + inset, w - 2 * inset, d - 2 * inset]
    const count = Math.round((MAX_PEOPLE * 2 * (w + d)) / Math.max(1, perimeter))
    for (let i = 0; i < count; i++) {
      const r = hash(b, i)
      walkers.push({ loop, s: r * 2 * (loop[2] + loop[3]), speed: (PERSON_SPEED[0] + (PERSON_SPEED[1] - PERSON_SPEED[0]) * hash(i, b)) * (r < 0.5 ? 1 : -1), wait: 0, hop: 0, phase: r * 10 })
    }
  })
  const skin = new THREE.Color(0xe0b48f), trousers = new THREE.Color(0x2b3140)
  const tint = (g: THREE.BufferGeometry, col: THREE.Color) => {
    const arr = new Float32Array(g.attributes.position.count * 3)
    for (let i = 0; i < arr.length; i += 3) arr.set([col.r, col.g, col.b], i)
    return g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  }
  const legsHead = mergeGeometries([
    tint(new THREE.BoxGeometry(0.07, 0.13, 0.05).translate(0, 0.065, 0).toNonIndexed(), trousers),
    tint(new THREE.SphereGeometry(0.036, 10, 8).translate(0, 0.27, 0).toNonIndexed(), skin),
  ])!
  const people = new THREE.InstancedMesh(legsHead, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), walkers.length)
  const shirts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.095, 0.11, 0.06).translate(0, 0.185, 0), new THREE.MeshStandardMaterial({ roughness: 0.8 }), walkers.length)
  walkers.forEach((_, i) => shirts.setColorAt(i, c.setHex(SHIRTS[Math.floor(hash(i, 7) * SHIRTS.length)])))
  for (const mesh of [people, shirts]) {
    mesh.castShadow = true
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.frustumCulled = false
    group.add(mesh)
  }

  let t = 0
  return {
    object: group,
    update(dt, carX, carZ) {
      t += dt
      corners.forEach(([, , phase], i) => {
        const k = (t + phase) % CYCLE, state = k < 4 ? 2 : k < 5 ? 1 : 0 // 2 green, 1 yellow, 0 red
        for (let l = 0; l < 3; l++) for (const side of [0, 1]) lamps[l].setColorAt(i * 2 + side, l === state ? ON[l] : OFF[l])
      })
      lamps.forEach(l => { if (l.instanceColor) l.instanceColor.needsUpdate = true })

      walkers.forEach((wk, i) => {
        const len = 2 * (wk.loop[2] + wk.loop[3]), here = along(wk.loop, wk.s)
        if (Math.hypot(here.x - carX, here.z - carZ) < 0.55 && wk.wait <= 0) { wk.wait = 1.2; wk.hop = 0 } // a car! stop and hop
        if (wk.wait > 0) { wk.wait -= dt; wk.hop += dt } else { wk.s = (((wk.s + wk.speed * dt) % len) + len) % len; wk.phase += dt * 9 }
        const at = along(wk.loop, wk.s), ahead = along(wk.loop, wk.s + Math.sign(wk.speed) * 0.05)
        const jump = wk.wait > 0 ? Math.max(0, Math.sin(Math.min(1, wk.hop / 0.4) * Math.PI)) * 0.12 : Math.abs(Math.sin(wk.phase)) * 0.012
        q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.atan2(ahead.x - at.x, ahead.z - at.z))
        m.compose(p.set(at.x, 0.1 + jump, at.z), q, one)
        people.setMatrixAt(i, m)
        shirts.setMatrixAt(i, m)
      })
      people.instanceMatrix.needsUpdate = shirts.instanceMatrix.needsUpdate = true
    },
  }
}

// A point s along a rectangle's perimeter (clockwise from its min corner).
function along([x, z, w, d]: [number, number, number, number], s: number): { x: number; z: number } {
  const len = 2 * (w + d)
  s = ((s % len) + len) % len
  if (s < w) return { x: x + s, z }
  if ((s -= w) < d) return { x: x + w, z: z + s }
  if ((s -= d) < w) return { x: x + w - s, z: z + d }
  return { x, z: z + d - (s - w) }
}
