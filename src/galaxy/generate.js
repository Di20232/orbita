import { createRng } from '../util/random.js';
import { blackbodyRGB } from '../util/blackbody.js';
import {
  ARM_OFFSETS,
  GALAXY,
  PATTERN_SPEED,
  angularVelocity,
  quantizeFrequency,
  quantizePeriod,
  relativeAngularVelocity,
  smoothstep,
  verticalFrequency,
} from './physics.js';

// Star kinds — must match the KIND_* constants in stars.vert.glsl.
// Kinds >= BULGE move on inclined circular (3D) orbits.
export const KIND = {
  DISK: 0, // old thin + thick disk, density-wave orbits
  YOUNG: 1, // recycled OB stars born on the spiral shock
  NURSERY: 2, // recycled HII-region clumps (stars + H-alpha gas)
  BULGE: 3, // golden bulge
  HALO: 4, // stellar halo + globular clusters
  NUCLEAR: 5, // nuclear star cluster around the black hole
};

// Diffraction spikes are flagged by adding SPIKE_FLAG to the kind code.
export const SPIKE_FLAG = 8;

// Exactly 320,000 stars.
export const POPULATIONS = {
  nuclear: 4000,
  bulge: 72000,
  thinDisk: 120000,
  thickDisk: 30000,
  young: 52000,
  nursery: 24000, // 480 clumps × (35 stars + 15 H-alpha puffs)
  halo: 12000,
  globular: 6000, // 24 clusters × 250
};

export const TOTAL_STARS = Object.values(POPULATIONS).reduce((a, b) => a + b, 0);

// Floats per star for each attribute.
export const LAYOUT = {
  orbit: 4, // disk: R|M0|w|A   recycled: R|seed|w|birthOffset   3D: R|θ0|Ω|0
  vert: 4, // zAmp | zPhase | ν | τ (recycling period, 0 = not recycled)
  offset: 4, // radial | vertical | tangential | t0 (recycling phase)
  color: 3, // linear RGB, max channel = 1
  props: 4, // radius (su) | luminosity | kind code | inclination (3D) or gas flag
  node: 1, // ascending node (3D orbits)
};

const SATURATION = 1.35;
const HALPHA = [1.0, 0.3, 0.52];

function allocate(count) {
  return {
    count,
    orbit: new Float32Array(count * LAYOUT.orbit),
    vert: new Float32Array(count * LAYOUT.vert),
    offset: new Float32Array(count * LAYOUT.offset),
    color: new Float32Array(count * LAYOUT.color),
    props: new Float32Array(count * LAYOUT.props),
    node: new Float32Array(count * LAYOUT.node),
  };
}

// Pick a temperature from a list of [weight, minK, maxK] bands.
function pickTemperature(rng, bands) {
  let u = rng.next();
  for (const [w, lo, hi] of bands) {
    if (u < w) return rng.range(lo, hi);
    u -= w;
  }
  const last = bands[bands.length - 1];
  return rng.range(last[1], last[2]);
}

function triangular(rng, a, c, b) {
  const u = rng.next();
  const f = (c - a) / (b - a);
  return u < f ? a + Math.sqrt(u * (b - a) * (c - a)) : b - Math.sqrt((1 - u) * (b - a) * (b - c));
}

function saturate(rgb) {
  const l = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  let m = 0;
  for (let k = 0; k < 3; k++) {
    rgb[k] = Math.max(l + (rgb[k] - l) * SATURATION, 0);
    m = Math.max(m, rgb[k]);
  }
  for (let k = 0; k < 3; k++) rgb[k] /= m || 1;
  return rgb;
}

// Optical size grows gently with luminosity; at galactic scales stars stay
// points, so this only softens the very closest ones.
const starRadius = (L) => 0.0015 * Math.pow(L, 0.35);

