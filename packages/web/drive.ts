import * as THREE from 'three'
import type { District } from '@chronocity/core/layout.ts'
import { createCar, CAR_W } from './car.ts'
import { createStreetLife } from './streetlife.ts'
import { createParticles } from './particles.ts'

// Drive mode: a car on the city's streets with a chase camera. It moves on real frame time, never playback time, so it
// drives the same whether the replay is playing or paused. Standing buildings block it (it slides along their walls),
// it rolls up onto curbs and plates, and a building that rises up under it flings it into the air.

export const SPEED = 5      // world units per second at full throttle (tuning knob)
export const BOOST = 2.5    // Shift multiplies the top speed
const REVERSE = 0.4         // reverse top speed, as a share of SPEED
const TURN = 2.2            // radians per second at full speed and full lock
const R = CAR_W / 2         // radius of each of the two collision circles...
const AXLE = 0.2            // ...centred this far ahead of and behind the car's middle
const STEP = 0.08           // the highest ledge the car rolls up onto: curbs and plates, never a roof
const GRAVITY = 9           // world units/s² (a toy's gravity: the real thing is floaty at this scale)
const FLING = 4             // upward speed when a building rises up under the car...
const KICK = 2.5            // ...and sideways, away from the building's middle
const CELL = 2              // spatial grid cell for building lookups
const CHASE = new THREE.Vector3(0, 1.25, -2.9) // camera offset behind and above the car, in the car's frame

export interface Lot { x: number; z: number; w: number; d: number; h: number } // a building's footprint; h > 0 = standing

export interface Drive {
  readonly active: boolean
  enter(): void
  exit(): void
  update(dt: number): void // move the car and the camera
  ahead(): number          // the standing building just in front of the car, or -1
}

