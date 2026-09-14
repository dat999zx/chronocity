import * as THREE from 'three'
import type { District } from '@chronocity/core/layout.ts'

// Drive mode: a little car on the city's streets with a chase camera. It moves on real frame time, never playback
// time, so it drives the same whether the replay is playing or paused. Standing buildings block it (it slides along
// their walls) and it rides up onto the district plates.

export const SPEED = 5      // world units per second at full throttle (tuning knob)
export const BOOST = 2.5    // Shift multiplies the top speed
const REVERSE = 0.4         // reverse top speed, as a share of SPEED
const TURN = 2.2            // radians per second at full speed and full lock
const R = 0.22              // the car's collision radius
const CELL = 2              // spatial grid cell for building lookups
const CHASE = new THREE.Vector3(0, 1.0, -2.3) // camera offset behind and above the car, in the car's frame

export interface Lot { x: number; z: number; w: number; d: number; h: number } // a building's footprint; h > 0 = standing

export interface Drive {
  readonly active: boolean
  enter(): void
  exit(): void
  update(dt: number): void // move the car and the camera
  ahead(): number          // the standing building just in front of the car, or -1
}

export function createDrive(group: THREE.Group, camera: THREE.PerspectiveCamera, lots: Lot[], districts: District[], S: number): Drive {
  const car = carModel()
  car.visible = false
  group.add(car)

  // Buildings bucketed by grid cell, so a frame only tests the few around the car.
  const grid = new Map<number, number[]>()
  const key = (cx: number, cz: number) => cx * 65536 + cz
  lots.forEach((b, i) => {
    for (let cx = Math.floor(b.x / CELL); cx <= Math.floor((b.x + b.w) / CELL); cx++)
      for (let cz = Math.floor(b.z / CELL); cz <= Math.floor((b.z + b.d) / CELL); cz++) {
        const k = key(cx, cz)
        grid.get(k)?.push(i) ?? grid.set(k, [i])
      }
  })
  function near(x: number, z: number, fn: (i: number) => void) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL)
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) grid.get(key(cx + dx, cz + dz))?.forEach(fn)
  }
  // Top of the deepest district plate under a point (plates stack 0.05 per folder level).
  function ground(x: number, z: number): number {
    let top = 0
    for (const [dx, dz, w, d, depth] of districts)
      if (x >= dx && x <= dx + w && z >= dz && z <= dz + d) top = Math.max(top, depth * 0.05 + 0.05)
    return top
  }

  const keys = new Set<string>()
  addEventListener('keydown', e => {
    if (!active || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
    keys.add(e.code)
    if (e.code.startsWith('Arrow')) e.preventDefault()
  })
  addEventListener('keyup', e => keys.delete(e.code))
  addEventListener('blur', () => keys.clear())
  const down = (...codes: string[]) => codes.some(c => keys.has(c))

  let active = false, v = 0, heading = Math.PI
  const pos = new THREE.Vector3(), look = new THREE.Vector3(), world = new THREE.Vector3(), off = new THREE.Vector3()

  // Push the car out of any standing building: the closest point on its footprint, then out along that normal (a slide).
  function collide() {
    near(pos.x, pos.z, i => {
      const b = lots[i]
      if (b.h < 0.05) return
      const cx = Math.max(b.x, Math.min(pos.x, b.x + b.w)), cz = Math.max(b.z, Math.min(pos.z, b.z + b.d))
      let nx = pos.x - cx, nz = pos.z - cz
      const dist = Math.hypot(nx, nz)
      if (dist >= R) return
      if (dist < 1e-6) { // centre inside the footprint: leave by the nearest side
        const sides = [pos.x - b.x, b.x + b.w - pos.x, pos.z - b.z, b.z + b.d - pos.z], m = Math.min(...sides)
        ;[nx, nz] = [[-1, 0], [1, 0], [0, -1], [0, 1]][sides.indexOf(m)]
        pos.x += nx * (m + R)
        pos.z += nz * (m + R)
      } else {
        pos.x += (nx / dist) * (R - dist)
        pos.z += (nz / dist) * (R - dist)
      }
      v *= 0.97 // scraping a wall costs a little speed
    })
  }

  // Is (x, y, z) inside a standing building?
  function inside(x: number, y: number, z: number): boolean {
    let hit = false
    near(x, z, i => {
      const b = lots[i]
      hit ||= b.h > y && x > b.x - 0.05 && x < b.x + b.w + 0.05 && z > b.z - 0.05 && z < b.z + b.d + 0.05
    })
    return hit
  }

  function chase(dt: number) {
    world.copy(pos).add(group.position)
    off.copy(CHASE).applyAxisAngle(THREE.Object3D.DEFAULT_UP, heading)
    // In a narrow street the camera would sit inside a building: pull it in to just before the first one in the way.
    let t = 1
    for (let j = 1; j <= 12; j++) {
      const f = j / 12
      if (inside(pos.x + off.x * f, pos.y + 0.3 + (off.y - 0.3) * f, pos.z + off.z * f)) { t = Math.max(0.15, (j - 1) / 12); break }
    }
    off.multiplyScalar(t).add(world)
    camera.position.lerp(off, dt < 0 ? 1 : 1 - Math.exp(-dt * 6))
    look.set(Math.sin(heading) * 1.5, 0.35, Math.cos(heading) * 1.5).add(world)
    camera.lookAt(look)
  }

  return {
    get active() { return active },
    enter() {
      active = true
      v = 0
      heading = Math.PI // facing -z: into the city from its south edge
      pos.set(S / 2, 0, S + 1.2)
      car.visible = true
      chase(-1) // snap the camera behind the car
    },
    exit() {
      active = false
      car.visible = false
      keys.clear()
    },
    update(dt) {
      const top = SPEED * (down('ShiftLeft', 'ShiftRight') ? BOOST : 1)
      const throttle = +down('KeyW', 'ArrowUp') - +down('KeyS', 'ArrowDown')
      if (throttle > 0) v += (top - v) * (1 - Math.exp(-dt * 2.2))
      else if (throttle < 0) v += (v > 0.1 ? -v * 4 * dt - 6 * dt : (-top * REVERSE - v) * (1 - Math.exp(-dt * 3)))
      else v *= Math.exp(-dt * 1.8)
      const steer = +down('KeyA', 'ArrowLeft') - +down('KeyD', 'ArrowRight')
      heading += steer * TURN * dt * Math.max(-1, Math.min(1, v / SPEED * 2))

      // Move in steps shorter than the car, so a slow frame (dt up to 0.1 s, 1.25 units at full boost) can't tunnel
      // through a thin building.
      const travel = Math.abs(v * dt), n = Math.max(1, Math.ceil(travel / (R * 0.5)))
      for (let j = 0; j < n; j++) {
        pos.x += (Math.sin(heading) * v * dt) / n
        pos.z += (Math.cos(heading) * v * dt) / n
        collide()
      }
      pos.x = Math.max(-S * 0.5, Math.min(S * 1.5, pos.x))
      pos.z = Math.max(-S * 0.5, Math.min(S * 1.5, pos.z))
      pos.y += (ground(pos.x, pos.z) - pos.y) * (1 - Math.exp(-dt * 12))

      car.position.copy(pos)
      car.rotation.y = heading
      for (const w of car.userData.wheels as THREE.Object3D[]) w.rotation.x += (v * dt) / 0.07
      chase(dt)
    },
    ahead() {
      const px = pos.x + Math.sin(heading) * 1.1, pz = pos.z + Math.cos(heading) * 1.1
      let best = -1, bestD = 0.9
      near(px, pz, i => {
        const b = lots[i]
        if (b.h < 0.05) return
        const d = Math.hypot(px - Math.max(b.x, Math.min(px, b.x + b.w)), pz - Math.max(b.z, Math.min(pz, b.z + b.d)))
        if (d < bestD) { bestD = d; best = i }
      })
      return best
    },
  }
}

