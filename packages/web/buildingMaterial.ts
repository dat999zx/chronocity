import * as THREE from 'three'

export const FLOOR = 0.45    // window row height in world units (tuning knob)
export const BAY = 0.35      // window column width in world units (tuning knob)
export const LIT_SHARE = 0.3 // share of windows lit after dark in an idle building
const WARM = 'vec3(1.0, 0.8, 0.5)'

// MeshStandardMaterial with procedural windows on the walls (not roofs):
// - by day, windows are darker glass, which gives the walls texture;
// - `night` (0..1) lights a random LIT_SHARE of each building's windows, like a real city after dark;
// - per-instance `aGlow` (0..1) lights every window of a building whose file was just touched.
export function createBuildingMaterial(night: { value: number }): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.8 })
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
varying vec3 vWinN;
float winHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float winMask = 0.0, winRnd = 0.0;
if (abs(vWinN.y) < 0.5) {
  float along = abs(vWinN.x) > 0.5 ? vWin.z : vWin.x;
  vec2 cell = vec2(along / ${BAY.toFixed(3)}, vWin.y / ${FLOOR.toFixed(3)});
  vec2 f = fract(cell);
  winMask = step(0.3, f.x) * step(0.35, f.y) * step(f.y, 0.85);
  winRnd = winHash(floor(cell) + vWinN.xz * 17.0);
  diffuseColor.rgb *= mix(1.0, 0.62, winMask);
}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
float winLit = max(vGlow * mix(0.5, 1.0, uNight), step(winRnd, ${LIT_SHARE.toFixed(2)}) * uNight * (0.55 + 0.45 * fract(winRnd * 7.31)));
totalEmissiveRadiance += ${WARM} * winMask * winLit * 1.5;`)
  }
  return mat
}
