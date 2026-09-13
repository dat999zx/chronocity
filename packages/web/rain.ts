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
