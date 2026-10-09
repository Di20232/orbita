import * as THREE from 'three';
import { ARM_OFFSETS, armFeaturePoint, patternAngle } from '../galaxy/physics.js';

// Cinematic flyby. Keyframes live in the frame of the spiral pattern, so
// the arm, dust-lane and nursery shots stay framed at any time scale.

export const R_SAFE = 4.5; // accretion disk (3 su) + 1.5 margin
export const LOOP_SECONDS = 110;
const DEG = Math.PI / 180;

// Point on the nursery belt (just downstream of the birth line) closest to
// a desired framing point, searched along both arms.
function nurseryAnchor(near) {
  let best = null;
  let bestD = Infinity;
  for (let k = 0; k < 2; k++) {
    for (let R = 30; R <= 65; R += 0.25) {
      const p = armFeaturePoint(R, 0, ARM_OFFSETS.birthLine + 0.1, k);
      const d = Math.hypot(p[0] - near[0], p[2] - near[2]);
      if (d < bestD) {
        bestD = d;
        best = [p[0], p[1] + 0.5, p[2]];
      }
    }
  }
  return best;
}

export const ANCHORS = {
  // physics.js orients a dust lane through this point at t = 0.
  dustLane: [40, 0.4, -12],
  nursery: nurseryAnchor([16, 1, -45]),
};

export const KEYFRAMES = [
  { t: 0, caption: 'Abertura', pos: [-29, 115, 162], target: [0, 0, 0], fov: 44, bank: 0, pace: 0.6 },
  { t: 11, caption: 'Mergulho', pos: [43, 60, 117], target: [5, 0, 8], fov: 46, bank: 2, pace: 1.0 },
  { t: 22, caption: 'Rasante', pos: [75, 7, 53], target: [60, 0, 5], fov: 56, bank: 5, pace: 1.0 },
  { t: 32, caption: 'Faixa de poeira', pos: [56, 1.4, 0], target: ANCHORS.dustLane, fov: 62, bank: 3, pace: 1.0 },
  { t: 43, caption: 'Berçário estelar', pos: [39, 6, -46], target: ANCHORS.nursery, fov: 36, bank: 0, pace: 0.7 },
  { t: 55, caption: 'Núcleo dourado', pos: [-2, 9, -24], target: [0, 0.5, 0], fov: 42, bank: 2, pace: 0.9 },
  { t: 66, caption: 'Horizonte de eventos', pos: [-6.6, 2, -3.8], target: [0, 0.2, 0], fov: 50, bank: 0, pace: 0.45 },
  { t: 77, caption: 'Ascensão', pos: [-34, 26, 3], target: [0, 0, 0], fov: 46, bank: 0, pace: 1.15 },
  { t: 90, caption: 'Silhueta', pos: [-143, 5, 100], target: [0, 0, 0], fov: 38, bank: 0, pace: 0.6 },
  { t: 100, caption: 'Recuo', pos: [-88, 60, 152], target: [0, 0, 0], fov: 42, bank: 0, pace: 1.0 },
];

// A closed centripetal Catmull-Rom curve traversed with a monotone cubic
// Hermite time map, so speed is continuous through every keyframe (equal
// parameter spans per segment would make the speed jump; per-segment
// easing would stop the camera at each keyframe).
export class TimedCurve {
  constructor(points, times, paces, loop) {
    const n = points.length;
    this.n = n;
    this.loop = loop;
    this.curve = new THREE.CatmullRomCurve3(points, true, 'centripetal');
    this.T = [...times, loop];
    const U = [0];
    for (let i = 0; i < n; i++) U.push(U[i] + Math.sqrt(points[(i + 1) % n].distanceTo(points[i])));
    this.U = U;

    const m = [];
    for (let i = 0; i < n; i++) {
      const uPrev = i === 0 ? U[n - 1] - U[n] : U[i - 1];
      const tPrev = i === 0 ? this.T[n - 1] - loop : this.T[i - 1];
      const uNext = U[i + 1];
      const tNext = this.T[i + 1];
      const dPrev = (U[i] - uPrev) / (this.T[i] - tPrev);
      const dNext = (uNext - U[i]) / (tNext - this.T[i]);
      const slope = (paces[i] * (uNext - uPrev)) / (tNext - tPrev);
      // Fritsch–Carlson: keeps the time map monotone (never reverses).
      m.push(Math.min(slope, 3 * Math.min(dPrev, dNext)));
    }
    m.push(m[0]);
    this.m = m;
  }

  // Returns { i, s } — keyframe segment and fraction along it.
  locate(tau) {
    const t = ((tau % this.loop) + this.loop) % this.loop;
    let i = 0;
    while (i < this.n - 1 && t >= this.T[i + 1]) i++;
    const h = this.T[i + 1] - this.T[i];
    const s = (t - this.T[i]) / h;
    const s2 = s * s;
    const s3 = s2 * s;
    const u =
      (2 * s3 - 3 * s2 + 1) * this.U[i] +
      (s3 - 2 * s2 + s) * h * this.m[i] +
      (-2 * s3 + 3 * s2) * this.U[i + 1] +
      (s3 - s2) * h * this.m[i + 1];
    // Consecutive identical keyframes (e.g. the same look-at target) have
    // a zero-length span: fall back to time.
    const span = this.U[i + 1] - this.U[i];
    const f = span > 1e-9 ? THREE.MathUtils.clamp((u - this.U[i]) / span, 0, 1) : s;
    return { i, s: f };
  }

