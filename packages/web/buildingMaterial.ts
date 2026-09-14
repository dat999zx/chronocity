import * as THREE from 'three'

export const FLOOR = 0.45    // window row height in world units (tuning knob)
export const BAY = 0.35      // window column width in world units (tuning knob)
export const LIT_SHARE = 0.3 // share of windows lit after dark in an idle building
export const DIM = 0.22      // brightness left to buildings outside the spotlight
const WARM = 'vec3(1.0, 0.8, 0.5)'

export interface BuildingUniforms {
  night: { value: number } // 0..1: lights a random LIT_SHARE of windows after dark
  spot: { value: number }  // 0..1: how far buildings outside the selection (aSel = 0) are dimmed
  hover: { value: number } // instance index under the cursor, or -1
}

// MeshStandardMaterial with procedural windows on the walls (not roofs):
// - by day windows are darker glass, which gives the walls texture;
// - `night` lights a random LIT_SHARE of each building's windows, like a real city after dark;
// - per-instance `aGlow` (0..1) lights every window of a building whose file was just touched;
// - per-instance `aSel` plus `spot` dim everything outside a selection; `hover` brightens one building via gl_InstanceID.
export function createBuildingMaterial({ night, spot, hover }: BuildingUniforms): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.8 })
  mat.onBeforeCompile = shader => {
    shader.uniforms.uNight = night
    shader.uniforms.uSpot = spot
    shader.uniforms.uHover = hover
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aGlow;
attribute float aSel;
uniform float uHover;
varying float vGlow;
varying float vSel;
varying float vHover;
varying vec3 vWin;
varying vec3 vWinN;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vGlow = aGlow;
vSel = aSel;
vHover = abs(float(gl_InstanceID) - uHover) < 0.5 ? 1.0 : 0.0;
vWin = (instanceMatrix * vec4(transformed, 1.0)).xyz;
vWinN = normal;`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uNight;
uniform float uSpot;
varying float vGlow;
varying float vSel;
varying float vHover;
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
}
float spotK = mix(1.0, ${DIM.toFixed(2)} + ${(1 - DIM).toFixed(2)} * vSel, uSpot);
diffuseColor.rgb *= spotK;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
float winLit = max(vGlow * mix(0.5, 1.0, uNight), step(winRnd, ${LIT_SHARE.toFixed(2)}) * uNight * (0.55 + 0.45 * fract(winRnd * 7.31)));
totalEmissiveRadiance += ${WARM} * winMask * winLit * 1.5 * spotK;
totalEmissiveRadiance += diffuseColor.rgb * 0.35 * vSel * uSpot;             // the selection glows a little
totalEmissiveRadiance += mix(diffuseColor.rgb, vec3(1.0), 0.35) * 0.9 * vHover; // and the hovered building clearly`)
  }
  return mat
}
