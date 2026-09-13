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
