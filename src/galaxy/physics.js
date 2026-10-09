// Galactic dynamics shared by the CPU (star generation, tests, camera
// planning) and mirrored 1:1 in GLSL (src/shaders/orbit.glsl).
//
// Units: G = 1, 1 scene unit (su) ≈ 150 pc, disk radius 100 su ≈ 15 kpc.
// Time is in sim-seconds; at time scale 1 the outer disk turns once every
// ~5–7 minutes of wall time.
//
// Every frequency is rounded to a multiple of ω0 = 2π / LOOP_PERIOD, so the
// whole galaxy is exactly periodic. The GPU receives time modulo the loop
// period (computed in double precision on the CPU), which keeps float32
// phases accurate no matter how long the page stays open.

export const LOOP_PERIOD = 7200;
export const OMEGA0 = (2 * Math.PI) / LOOP_PERIOD;

export const GALAXY = {
  diskRadius: 100,
  bulgeRadius: 8,

  // Mass model (G = 1).
  bhMass: 2.0, // supermassive black hole, Keplerian core
  bhSoftening: 0.35,
  bulgeMass: 26.0, // Hernquist bulge
  bulgeScale: 3.0,
  diskMass: 70.0, // Kuzmin (razor-thin Miyamoto–Nagai) disk
  diskScale: 22.0,
  haloVelocity: 1.32, // pseudo-isothermal dark halo, asymptotic speed
  haloCore: 14.0,

  // Spiral density wave (Lin–Shu): rigidly rotating m-armed log spiral.
  arms: 2,
  pitchDeg: 15,
  armStartRadius: 7.0,
  armRefRadius: 10.0,
  // Orients the pattern so that at t = 0 a dust lane crosses (40, 0, −12),
  // the point the flyby's "dust lane" shot threads (see camera/flyby.js).
  armPhase0: 2.7844,
  corotationRadius: 90.0,

  // Visual black hole (cinematically exaggerated; does not affect orbits).
  bhRs: 0.25,
  bhDiskInner: 0.75, // ISCO = 3 Rs
  bhDiskOuter: 3.0, // 12 Rs
  bhDiskTiltDeg: 25,

  // Gentle S-shaped warp of the outer disk.
  warpAmplitude: 5.0,
  warpStart: 80,
  warpScale: 40,
  warpPhase: 0.9,
};

export function quantizeFrequency(omega) {
  return Math.round(omega / OMEGA0) * OMEGA0;
}

// Round a duration so that it divides the loop period exactly.
export function quantizePeriod(tau) {
  const n = Math.max(1, Math.round(LOOP_PERIOD / tau));
  return LOOP_PERIOD / n;
}

const TAN_PITCH = Math.tan((GALAXY.pitchDeg * Math.PI) / 180);
export const ARM_WIND = 1 / TAN_PITCH; // radians of winding per e-fold in radius

// Circular velocity squared from each mass component.
export function circularVelocity2(r) {
  const g = GALAXY;
  const rr = Math.max(r, 1e-4);
  const r2 = rr * rr;
  const eps2 = g.bhSoftening * g.bhSoftening;
  const bh = (g.bhMass * r2) / Math.pow(r2 + eps2, 1.5);
  const bulge = (g.bulgeMass * rr) / ((rr + g.bulgeScale) * (rr + g.bulgeScale));
  const disk = (g.diskMass * r2) / Math.pow(r2 + g.diskScale * g.diskScale, 1.5);
  const halo = g.haloVelocity * g.haloVelocity * (1 - (g.haloCore / rr) * Math.atan(rr / g.haloCore));
  return bh + bulge + disk + halo;
}

export function circularVelocity(r) {
  return Math.sqrt(circularVelocity2(r));
}

// Angular velocity Ω(r) = v(r) / r (unquantised).
export function angularVelocity(r) {
  const rr = Math.max(r, 0.05);
  return circularVelocity(rr) / rr;
}

// Pattern speed: the spiral rotates rigidly; stars inside corotation
// overtake it, stars outside fall behind.
export const PATTERN_SPEED = quantizeFrequency(angularVelocity(GALAXY.corotationRadius));

// Angle the spiral pattern has turned through after time t.
export function patternAngle(t) {
  return PATTERN_SPEED * t;
}