// A toy car, ~0.5 long, nose along +z: body, glass cabin, four wheels, head- and taillights that glow at night.
function carModel(): THREE.Group {
  const car = new THREE.Group()
  const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.5, ...extra })
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m)
    mesh.position.set(x, y, z)
    mesh.castShadow = true
    car.add(mesh)
    return mesh
  }
  box(0.28, 0.1, 0.52, mat(0xd8452f, { metalness: 0.3, roughness: 0.35 }), 0, 0.1, 0)
  box(0.24, 0.09, 0.26, mat(0x1d2430, { metalness: 0.6, roughness: 0.15 }), 0, 0.19, -0.03)
  const head = mat(0xfff2c0, { emissive: 0xfff2c0, emissiveIntensity: 2 }), tail = mat(0xff3020, { emissive: 0xff2010, emissiveIntensity: 1.5 })
  for (const x of [-0.09, 0.09]) {
    box(0.06, 0.03, 0.01, head, x, 0.11, 0.261)
    box(0.06, 0.03, 0.01, tail, x, 0.11, -0.261)
  }
  const wheelGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.05, 12).rotateZ(Math.PI / 2), tyre = mat(0x15171b, { roughness: 0.9 })
  car.userData.wheels = [-0.15, 0.15].flatMap(z => [-0.14, 0.14].map(x => {
    const w = new THREE.Mesh(wheelGeo, tyre)
    w.position.set(x, 0.07, z)
    car.add(w)
    return w
  }))
  return car
}
