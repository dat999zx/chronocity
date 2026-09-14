import * as THREE from 'three'
import { elevation, type SkyState } from '@chronocity/core/timeline.ts'

// Sky palette per regime: [zenith, horizon]. The regimes blend by sun elevation (tuning knobs).
const DAY = [new THREE.Color(0x2f6fc4), new THREE.Color(0xa9cbe8)]
const GOLDEN = [new THREE.Color(0x2a2f5e), new THREE.Color(0xf08a4b)]
const NIGHT = [new THREE.Color(0x03050c), new THREE.Color(0x0f1830)]
const STORM = [new THREE.Color(0x3b4250), new THREE.Color(0x69717d)] // rain pulls the sky toward overcast
const HAZE = new THREE.Color(0x8e969f)                                // fog pulls it toward grey
const SUN_LOW = new THREE.Color(0xffb070)
const WHITE = new THREE.Color(0xffffff)

export interface Weather { night: number } // how much the city should light its windows, 0..1
export interface Sky {
  update(state: SkyState, fog: number, rain: number, cameraDistance: number): Weather
  shadows(on: boolean): void
}

// A gradient dome, sun, ambient light and fog, all driven by the commit-hour sky and the weather signals.
export function createSky(scene: THREE.Scene, S: number): Sky {
  const zenith = new THREE.Color(), horizon = new THREE.Color()
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(S * 15, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { zenith: { value: zenith }, horizon: { value: horizon } },
      vertexShader: `varying vec3 vDir;
void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 zenith; uniform vec3 horizon; varying vec3 vDir;
void main() {
  gl_FragColor = vec4(mix(horizon, zenith, pow(clamp(vDir.y, 0.0, 1.0), 0.6)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
    }),
  )
  dome.renderOrder = -1
  scene.add(dome)

  const hemi = new THREE.HemisphereLight(0xffffff, 0x1c1f25, 1)
  const sun = new THREE.DirectionalLight(0xffffff, 1)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  const sc = sun.shadow.camera // covers the whole city from any sun angle
  sc.left = sc.bottom = -S * 0.75
  sc.right = sc.top = S * 0.75
  sc.near = 0.5
  sc.far = S * 6
  sc.updateProjectionMatrix()
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.03
  sun.shadow.radius = 3 // soft edges (PCFShadowMap honours radius)
  scene.add(hemi, sun)
  const haze = new THREE.FogExp2(0x000000, 0)
  scene.fog = haze

  const mix = (out: THREE.Color, i: 0 | 1, day: number, golden: number, night: number) =>
    out.setRGB(
      DAY[i].r * day + GOLDEN[i].r * golden + NIGHT[i].r * night,
      DAY[i].g * day + GOLDEN[i].g * golden + NIGHT[i].g * night,
      DAY[i].b * day + GOLDEN[i].b * golden + NIGHT[i].b * night,
    )

  return {
    update(state, fog, rain, cameraDistance) {
      const e = elevation(state)
      const day = THREE.MathUtils.smoothstep(e, -0.05, 0.35)
      const night = 1 - THREE.MathUtils.smoothstep(e, -0.35, -0.05)
      const golden = Math.max(0, 1 - day - night)

      mix(zenith, 0, day, golden, night).lerp(STORM[0], rain * 0.75).lerp(HAZE, fog * 0.7)
      mix(horizon, 1, day, golden, night).lerp(STORM[1], rain * 0.75).lerp(HAZE, fog * 0.7)

      const az = (state.hour / 24) * 2 * Math.PI
      sun.position.set(Math.sin(az) * S, Math.max(0.12, e) * S * 2, Math.cos(az) * S)
      sun.color.copy(WHITE).lerp(SUN_LOW, golden)
      sun.intensity = (2.6 * day + 1.3 * golden) * (1 - 0.65 * rain) * (1 - 0.5 * fog)
      hemi.color.copy(horizon).lerp(WHITE, 0.35)
      hemi.intensity = 1.1 * day + 0.6 * golden + 0.35 * night

      // Fog is scaled to the camera distance, so a small early city and the full city haze alike.
      haze.color.copy(horizon)
      haze.density = (0.28 + 0.7 * fog + 0.25 * rain) / Math.max(1, cameraDistance)
      return { night: Math.min(1, night + 0.45 * golden + 0.3 * rain * day) }
    },
    shadows(on) {
      sun.castShadow = on // three recompiles the lit materials when the shadow count changes
    },
  }
}
