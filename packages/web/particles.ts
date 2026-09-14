import * as THREE from 'three'

// A pool of soft round particles (one draw call): smoke, dust, sparks. Dead slots are reused round-robin.

export interface ParticleKind {
  max: number
  color: number
  additive?: boolean // glowing (sparks) instead of hazy (smoke)
  gravity: number    // world units/s² downward; negative rises
  drag: number       // velocity decay per second
  grow: number       // size multiplier gained over a life (negative shrinks)
  alpha: number
}

export interface Particles {
  object: THREE.Points
  /** n particles at (x, y, z) with velocity (vx, vy, vz), each jittered by `spread`. */
  emit(n: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, spread: number, life: number, size: number): void
  /** scale = pixels per world unit at distance 1 (drawing-buffer height / (2 tan(fov / 2))); light dims smoke at night. */
  update(dt: number, scale: number, light?: number): void
}

export function createParticles(kind: ParticleKind): Particles {
  const { max } = kind
  const pos = new Float32Array(max * 3).fill(-1e5), vel = new Float32Array(max * 3)
  const life = new Float32Array(max), span = new Float32Array(max), base = new Float32Array(max)
  const alpha = new Float32Array(max), size = new Float32Array(max)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage))
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage))
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage))
  const scale = { value: 900 }, light = { value: 1 }
  // Near the camera a puff would fill the screen: fade it out closer than ~1.5 units and cap its size.
  const points = new THREE.Points(geo, new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(kind.color) }, uScale: scale, uLight: light },
    vertexShader: `attribute float aAlpha; attribute float aSize; uniform float uScale; varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float depth = max(0.1, -mv.z);
  vAlpha = aAlpha * smoothstep(0.7, 1.7, depth);
  gl_PointSize = min(aSize * uScale / depth, 90.0);
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: `uniform vec3 uColor; uniform float uLight; varying float vAlpha;
void main() { vec2 c = gl_PointCoord - 0.5; float r = dot(c, c) * 4.0; if (r > 1.0) discard; gl_FragColor = vec4(uColor * uLight, vAlpha * (1.0 - r)); }`,
    transparent: true, depthWrite: false, blending: kind.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  }))
  points.frustumCulled = false
  let next = 0

  return {
    object: points,
    emit(n, x, y, z, vx, vy, vz, spread, lifetime, sz) {
      for (let k = 0; k < n; k++) {
        const i = next
        next = (next + 1) % max
        const j = () => (Math.random() * 2 - 1) * spread
        pos.set([x, y, z], i * 3)
        vel.set([vx + j(), vy + Math.abs(j()) * 0.5, vz + j()], i * 3)
        life[i] = span[i] = lifetime * (0.7 + Math.random() * 0.6)
        base[i] = sz * (0.7 + Math.random() * 0.6)
      }
    },
    update(dt, s, l = 1) {
      scale.value = s
      light.value = l
      const decay = Math.exp(-kind.drag * dt)
      for (let i = 0; i < max; i++) {
        if (life[i] <= 0) { alpha[i] = 0; continue }
        life[i] -= dt
        const age = 1 - Math.max(0, life[i]) / span[i]
        vel[i * 3 + 1] -= kind.gravity * dt
        for (let a = 0; a < 3; a++) { vel[i * 3 + a] *= decay; pos[i * 3 + a] += vel[i * 3 + a] * dt }
        alpha[i] = kind.alpha * (1 - age) * Math.min(1, age * 8) // fade in fast, out slowly
        size[i] = base[i] * Math.max(0.1, 1 + kind.grow * age)
      }
      for (const name of ['position', 'aAlpha', 'aSize']) geo.attributes[name].needsUpdate = true
    },
  }
}