  pointAt(tau, out) {
    const { i, s } = this.locate(tau);
    return this.curve.getPoint((i + s) / this.n, out);
  }
}

// Smooth max that keeps the camera outside the black hole's safety sphere
// (changes positions far away by only ~0.003 su).
export function pushOutside(p) {
  const r = p.length();
  if (r < 1e-6) return p.set(R_SAFE, 0, 0);
  const rr = 0.5 * (r + R_SAFE + Math.sqrt((r - R_SAFE) ** 2 + 1.5 ** 2));
  return p.multiplyScalar(rr / r);
}

const HARMONICS = [5, 9, 14];
const WEIGHTS = [1, 0.5, 0.25];
const PHASES = [
  [0.3, 2.1, 4.4],
  [1.7, 5.2, 0.8],
  [3.9, 0.4, 2.6],
  [5.5, 3.3, 1.2],
];

// Integer harmonics of 1/L make the drift periodic: the loop is seamless.
function drift(tau, loop, axis) {
  let sum = 0;
  for (let k = 0; k < 3; k++) sum += WEIGHTS[k] * Math.sin((2 * Math.PI * HARMONICS[k] * tau) / loop + PHASES[axis][k]);
  return sum / 1.75;
}

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _rot = new THREE.Matrix4();
const Y = new THREE.Vector3(0, 1, 0);

export class Flyby {
  constructor({ reducedMotion = false } = {}) {
    const pts = KEYFRAMES.map((k) => new THREE.Vector3(...k.pos));
    const tgts = KEYFRAMES.map((k) => new THREE.Vector3(...k.target));
    const times = KEYFRAMES.map((k) => k.t);
    const paces = KEYFRAMES.map((k) => k.pace);
    this.position = new TimedCurve(pts, times, paces, LOOP_SECONDS);
    this.target = new TimedCurve(tgts, times, paces, LOOP_SECONDS);
    this.setReducedMotion(reducedMotion);
  }

  setReducedMotion(on) {
    this.reducedMotion = on;
    this.duration = LOOP_SECONDS * (on ? 1.6 : 1);
  }

  // Pose at flyby time `tau` (wall seconds), with the galaxy at sim time
  // `simTime`. Writes into `out` = { position, target, fov, bank, shot }.
  evaluate(tau, simTime, aspect, out) {
    const L = this.duration;
    const t = ((((tau / L) * LOOP_SECONDS) % LOOP_SECONDS) + LOOP_SECONDS) % LOOP_SECONDS;
    this.position.pointAt(t, out.position);
    this.target.pointAt(t, out.target);
    const { i, s } = this.position.locate(t);
    const a = KEYFRAMES[i];
    const b = KEYFRAMES[(i + 1) % KEYFRAMES.length];
    const e = s * s * (3 - 2 * s);

    // FOV interpolated in tan space; reduced motion halves the swings.
    let fov = 2 * Math.atan(THREE.MathUtils.lerp(Math.tan((a.fov * DEG) / 2), Math.tan((b.fov * DEG) / 2), e)) / DEG;
    if (this.reducedMotion) fov = 46 + (fov - 46) * 0.5;
    let bank = this.reducedMotion ? 0 : THREE.MathUtils.lerp(a.bank, b.bank, e) * DEG;

    if (!this.reducedMotion) {
      const dist = out.position.distanceTo(out.target);
      const amp = 0.004 * dist;
      _fwd.subVectors(out.target, out.position).normalize();
      _right.crossVectors(_fwd, Y).normalize();
      _up.crossVectors(_right, _fwd);
      out.position
        .addScaledVector(_right, amp * drift(t, LOOP_SECONDS, 0))
        .addScaledVector(_up, amp * drift(t, LOOP_SECONDS, 1))
        .addScaledVector(_fwd, 0.3 * amp * drift(t, LOOP_SECONDS, 2));
      out.target.addScaledVector(_right, 0.5 * amp * drift(t, LOOP_SECONDS, 3)).addScaledVector(_up, 0.5 * amp * drift(t, LOOP_SECONDS, 2));
      bank += 0.3 * DEG * drift(t, LOOP_SECONDS, 1);
    }

    // Keep the horizontal field of view of a 16:9 frame on any aspect.
    const v = fov * DEG;
    let vf = 2 * Math.atan((Math.tan(v / 2) * (16 / 9)) / aspect);
    vf = THREE.MathUtils.clamp(vf, 0.85 * v, 70 * DEG);

    // Ride along with the rotating spiral pattern.
    _rot.makeRotationY(patternAngle(simTime));
    out.position.applyMatrix4(_rot);
    out.target.applyMatrix4(_rot);
    pushOutside(out.position);

    out.fov = vf / DEG;
    out.bank = bank;
    out.shot = s < 0.5 ? i : (i + 1) % KEYFRAMES.length;
    out.caption = KEYFRAMES[out.shot].caption;
    out.loopTime = t;
    return out;
  }
}

export function createPose() {
  return { position: new THREE.Vector3(), target: new THREE.Vector3(), fov: 50, bank: 0, shot: 0, caption: '', loopTime: 0 };
}
