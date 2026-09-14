import * as THREE from 'three'

export const CAR_LEN = 0.8 // nose along +z; about a lane of a 0.6 street
export const CAR_W = 0.4

export interface Car {
  object: THREE.Group
  /** Headlights: a spotlight and a soft visible beam. Keep them in the scene for good (see createCar). */
  lights: THREE.Object3D[]
  place(x: number, y: number, z: number, heading: number, pitch: number): void
  update(dt: number, v: number, steer: number, braking: boolean, night: number, on: boolean): void
}

const beamShader = {
  vertexShader: `varying float vAlong; varying float vFacing;
void main() {
  vAlong = position.z / 3.2;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vFacing = abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz)));
  gl_Position = projectionMatrix * mv;
}`,
  fragmentShader: `uniform float uOpacity; varying float vAlong; varying float vFacing;
void main() { gl_FragColor = vec4(1.0, 0.94, 0.78, uOpacity * pow(1.0 - clamp(vAlong, 0.0, 1.0), 1.6) * vFacing); }`,
}

// A detailed toy car. The spotlight and beam live outside the car's group and follow it, because hiding a light
// changes the scene's light count, which recompiles every lit material in the city (a visible hitch).
export function createCar(paintColor = 0xd8452f): Car {
  const car = new THREE.Group(), body = new THREE.Group()
  car.add(body)
  const std = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.5, ...extra })
  const paint = std(paintColor, { metalness: 0.45, roughness: 0.3 })
  const glass = std(0x18202c, { metalness: 0.85, roughness: 0.08 })
  const trim = std(0x23272e, { roughness: 0.75 })
  const chrome = std(0xc9ced6, { metalness: 0.9, roughness: 0.25 })
  const white = std(0xe8eaee)
  const head = std(0xfff4d6, { emissive: 0xfff2c8, emissiveIntensity: 1 })
  const tail = std(0x8a1a12, { emissive: 0xff2412, emissiveIntensity: 1 })
  const reverse = std(0xdddddd, { emissive: 0xffffff, emissiveIntensity: 0 })
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, tilt = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m)
    mesh.position.set(x, y, z)
    mesh.rotation.x = tilt
    mesh.castShadow = true
    body.add(mesh)
  }
  box(0.40, 0.12, 0.80, paint, 0, 0.14, 0)                // lower body
  box(0.38, 0.04, 0.26, paint, 0, 0.215, 0.23)            // hood
  box(0.36, 0.13, 0.36, paint, 0, 0.265, -0.07)           // cabin
  box(0.365, 0.08, 0.26, glass, 0, 0.275, -0.07)          // side windows
  box(0.33, 0.12, 0.02, glass, 0, 0.26, 0.12, -0.55)      // windshield
  box(0.33, 0.1, 0.02, glass, 0, 0.26, -0.26, 0.5)        // rear window
  box(0.42, 0.06, 0.05, trim, 0, 0.1, 0.405)              // bumpers
  box(0.42, 0.06, 0.05, trim, 0, 0.1, -0.405)
  box(0.2, 0.04, 0.01, trim, 0, 0.16, 0.401)              // grille
  box(0.1, 0.03, 0.006, white, 0, 0.1, 0.432)             // number plates
  box(0.1, 0.03, 0.006, white, 0, 0.1, -0.432)
  for (const s of [-1, 1]) {
    box(0.08, 0.035, 0.01, head, s * 0.14, 0.17, 0.401)   // headlights
    box(0.08, 0.035, 0.01, tail, s * 0.14, 0.17, -0.401)  // taillights
    box(0.03, 0.03, 0.01, reverse, s * 0.08, 0.17, -0.401) // reverse lights
    box(0.05, 0.03, 0.035, paint, s * 0.215, 0.255, 0.09) // mirrors
  }
  const tyre = new THREE.CylinderGeometry(0.085, 0.085, 0.06, 16).rotateZ(Math.PI / 2)
  const rim = new THREE.CylinderGeometry(0.05, 0.05, 0.065, 12).rotateZ(Math.PI / 2)
  const wheels: THREE.Object3D[] = [], steering: THREE.Object3D[] = []
  for (const z of [0.25, -0.25]) for (const s of [-1, 1]) {
    const pivot = new THREE.Group(), wheel = new THREE.Group()
    wheel.add(new THREE.Mesh(tyre, trim), new THREE.Mesh(rim, chrome))
    wheel.children.forEach(m => { m.castShadow = true })
    pivot.position.set(s * 0.19, 0.085, z)
    pivot.add(wheel)
    car.add(pivot)
    wheels.push(wheel)
    if (z > 0) steering.push(pivot)
  }

  const spot = new THREE.SpotLight(0xfff0d0, 0, 10, 0.55, 0.6, 1.2)
  const beam = new THREE.Mesh(
    new THREE.ConeGeometry(1.0, 3.2, 24, 1, true).rotateX(-Math.PI / 2).translate(0, 0, 1.6),
    new THREE.ShaderMaterial({ ...beamShader, uniforms: { uOpacity: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }),
  )
  beam.frustumCulled = false
  const nose = new THREE.Vector3(), aim = new THREE.Vector3()
  let wheelSteer = 0, lastV = 0

  return {
    object: car,
    lights: [spot, spot.target, beam],
    place(x, y, z, heading, pitch) {
      car.position.set(x, y, z)
      car.rotation.set(pitch, heading, 0, 'YXZ') // pitch in the car's own frame
      const sx = Math.sin(heading), cz = Math.cos(heading)
      nose.set(x + sx * 0.42, y + 0.17, z + cz * 0.42)
      aim.set(x + sx * 4, y - 0.3, z + cz * 4)
      spot.position.copy(nose)
      spot.target.position.copy(aim)
      beam.position.copy(nose)
      beam.lookAt(aim)
    },
    update(dt, v, steer, braking, night, on) {
      for (const w of wheels) w.rotation.x += (v * dt) / 0.085
      wheelSteer += (steer * 0.45 - wheelSteer) * (1 - Math.exp(-dt * 10))
      for (const p of steering) p.rotation.y = wheelSteer
      const accel = dt > 0 ? (v - lastV) / dt : 0
      lastV = v
      body.rotation.x += (-accel * 0.004 - body.rotation.x) * (1 - Math.exp(-dt * 6)) // squat and dive
      body.rotation.z += (-steer * Math.min(1, Math.abs(v) / 5) * 0.05 - body.rotation.z) * (1 - Math.exp(-dt * 6)) // lean out of turns
      const dark = on ? night : 0
      head.emissiveIntensity = 0.6 + 2.4 * dark
      tail.emissiveIntensity = braking ? 4 : 0.5 + 1.5 * dark
      reverse.emissiveIntensity = v < -0.05 ? 3 : 0
      spot.intensity = dark * 9
      ;(beam.material as THREE.ShaderMaterial).uniforms.uOpacity.value = dark * 0.16
      beam.visible = dark > 0.02
    },
  }
}
