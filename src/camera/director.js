import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Flyby, R_SAFE, createPose } from './flyby.js';

const smootherstep = (x) => {
  const t = THREE.MathUtils.clamp(x, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

const _fwd = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function orientationFor(position, target, bank, out) {
  _fwd.subVectors(target, position).normalize();
  const up = UP.clone().applyAxisAngle(_fwd, -bank);
  _m.lookAt(position, target, up);
  return out.setFromRotationMatrix(_m);
}

// Moves the camera: "Cinematográfico" follows the flyby rig, "Livre" hands
// control to OrbitControls. Also owns the analytic exposure adaptation.
export class Director extends EventTarget {
  constructor(camera, domElement, { reducedMotion = false } = {}) {
    super();
    this.camera = camera;
    this.flyby = new Flyby({ reducedMotion });
    this.reducedMotion = reducedMotion;
    this.mode = 'cinematic';
    this.flyTime = 0;
    this.pose = createPose();
    this.blend = null;
    this.exposureEV = 0;
    this.lastShot = -1;
    this.frozen = false; // holds the flyby at flyTime (stills, debugging)

    const controls = new OrbitControls(camera, domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.rotateSpeed = 0.5;
    controls.zoomToCursor = true;
    controls.minDistance = R_SAFE;
    controls.maxDistance = 450;
    controls.enabled = true;
    // A press only arms the controls around the current look-at point; the
    // switch to free mode happens on actual movement, so a tap (e.g. to wake
    // the HUD) never interrupts the flight.
    let pressed = false;
    controls.addEventListener('start', () => {
      pressed = true;
      if (this.mode !== 'free') controls.target.copy(this.pose.target);
      this.lastInteraction = performance.now();
    });
    controls.addEventListener('change', () => {
      if (!pressed) return;
      if (this.mode !== 'free') this.toFree();
      this.lastInteraction = performance.now();
    });
    controls.addEventListener('end', () => {
      pressed = false;
    });
    this.controls = controls;
    this.lastInteraction = performance.now();
    this.freeFovFrom = null;
    this.freeBank = 0;
    this.freeT = 0;
    this.focusAnim = null;
  }

  setReducedMotion(on) {
    this.reducedMotion = on;
    // Keep the same place in the loop when the loop length changes.
    const frac = this.flyTime / this.flyby.duration;
    this.flyby.setReducedMotion(on);
    this.flyTime = frac * this.flyby.duration;
  }

  toFree() {
    this.mode = 'free';
    this.controls.target.copy(this.pose.target);
    this.freeFovFrom = this.camera.fov;
    // OrbitControls levels the horizon at once; ease the flyby's bank out.
    this.freeBank = this.blend ? 0 : this.pose.bank;
    this.blend = null;
    this.freeT = 0;
    this.dispatchEvent(new CustomEvent('mode', { detail: 'free' }));
  }

  // Return to the flyby at the rig pose nearest to the current view,
  // blending over 2 s (3.5 s for long trips) while the rig keeps moving.
  toCinematic(simTime) {
    if (this.mode === 'cinematic') return;
    const cam = this.camera;
    const aspect = cam.aspect;
    const fwd = cam.getWorldDirection(new THREE.Vector3());
    const probe = createPose();
    let best = 0;
    let bestCost = Infinity;
    for (let t = 0; t < this.flyby.duration; t += 0.25) {
      this.flyby.evaluate(t, simTime, aspect, probe);
      const dp = probe.position.distanceTo(cam.position) / Math.max(1, 0.2 * probe.position.length());
      const rigFwd = _a.subVectors(probe.target, probe.position).normalize();
      const cost = dp + 2 * (1 - fwd.dot(rigFwd));
      if (cost < bestCost) {
        bestCost = cost;
        best = t;
      }
    }
    this.flyby.evaluate(best, simTime, aspect, probe);
    const far = probe.position.distanceTo(cam.position) > 60;
    this.flyTime = best;
    this.blend = {
      t: 0,
      duration: far ? 3.5 : 2,
      position: cam.position.clone(),
      quaternion: cam.quaternion.clone(),
      fov: cam.fov,
    };
    this.mode = 'cinematic';
    this.dispatchEvent(new CustomEvent('mode', { detail: 'cinematic' }));
  }

  restart() {
    this.flyTime = 0;
    this.blend = null;
    this.mode = 'cinematic';
    this.dispatchEvent(new CustomEvent('mode', { detail: 'cinematic' }));
  }

  // Double-click in free mode: glide the orbit target to the disk plane.
  focusOn(point) {
    if (this.mode !== 'free') return;
    this.focusAnim = { from: this.controls.target.clone(), to: point.clone(), t: 0 };
  }

  update(dt, simTime) {
    const cam = this.camera;
    if (this.mode === 'cinematic') {
      if (!this.frozen) this.flyTime = (this.flyTime + dt) % this.flyby.duration;
      this.flyby.evaluate(this.flyTime, simTime, cam.aspect, this.pose);
      const p = this.pose;
      orientationFor(p.position, p.target, p.bank, _q);
      if (this.blend) {
        const b = this.blend;
        b.t += dt;
        const w = smootherstep(b.t / b.duration);
        // Interpolate in spherical coordinates around the core so the blend
        // never cuts through it: log-radius and slerped direction.
        const r0 = b.position.length();
        const r1 = p.position.length();
        const r = Math.exp(THREE.MathUtils.lerp(Math.log(Math.max(r0, 1e-3)), Math.log(Math.max(r1, 1e-3)), w));
        const d0 = _a.copy(b.position).normalize();
        const d1 = _b.copy(p.position).normalize();
        const qd = new THREE.Quaternion().setFromUnitVectors(d0, d1);
        const qPart = new THREE.Quaternion().slerp(qd, w);
        cam.position.copy(d0.applyQuaternion(qPart)).multiplyScalar(r);
        cam.quaternion.copy(b.quaternion).slerp(_q, w);
        cam.fov = THREE.MathUtils.lerp(b.fov, p.fov, w);
        if (b.t >= b.duration) this.blend = null;
      } else {
        cam.position.copy(p.position);
        cam.quaternion.copy(_q);
        cam.fov = p.fov;
      }
      cam.up.set(0, 1, 0);
      if (p.shot !== this.lastShot) {
        this.lastShot = p.shot;
        this.dispatchEvent(new CustomEvent('shot', { detail: p.caption }));
      }
    } else {
      this.freeT += dt;
      // Ease the lens to 50° over 1.5 s.
      if (this.freeFovFrom !== null) cam.fov = THREE.MathUtils.lerp(this.freeFovFrom, 50, smootherstep(this.freeT / 1.5));
      if (this.focusAnim) {
        const f = this.focusAnim;
        f.t += dt;
        this.controls.target.lerpVectors(f.from, f.to, smootherstep(f.t));
        if (f.t >= 1) this.focusAnim = null;
      }
      this.controls.update();
      // Hard clamp (the flyby's smooth push-out would accumulate frame after
      // frame here, since OrbitControls reads the position back).
      if (cam.position.length() < R_SAFE) cam.position.setLength(R_SAFE);
      // Level the horizon over 0.4 s: re-apply the remaining bank on top of
      // the level orientation OrbitControls just set.
      const bankLeft = this.freeBank * (1 - smootherstep(this.freeT / 0.4));
      if (bankLeft) cam.rotateZ(bankLeft);
      this.pose.position.copy(cam.position);
      this.pose.target.copy(this.controls.target);
    }

    cam.near = THREE.MathUtils.clamp(0.004 * cam.position.length(), 0.01, 0.5);
    cam.far = 6000;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    this.updateExposure(dt);
  }

  // Analytic, deterministic exposure (no GPU read-back, so captures are
  // reproducible). A star field's surface brightness does not fall with
  // distance, so once inside the bulge every direction is as bright as the
  // core: stop down with the bulge's column density, which grows roughly
  // as (24/d)² inside it. Looking at the core matters only from outside.
  // Adapts in log space: faster toward darker, slower back.
  updateExposure(dt) {
    const cam = this.camera;
    const dist = Math.max(cam.position.length(), 1e-3);
    const fwd = cam.getWorldDirection(_fwd);
    const toCore = _a.copy(cam.position).negate().normalize();
    const looking = THREE.MathUtils.smoothstep(fwd.dot(toCore), 0.3, 0.95);
    const inside = 1 - THREE.MathUtils.smoothstep(dist, 10, 30); // three's order: (x, min, max)
    const weight = THREE.MathUtils.lerp(looking, 1, Math.sqrt(inside));
    const target = THREE.MathUtils.clamp(-2.2 * Math.log2(1 + (24 / dist) ** 2) * weight, -4.8, 0.5);
    const slow = this.reducedMotion ? 2 : 1;
    const tau = (target < this.exposureEV ? 1.2 : 2.5) * slow;
    this.exposureEV += (target - this.exposureEV) * (1 - Math.exp(-dt / tau));
    return this.exposureEV;
  }

  get exposure() {
    return Math.pow(2, this.exposureEV);
  }
}
