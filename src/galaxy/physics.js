// Galactic dynamics shared by the CPU (star generation, tests, camera
// planning) and mirrored 1:1 in GLSL (src/shaders/orbit.glsl).
//
// Units: 1 scene unit ≈ 150 pc (disk radius ≈ 100 units ≈ 15 kpc).
// Time is in "galactic seconds": at uTimeScale = 1 the outer disk turns
// once every ~4–5 minutes of wall time. G = 1.

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
  pitchDeg: 13.5,
  armStartRadius: 7.0,
  armRefRadius: 10.0,
  armPhase0: 0.0,
  corotationRadius: 72.0,
};

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

// Angular velocity Ω(r) = v(r) / r.
export function angularVelocity(r) {
  const rr = Math.max(r, 0.05);
  return circularVelocity(rr) / rr;
}

// Pattern speed: the spiral rotates rigidly; stars inside corotation
// overtake it, stars outside fall behind.
export const PATTERN_SPEED = angularVelocity(GALAXY.corotationRadius);

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

// Position of a disk star (Y up, rotation counter-clockwise seen from +Y).
// star: { R, M0, A, zAmp, zPhase, nu, offR, offT, offY }
export function diskStarPosition(star, t, out = [0, 0, 0]) {
  const m = GALAXY.arms;
  const w = angularVelocity(star.R) - PATTERN_SPEED;
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
  out[1] = (star.zAmp || 0) * Math.cos((star.nu || 0) * t + (star.zPhase || 0)) + (star.offY || 0);
  return out;
}

// Vertical oscillation frequency for a thin disk: ν² ≈ 4πGρ0 + Ω²-ish;
// we use the cheap proxy ν = κ_z·Ω with κ_z ≈ 2.2 so stars bob a few
// times per orbit, as in the solar neighbourhood (ν/Ω ≈ 2–3).
export function verticalFrequency(R) {
  return 2.2 * angularVelocity(R);
}

export function smoothstep(e0, e1, x) {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}
