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
