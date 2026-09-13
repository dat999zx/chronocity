import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { sampleAt } from '@chronocity/core/timeline.js'

export const HEIGHT_K = 0.25 // world units per sqrt(LOC) (tuning knob)
export const MAX_H = 24      // tallest possible building (tuning knob)
export const RISE = 0.6      // playback seconds for a height change to ease in

const easeOut = p => 1 - (1 - p) ** 3
const heightOf = loc => Math.min(MAX_H, HEIGHT_K * Math.sqrt(loc))

export function createCity(canvas, model, lay, tl) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x1b1f27)

  const S = lay.size
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, S * 20)
  camera.position.set(S * 0.9, S * 0.8, S * 0.9)
  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.autoRotate = true
  controls.autoRotateSpeed = 0.4

  scene.add(new THREE.HemisphereLight(0xdde6ff, 0x30343c, 1.2))
  const sun = new THREE.DirectionalLight(0xffffff, 1.5)
  sun.position.set(S, S * 2, S * 0.5)
  scene.add(sun)

  const group = new THREE.Group()
  group.position.set(-S / 2, 0, -S / 2) // lay out in [0, S], orbit around the centre
  scene.add(group)
  const box = new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5) // origin at the min corner, base on y=0
  const m = new THREE.Matrix4()

  const plates = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: 0x2a2f38 }), lay.districts.length)
  lay.districts.forEach(([x, z, w, d, depth], i) => {
    m.makeScale(w, 0.05, d).setPosition(x, depth * 0.05, z)
    plates.setMatrixAt(i, m)
  })
  group.add(plates)

  const files = model.files.map(([path, s]) => {
    const [x, z, w, d] = lay.lots.get(path)
    const g = 0.15 * Math.min(w, d) // building footprint = lot inset by 15%
    return { path, s, x: x + g, z: z + g, w: w - 2 * g, d: d - 2 * g }
  })
  const mesh = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: 0xb8bcc4 }), files.length)
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  mesh.frustumCulled = false // instances change every frame; a cached bounding sphere would go stale
  group.add(mesh)

  function heightAt(f, u) {
    const k = sampleAt(tl, f.s, u)
    if (k < 0) return 0
    const from = k > 0 ? heightOf(f.s[k - 1][1]) : 0
    const to = heightOf(f.s[k][1])
    const p = Math.min(1, (u - tl.u[f.s[k][0]]) / RISE)
    return from + (to - from) * easeOut(p)
  }

  function resize() {
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false)
    camera.aspect = canvas.clientWidth / canvas.clientHeight
    camera.updateProjectionMatrix()
  }
  resize()
  addEventListener('resize', resize)

  return {
    render(u) {
      for (let i = 0; i < files.length; i++) {
        const f = files[i], h = heightAt(f, u)
        if (h < 1e-3) m.makeScale(0, 0, 0)
        else m.makeScale(f.w, h, f.d).setPosition(f.x, 0, f.z)
        mesh.setMatrixAt(i, m)
      }
      mesh.instanceMatrix.needsUpdate = true
      controls.update()
      renderer.render(scene, camera)
    },
  }
}
