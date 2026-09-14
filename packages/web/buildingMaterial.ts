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
// - per-instance `aSel` plus `spot` dim everything outside a selection; `hover` brightens one building via gl_InstanceID;
// - per-instance `aAge` (0..1, weathering) fades and soots the walls, streaks them with grime and darkens its windows.
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
attribute float aAge;
uniform float uHover;
varying float vGlow;
varying float vSel;
varying float vAge;
varying float vHover;
varying vec3 vWin;
varying vec3 vWinN;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vGlow = aGlow;
vSel = aSel;
vAge = aAge;
vHover = abs(float(gl_InstanceID) - uHover) < 0.5 ? 1.0 : 0.0;
vWin = (instanceMatrix * vec4(transformed, 1.0)).xyz;
vWinN = normal;`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uNight;
uniform float uSpot;
varying float vGlow;
varying float vSel;
varying float vAge;
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
// Weathering: faded, sooty walls with grime streaks down some columns. Barely-stale code still looks fresh.
float wear = smoothstep(0.15, 1.0, vAge);
vec3 soot = vec3(dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11))) * vec3(0.84, 0.77, 0.68);
diffuseColor.rgb = mix(diffuseColor.rgb, soot, wear * 0.75) * (1.0 - 0.25 * wear);
if (abs(vWinN.y) < 0.5) {
  float streak = winHash(vec2(floor((abs(vWinN.x) > 0.5 ? vWin.z : vWin.x) * 4.0), 11.0));
  diffuseColor.rgb *= 1.0 - wear * 0.35 * step(0.6, streak);
}
float spotK = mix(1.0, ${DIM.toFixed(2)} + ${(1 - DIM).toFixed(2)} * vSel, uSpot);
diffuseColor.rgb *= spotK;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
float winLit = max(vGlow * mix(0.5, 1.0, uNight), step(winRnd, ${LIT_SHARE.toFixed(2)} * (1.0 - 0.85 * wear)) * uNight * (0.55 + 0.45 * fract(winRnd * 7.31)));
totalEmissiveRadiance += ${WARM} * winMask * winLit * 1.5 * spotK;
totalEmissiveRadiance += diffuseColor.rgb * 0.35 * vSel * uSpot;             // the selection glows a little
totalEmissiveRadiance += mix(diffuseColor.rgb, vec3(1.0), 0.35) * 0.9 * vHover; // and the hovered building clearly`)
  }
  return mat
}

export const POLE = 0.9    // scaffold bay width and ledger spacing, world units (tuning knob)
const THICK = 0.035        // half-thickness of a scaffold tube, world units

// Scaffolding: an open cage over a unit box (instance-scaled), drawn procedurally. Poles at every bay (one at each
// corner), ledgers every POLE up and along the top, a diagonal brace per bay; everything else is discarded.
// Lines stay at least a pixel wide so a far-off city doesn't shimmer. `spot` dims it with its building (aSel).
export function createScaffoldMaterial(spot: { value: number }): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xe0a040, roughness: 0.55, metalness: 0.2, side: THREE.DoubleSide })
  mat.onBeforeCompile = shader => {
    shader.uniforms.uSpot = spot
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aSel;
varying float vSel;
varying vec3 vBox;
varying vec3 vSize;
varying vec3 vN;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vSel = aSel;
vBox = position;
vSize = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
vN = normal;`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uSpot;
varying float vSel;
varying vec3 vBox;
varying vec3 vSize;
varying vec3 vN;
float nearest(float x, float step) { float f = fract(x / step); return min(f, 1.0 - f) * step; }`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
if (abs(vN.y) > 0.5) discard; // open top and bottom
vec3 p = vBox * vSize;
float along = abs(vN.x) > 0.5 ? p.z : p.x, span = abs(vN.x) > 0.5 ? vSize.z : vSize.x;
float bay = span / max(1.0, floor(span / ${POLE.toFixed(2)} + 0.5));
float d = min(nearest(along, bay), min(nearest(p.y, ${POLE.toFixed(2)}), vSize.y - p.y));
d = min(d, nearest(along + p.y, bay) * 0.7071);
if (d > max(${THICK.toFixed(3)}, fwidth(p.y) * 0.8)) discard;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
diffuseColor.rgb *= mix(1.0, ${DIM.toFixed(2)} + ${(1 - DIM).toFixed(2)} * vSel, uSpot);`)
  }
  return mat
}