// Quantised angular velocity of a star relative to the pattern.
export function relativeAngularVelocity(R) {
  return quantizeFrequency(angularVelocity(R)) - PATTERN_SPEED;
}

// Azimuth of the arm crest (arm 0) at guiding radius R and time t.
// Trailing logarithmic spiral: for counter-clockwise rotation the arm
// angle decreases outward.
export function armAngle(R, t) {
  const g = GALAXY;
  const rr = Math.max(R, g.armStartRadius * 0.5);
  return g.armPhase0 - ARM_WIND * Math.log(rr / g.armRefRadius) + PATTERN_SPEED * t;
}

// Arm strength taper: arms grow out of the bulge and fade at the disk edge.
export function armTaper(R) {
  const g = GALAXY;
  return smoothstep(g.armStartRadius * 0.7, g.armStartRadius * 1.8, R) * (1 - smoothstep(g.diskRadius * 0.82, g.diskRadius * 1.12, R));
}

// +1 inside corotation (gas overtakes the arm from its concave side),
// −1 outside, smooth across corotation.
export function upstreamSign(R) {
  return Math.tanh((GALAXY.corotationRadius - R) / 10);
}

// Azimuthal offsets from the arm crest (radians), scaled by upstreamSign.
export const ARM_OFFSETS = {
  dustLane: -0.3,
  secondaryDust: -0.12,
  birthLine: -0.22,
};

// Density-wave "traffic jam": in the pattern frame the arm phase x obeys
//   dx/dt = m·w·(1 − A cos x) / sqrt(1 − A²),  w = Ω(R) − Ωp,
// so stars linger (crowd) near x = 0 — the arm crest — and pass quickly
// through the inter-arm region, while the mean rate stays m·w.
// The ODE is solved exactly: with mean anomaly M = M0 + m·w·t,
//   x = 2·atan(k·tan(M/2)),  k = sqrt((1 − A)/(1 + A)).
// Returns the phase-unwrapped arm phase (radians, divide by m for azimuth).
export function armPhase(M, A) {
  const k = Math.sqrt((1 - A) / (1 + A));
  const n = Math.floor((M + Math.PI) / (2 * Math.PI));
  const Mw = M - 2 * Math.PI * n; // [-π, π)
  const half = Mw * 0.5;
  const x = 2 * Math.atan2(k * Math.sin(half), Math.cos(half));
  return x + 2 * Math.PI * n;
}

// Height of the warped mid-plane at cylindrical (R, φ).
export function warpHeight(R, phi) {
  const g = GALAXY;
  const s = Math.max(0, (R - g.warpStart) / g.warpScale);
  return g.warpAmplitude * s * s * Math.sin(phi - g.warpPhase);
}

// Position of an old disk star (Y up, rotation counter-clockwise from +Y).
// star: { R, M0, w, A, zAmp, zPhase, nu, offR, offT, offY }
export function diskStarPosition(star, t, out = [0, 0, 0]) {
  const m = GALAXY.arms;
  const w = star.w ?? relativeAngularVelocity(star.R);
  const A = star.A * armTaper(star.R);
  const M = star.M0 + m * w * t;
  const x = armPhase(M, A);
  const phi = armAngle(star.R, t) + x / m;
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  const r = star.R + (star.offR || 0);
  const tang = star.offT || 0;
  out[0] = r * c - tang * s;
  out[2] = -(r * s + tang * c);
  out[1] = (star.zAmp || 0) * Math.cos((star.nu || 0) * t + (star.zPhase || 0)) + (star.offY || 0) + warpHeight(r, phi);
  return out;
}

// Vertical oscillation frequency: ν/Ω ≈ 2–3 as in the solar neighbourhood.
export function verticalFrequency(R, ratio = 2.5) {
  return quantizeFrequency(ratio * angularVelocity(R));
}

// World position on the dust lane / nursery birth line of arm k at radius
// R and time t (used by the camera to frame these features).
export function armFeaturePoint(R, t, offset, k = 0) {
  const phi = armAngle(R, t) + offset * upstreamSign(R) + k * Math.PI;
  return [R * Math.cos(phi), warpHeight(R, phi), -R * Math.sin(phi)];
}

export function smoothstep(e0, e1, x) {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}