export function generateGalaxy({ seed = 20261008, onProgress } = {}) {
  const rng = createRng(seed);
  const data = allocate(TOTAL_STARS);
  const rgb = [0, 0, 0];
  const m = GALAXY.arms;
  let i = 0;

  const put = (s) => {
    const o = i * 4;
    data.orbit[o] = s.R;
    data.orbit[o + 1] = s.M0 ?? 0;
    data.orbit[o + 2] = s.w;
    data.orbit[o + 3] = s.A ?? 0;
    data.vert[o] = s.zAmp ?? 0;
    data.vert[o + 1] = s.zPhase ?? 0;
    data.vert[o + 2] = s.nu ?? 0;
    data.vert[o + 3] = s.tau ?? 0;
    data.offset[o] = s.offR ?? 0;
    data.offset[o + 1] = s.offY ?? 0;
    data.offset[o + 2] = s.offT ?? 0;
    data.offset[o + 3] = s.t0 ?? 0;
    if (s.rgb) {
      rgb[0] = s.rgb[0];
      rgb[1] = s.rgb[1];
      rgb[2] = s.rgb[2];
    } else {
      saturate(blackbodyRGB(s.temp, rgb));
    }
    data.color[i * 3] = rgb[0];
    data.color[i * 3 + 1] = rgb[1];
    data.color[i * 3 + 2] = rgb[2];
    data.props[o] = s.radius ?? starRadius(s.L);
    data.props[o + 1] = s.L;
    data.props[o + 2] = s.kind;
    data.props[o + 3] = s.incl ?? (s.gas ? 1 : 0);
    data.node[i] = s.node ?? 0;
    i++;
  };

  const progress = (label) => onProgress && onProgress(i / TOTAL_STARS, label);

  // Isotropic orbit orientation: cos ι uniform in [-1, 1] (ι > 90° is
  // retrograde).
  const isotropic = () => Math.acos(1 - 2 * rng.next());

  // ---------------------------------------------------------------- nuclear
  // Dense cluster around the black hole, with a few hot "S-stars".
  for (let n = 0; n < POPULATIONS.nuclear; n++) {
    let R;
    do {
      R = 1.5 / Math.sqrt(Math.pow(rng.next() * 0.995 + 0.005, -2 / 3) - 1);
    } while (R < 1.2 || R > 5);
    const sStar = rng.next() < 0.15;
    put({
      kind: KIND.NUCLEAR,
      R,
      M0: rng.range(0, Math.PI * 2),
      w: quantizeFrequency(angularVelocity(R)),
      incl: isotropic(),
      node: rng.range(0, Math.PI * 2),
      temp: sStar ? rng.range(18000, 28000) : rng.range(3600, 5200),
      L: rng.powerLaw(0.4, 6, 2.0) * (sStar ? 0.8 : 0.4),
    });
  }
  progress('nuclear');

  // ------------------------------------------------------------------ bulge
  // Hernquist profile on inclined orbits (ι ≤ 68° flattens it to q ≈ 0.65),
  // a quarter of the orbits retrograde.
  const bulgeTemps = [
    [0.15, 3300, 3900],
    [0.6, 3900, 5000],
    [0.2, 5000, 5900],
    [0.05, 5900, 6500],
  ];
  for (let n = 0; n < POPULATIONS.bulge; n++) {
    let R;
    do {
      const s = Math.sqrt(rng.next() * 0.771);
      R = (2.5 * s) / (1 - s);
    } while (R < 1.0);
    const retro = rng.next() < 0.25 ? -1 : 1;
    put({
      kind: KIND.BULGE,
      R,
      M0: rng.range(0, Math.PI * 2),
      w: retro * quantizeFrequency(angularVelocity(R)),
      incl: (rng.range(0, 68) * Math.PI) / 180,
      node: rng.range(0, Math.PI * 2),
      temp: pickTemperature(rng, bulgeTemps),
      // Dimmer per star: 72k of them share a small patch of sky.
      L: rng.powerLaw(0.3, 6, 2.3) * 0.45,
    });
  }
  progress('bulge');

  // -------------------------------------------------------------- thin disk
  const diskRadius = (Rd, min, max, accept) => {
    for (;;) {
      const R = -Rd * Math.log(rng.next() * rng.next() + 1e-12);
      if (R < min || R > max) continue;
      if (accept && rng.next() > accept(R)) continue;
      return R;
    }
  };
  const thinTemps = [
    [0.25, 3000, 3800],
    [0.35, 3800, 5200],
    [0.2, 5200, 6000],
    [0.13, 6000, 7400],
    [0.07, 7400, 10000],
  ];
  for (let n = 0; n < POPULATIONS.thinDisk; n++) {
    const R = diskRadius(25, 3, 125, (r) => smoothstep(3, 12, r) * (r > 85 ? Math.exp(-(((r - 85) / 20) ** 2)) : 1));
    const hz = 0.9 * Math.sqrt(1 + (R / 80) ** 2);
    put({
      kind: KIND.DISK,
      R,
      M0: rng.range(-Math.PI, Math.PI) * m,
      w: quantizeFrequency(0.98 * angularVelocity(R)) - PATTERN_SPEED,
      A: rng.range(0.35, 0.65),
      zAmp: rng.exponential(1.4 * hz),
      zPhase: rng.range(0, Math.PI * 2),
      nu: verticalFrequency(R, 2.5 * rng.range(0.85, 1.15)),
      offR: rng.gaussian() * 0.7,
      offT: rng.gaussian() * 0.7,
      temp: pickTemperature(rng, thinTemps) * (1 + 0.1 * (R / 100 - 0.4)),
      L: rng.powerLaw(0.15, 4, 2.5),
    });
  }
  progress('thin disk');

  // ------------------------------------------------------------- thick disk
  for (let n = 0; n < POPULATIONS.thickDisk; n++) {
    const R = diskRadius(30, 5, 130);
    put({
      kind: KIND.DISK,
      R,
      M0: rng.range(-Math.PI, Math.PI) * m,
      w: quantizeFrequency(0.85 * angularVelocity(R)) - PATTERN_SPEED,
      A: rng.range(0.05, 0.15),
      zAmp: rng.exponential(1.4 * 3.5),
      zPhase: rng.range(0, Math.PI * 2),
      nu: verticalFrequency(R, 1.8),
      offR: rng.gaussian() * 1.5,
      offT: rng.gaussian() * 1.5,
      temp: triangular(rng, 3600, 4800, 5800),
      L: rng.powerLaw(0.12, 2.5, 2.5),
    });
  }
  progress('thick disk');

  // ------------------------------------------------------------- young OB
  // Salpeter masses; brighter, hotter stars die sooner (shorter arm phase).
  const recycleTau = (R, lambda, lo, hi) => quantizePeriod(Math.min(Math.max(lambda / Math.max(Math.abs(relativeAngularVelocity(R)), 1e-4), lo), hi));
  for (let n = 0; n < POPULATIONS.young; n++) {
    const R = diskRadius(35, 11, 108, (r) => smoothstep(11, 18, r) * (1 - smoothstep(95, 110, r)));
    const M = rng.powerLaw(8, 60, 2.35);
    const lambda = Math.min(Math.max(0.4 * Math.pow(M / 20, -1.25), 0.2), 1.4);
    const tau = recycleTau(R, lambda, 2, 90);
    put({
      kind: KIND.YOUNG,
      R,
      M0: rng.range(0, 1000),
      w: relativeAngularVelocity(R),
      A: ARM_OFFSETS.birthLine,
      zAmp: rng.exponential(1.4 * 0.35),
      zPhase: rng.range(0, Math.PI * 2),
      nu: verticalFrequency(R, 3),
      tau,
      t0: rng.range(0, tau),
      offR: rng.gaussian() * 1.1,
      offT: rng.gaussian() * 1.1,
      temp: Math.min(1e4 * Math.pow(M / 2.5, 0.6), 45000),
      L: Math.min(Math.max(1.5 * Math.pow(M / 10, 1.8), 1), 20),
    });
  }
  progress('young stars');

  // ------------------------------------------------------- HII nurseries
  // Clump members share orbit, lifetime, phase and seed so they are born,
  // drift and fade together; they never shear apart.
  const clumps = POPULATIONS.nursery / 50;
  for (let c = 0; c < clumps; c++) {
    const R = diskRadius(30, 14, 100);
    const sigma = Math.exp(rng.range(Math.log(0.25), Math.log(0.9)));
    const tau = recycleTau(R, 0.3, 4, 60);
    const t0 = rng.range(0, tau);
    const seed = rng.range(0, 1000);
    const w = relativeAngularVelocity(R);
    for (let k = 0; k < 50; k++) {
      const gas = k >= 35;
      const spread = gas ? 1.6 : 1;
      put({
        kind: KIND.NURSERY,
        R,
        M0: seed,
        w,
        A: ARM_OFFSETS.birthLine,
        tau,
        t0,
        offR: rng.gaussian() * sigma * spread,
        offY: rng.gaussian() * sigma * 0.6 * spread,
        offT: rng.gaussian() * sigma * spread,
        gas,
        rgb: gas ? HALPHA : null,
        temp: rng.range(15000, 40000),
        radius: gas ? sigma * rng.range(0.6, 1.1) : undefined,
        L: gas ? rng.range(8, 20) : rng.powerLaw(1.5, 8, 2),
      });
    }
  }
  progress('nurseries');

  // ------------------------------------------------------------------- halo
  const haloTemps = [
    [0.85, 4600, 6200],
    [0.15, 7500, 10000],
  ];
  for (let n = 0; n < POPULATIONS.halo; n++) {
    const R = 12 * Math.pow(220 / 12, rng.next());
    put({
      kind: KIND.HALO,
      R,
      M0: rng.range(0, Math.PI * 2),
      w: quantizeFrequency(angularVelocity(R)),
      incl: isotropic(),
      node: rng.range(0, Math.PI * 2),
      temp: pickTemperature(rng, haloTemps),
      L: rng.powerLaw(0.1, 1.5, 2.5),
    });
  }

  // ------------------------------------------------------ globular clusters
  const gcTemps = [
    [0.9, 4200, 6300],
    [0.06, 8000, 9500],
    [0.04, 3850, 3950],
  ];
  const perCluster = POPULATIONS.globular / 24;
  for (let c = 0; c < 24; c++) {
    const R = 6 * Math.pow(150 / 6, rng.next());
    const M0 = rng.range(0, Math.PI * 2);
    const w = quantizeFrequency(angularVelocity(R));
    const incl = isotropic();
    const node = rng.range(0, Math.PI * 2);
    const b = rng.range(0.15, 0.4);
    for (let k = 0; k < perCluster; k++) {
      // Plummer sphere.
      const rr = Math.min(b / Math.sqrt(Math.pow(rng.next() * 0.98 + 0.01, -2 / 3) - 1), 6 * b);
      const ct = 1 - 2 * rng.next();
      const st = Math.sqrt(1 - ct * ct);
      const ph = rng.range(0, Math.PI * 2);
      put({
        kind: KIND.HALO,
        R,
        M0,
        w,
        incl,
        node,
        offR: rr * st * Math.cos(ph),
        offY: rr * ct,
        offT: rr * st * Math.sin(ph),
        temp: pickTemperature(rng, gcTemps),
        L: rng.powerLaw(0.2, 3, 2.3),
      });
    }
  }
  progress('halo');

  // Diffraction spikes for exactly the top 0.5% most luminous stars (gas
  // puffs excluded). Ranking indices keeps ties from inflating the count.
  const candidates = [];
  for (let s = 0; s < i; s++) {
    const isGas = data.props[s * 4 + 2] < KIND.BULGE && data.props[s * 4 + 3] > 0.5;
    if (!isGas) candidates.push(s);
  }
  candidates.sort((a, b) => data.props[b * 4 + 1] - data.props[a * 4 + 1] || a - b);
  const spikes = Math.round(TOTAL_STARS * 0.005);
  for (let k = 0; k < spikes; k++) data.props[candidates[k] * 4 + 2] += SPIKE_FLAG;
  progress('done');

  return data;
}