export function createDrive(group: THREE.Group, camera: THREE.PerspectiveCamera, lots: Lot[], districts: District[], S: number,
  night: { value: number }): Drive {
  const car = createCar()
  car.object.visible = false
  group.add(car.object, ...car.lights) // the lights stay in the scene for good (dark unless driving at night)
  const life = createStreetLife(districts)
  const smoke = createParticles({ max: 400, color: 0xc4c8d0, gravity: -0.25, drag: 1.6, grow: 2.5, alpha: 0.45 })   // exhaust, tyres
  const dust = createParticles({ max: 200, color: 0x9d9181, gravity: 0.6, drag: 2.2, grow: 1.8, alpha: 0.6 })       // landings
  const sparks = createParticles({ max: 200, color: 0xffb454, additive: true, gravity: 7, drag: 0.6, grow: -0.7, alpha: 1 })
  const extras = [life.object, smoke.object, dust.object, sparks.object]
  for (const o of extras) { o.visible = false; group.add(o) }
  let puff = 0 // exhaust owed, in particles

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
  function near(x: number, z: number, fn: (b: Lot, i: number) => void) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL)
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) grid.get(key(cx + dx, cz + dz))?.forEach(i => fn(lots[i], i))
  }
  const within = (b: Lot, x: number, z: number) => x >= b.x && x <= b.x + b.w && z >= b.z && z <= b.z + b.d
  const blocks = (b: Lot) => b.h > 0.05 && b.h > pos.y + STEP // taller than what the car can roll onto

  // What the car rests on at (x, z): the deepest district plate (0.05 a folder level), or a roof it's already up on.
  function support(x: number, z: number): number {
    let top = 0
    for (const [dx, dz, w, d, depth] of districts) if (x >= dx && x <= dx + w && z >= dz && z <= dz + d) top = Math.max(top, depth * 0.05 + 0.05)
    near(x, z, b => { if (b.h > 0.05 && b.h <= pos.y + STEP && within(b, x, z)) top = Math.max(top, b.h) })
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

  let active = false, v = 0, heading = Math.PI, vy = 0, kx = 0, kz = 0, spin = 0, pitch = 0
  const pos = new THREE.Vector3(), look = new THREE.Vector3(), world = new THREE.Vector3(), off = new THREE.Vector3()

  // A building rose up under the car (its middle, nose or tail is inside one it can't be on): ride the roof up and
  // get flung off it, away from the building's middle.
  function fling() {
    for (const k of [0, AXLE, -AXLE]) {
      const x = pos.x + Math.sin(heading) * k, z = pos.z + Math.cos(heading) * k
      let hit: Lot | null = null
      near(x, z, b => { if (!hit && blocks(b) && within(b, x, z)) hit = b })
      const b = hit as Lot | null
      if (!b) continue
      const ax = pos.x - (b.x + b.w / 2), az = pos.z - (b.z + b.d / 2), len = Math.hypot(ax, az) || 1
      pos.y = b.h
      vy = FLING
      kx = (ax / len) * KICK
      kz = (az / len) * KICK
      spin = (Math.random() < 0.5 ? -1 : 1) * (2 + Math.random() * 2)
      dust.emit(30, pos.x, pos.y, pos.z, 0, 0.6, 0, 1.2, 1.1, 0.14) // the roof bursts up under it
      sparks.emit(20, pos.x, pos.y + 0.1, pos.z, kx * 0.4, 2, kz * 0.4, 1.8, 0.6, 0.05)
      return
    }
  }

  // Push the car's two circles out of any building taller than it can climb: out along the normal, so it slides.
  function collide() {
    for (const k of [AXLE, -AXLE]) {
      const x = pos.x + Math.sin(heading) * k, z = pos.z + Math.cos(heading) * k
      near(x, z, b => {
        if (!blocks(b)) return
        const nx = x - Math.max(b.x, Math.min(x, b.x + b.w)), nz = z - Math.max(b.z, Math.min(z, b.z + b.d))
        const dist = Math.hypot(nx, nz)
        if (dist >= R || dist < 1e-6) return // inside is fling()'s business
        pos.x += (nx / dist) * (R - dist)
        pos.z += (nz / dist) * (R - dist)
        v *= 0.97 // scraping a wall costs a little speed
        if (Math.abs(v) > 1 && Math.random() < 0.5) // sparks off the wall where it touches
          sparks.emit(2, x - (nx / dist) * R, pos.y + 0.12, z - (nz / dist) * R, (nx / dist) * 1.2, 0.8, (nz / dist) * 1.2, 0.8, 0.45, 0.045)
      })
    }
  }

  function inside(x: number, y: number, z: number): boolean {
    let hit = false
    near(x, z, b => { hit ||= b.h > y && x > b.x - 0.05 && x < b.x + b.w + 0.05 && z > b.z - 0.05 && z < b.z + b.d + 0.05 })
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
    look.set(Math.sin(heading) * 1.6, 0.4, Math.cos(heading) * 1.6).add(world)
    camera.lookAt(look)
  }

  return {
    get active() { return active },
    enter() {
      active = true
      v = vy = kx = kz = spin = pitch = 0
      heading = Math.PI // facing -z: into the city from just off its south edge
      pos.set(S / 2, 0, S + 1)
      car.object.visible = true
      for (const o of extras) o.visible = true
      car.place(pos.x, pos.y, pos.z, heading, 0)
      chase(-1) // snap the camera behind the car
    },
    exit() {
      active = false
      car.object.visible = false
      for (const o of extras) o.visible = false
      car.update(0, 0, 0, false, 0, false) // lights off
      keys.clear()
    },
    update(dt) {
      const sup = support(pos.x, pos.z), airborne = vy !== 0 || pos.y > sup + 1e-3
      const throttle = airborne ? 0 : +down('KeyW', 'ArrowUp') - +down('KeyS', 'ArrowDown')
      const steer = airborne ? 0 : +down('KeyA', 'ArrowLeft') - +down('KeyD', 'ArrowRight')
      const top = SPEED * (down('ShiftLeft', 'ShiftRight') ? BOOST : 1), braking = throttle < 0 && v > 0.1
      if (throttle > 0) v += (top - v) * (1 - Math.exp(-dt * 2.2))
      else if (braking) v -= v * 4 * dt + 6 * dt
      else if (throttle < 0) v += (-top * REVERSE - v) * (1 - Math.exp(-dt * 3))
      else if (!airborne) v *= Math.exp(-dt * 1.8)
      heading += steer * TURN * dt * Math.max(-1, Math.min(1, (v / SPEED) * 2)) + (airborne ? spin * dt : 0)

      // Move in steps shorter than the car, so a slow frame (dt up to 0.1 s, 1.25 units at full boost) can't tunnel
      // through a thin building.
      const dx = (Math.sin(heading) * v + kx) * dt, dz = (Math.cos(heading) * v + kz) * dt
      const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (R * 0.5)))
      for (let j = 0; j < n; j++) {
        pos.x += dx / n
        pos.z += dz / n
        fling()
        collide()
      }
      pos.x = Math.max(-S * 0.5, Math.min(S * 1.5, pos.x))
      pos.z = Math.max(-S * 0.5, Math.min(S * 1.5, pos.z))

      // Up and down: fall under gravity until something holds the car up; roll up curbs and plates.
      const ground = support(pos.x, pos.z)
      if (vy !== 0 || pos.y > ground + 1e-3) {
        vy -= GRAVITY * dt
        pos.y += vy * dt
        if (pos.y <= ground) { // landed: a dust cloud the harder it hit
          if (vy < -1.5) dust.emit(Math.min(40, Math.round(-vy * 6)), pos.x, ground + 0.03, pos.z, 0, 0.3, 0, 1.1, 1.2, 0.13)
          pos.y = ground
          vy = kx = kz = spin = 0
        }
      } else pos.y += (ground - pos.y) * (1 - Math.exp(-dt * 14))

      // Exhaust from the tailpipe (thick on boost), tyre smoke from the back wheels when braking hard or turning fast.
      const sx = Math.sin(heading), cz = Math.cos(heading), boost = down('ShiftLeft', 'ShiftRight') && throttle > 0
      puff += dt * (airborne ? 0 : throttle > 0 ? (boost ? 50 : 16) : 3)
      for (; puff >= 1; puff--)
        smoke.emit(1, pos.x - sx * 0.44 + cz * 0.1, pos.y + 0.09, pos.z - cz * 0.44 - sx * 0.1, -sx * 0.5, 0.15, -cz * 0.5, 0.12, boost ? 1.3 : 0.9, boost ? 0.11 : 0.07)
      if (!airborne && ((braking && v > 2) || (steer !== 0 && Math.abs(v) > SPEED * 0.9)))
        for (const s of [-1, 1]) smoke.emit(1, pos.x - sx * 0.25 + cz * s * 0.19, pos.y + 0.04, pos.z - cz * 0.25 - sx * s * 0.19, 0, 0.2, 0, 0.25, 1.4, 0.12)
      const scale = (innerHeight * Math.min(devicePixelRatio, 2)) / (2 * Math.tan((camera.fov * Math.PI) / 360))
      const lit = 1 - 0.75 * night.value // smoke and dust are lit by the sky; sparks make their own light
      smoke.update(dt, scale, lit)
      dust.update(dt, scale, lit)
      sparks.update(dt, scale)
      pitch += ((vy === 0 ? 0 : Math.max(-0.6, Math.min(0.6, -vy * 0.12))) - pitch) * (1 - Math.exp(-dt * 8)) // nose up on the way up

      car.place(pos.x, pos.y, pos.z, heading, pitch)
      car.update(dt, v, steer, braking, night.value, true)
      life.update(dt, pos.x, pos.z)
      chase(dt)
    },
    ahead() {
      const px = pos.x + Math.sin(heading) * 1.3, pz = pos.z + Math.cos(heading) * 1.3
      let best = -1, bestD = 1
      near(px, pz, (b, i) => {
        if (b.h < 0.05) return
        const d = Math.hypot(px - Math.max(b.x, Math.min(px, b.x + b.w)), pz - Math.max(b.z, Math.min(pz, b.z + b.d)))
        if (d < bestD) { bestD = d; best = i }
      })
      return best
    },
  }
}
