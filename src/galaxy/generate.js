import { createRng } from '../util/random.js';
import { blackbodyRGB } from '../util/blackbody.js';
import { GALAXY, angularVelocity, verticalFrequency, PATTERN_SPEED } from './physics.js';

// Star kinds — must match the KIND_* constants in the star shaders.
export const KIND = {
  DISK: 0, // old thin + thick disk, weak arm response
  YOUNG: 1, // OB / A stars born in the arms, fade downstream
  NURSERY: 2, // HII-region clumps on the arm crest
  BULGE: 3, // golden core, 3D inclined orbits
  HALO: 4, // stellar halo + globular clusters, 3D orbits
};

// Exactly 320,000 stars at full quality.
export const POPULATIONS = {
  bulge: 64000,
  thinDisk: 118000,
  thickDisk: 22000,
  young: 72000,
  nursery: 28000,
  halo: 9600,
  globular: 6400,
};

export const TOTAL_STARS = Object.values(POPULATIONS).reduce((a, b) => a + b, 0);

// Floats per star for each interleaved attribute.
export const LAYOUT = {
  orbit: 4, // R | M0 | w (= Ω − Ωp, or Ω for 3D orbits) | A (arm amplitude)
  vert: 4, // zAmp | zPhase | ν | life (arm-phase e-folding of brightness, 0 = steady)
  offset: 4, // local offset: radial | vertical | tangential | arm phase shift
  color: 3, // linear RGB, max channel = 1
  props: 4, // size | brightness | kind | incl (3D orbits) / spare
  node: 1, // ascending node for 3D orbits
};

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

// Sample from the kind-specific temperature distributions (Kelvin).
function temperature(rng, kind) {
  switch (kind) {
    case KIND.BULGE:
      // K giants and G dwarfs, a few red giants.
      return rng.next() < 0.12 ? rng.range(3200, 4000) : rng.range(3900, 5600);
    case KIND.HALO:
      return rng.range(3800, 6200);
    case KIND.YOUNG: {
      const u = rng.next();
      if (u < 0.35) return rng.range(15000, 32000); // O/B
      if (u < 0.75) return rng.range(9000, 15000); // B/A
      return rng.range(6500, 9500); // A/F
    }
    case KIND.NURSERY:
      return rng.range(18000, 38000);
    default: {
      // Old disk: mostly G/K with a sprinkle of F and red giants.
      const u = rng.next();
      if (u < 0.08) return rng.range(3100, 3700);
      if (u < 0.85) return rng.range(4200, 6200);
      return rng.range(6200, 8000);
    }
  }
}

export function generateGalaxy({ seed = 20261008, scale = 1 } = {}) {
  const rng = createRng(seed);
  const counts = Object.fromEntries(Object.entries(POPULATIONS).map(([k, v]) => [k, Math.round(v * scale)]));
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const data = allocate(total);
  const rgb = [0, 0, 0];
  const m = GALAXY.arms;
  let i = 0;

  const put = (s) => {
    const o = i * 4;
    data.orbit[o] = s.R;
    data.orbit[o + 1] = s.M0;
    data.orbit[o + 2] = s.w;
    data.orbit[o + 3] = s.A ?? 0;
    data.vert[o] = s.zAmp ?? 0;
    data.vert[o + 1] = s.zPhase ?? 0;
    data.vert[o + 2] = s.nu ?? 0;
    data.vert[o + 3] = s.life ?? 0;
    data.offset[o] = s.offR ?? 0;
    data.offset[o + 1] = s.offY ?? 0;
    data.offset[o + 2] = s.offT ?? 0;
    data.offset[o + 3] = s.shift ?? 0;
    blackbodyRGB(s.temp, rgb);
    if (s.tint) {
      rgb[0] = rgb[0] * (1 - s.tint[3]) + s.tint[0] * s.tint[3];
      rgb[1] = rgb[1] * (1 - s.tint[3]) + s.tint[1] * s.tint[3];
      rgb[2] = rgb[2] * (1 - s.tint[3]) + s.tint[2] * s.tint[3];
    }
    data.color[i * 3] = rgb[0];
    data.color[i * 3 + 1] = rgb[1];
    data.color[i * 3 + 2] = rgb[2];
    data.props[o] = s.size;
    data.props[o + 1] = s.bright;
    data.props[o + 2] = s.kind;
    data.props[o + 3] = s.incl ?? 0;
    data.node[i] = s.node ?? 0;
    i++;
  };

  const diskW = (R) => angularVelocity(R) - PATTERN_SPEED;
  const randomM0 = () => rng.range(-Math.PI, Math.PI) * m;

  // Luminosity function: many faint stars, a few very bright ones.
  const brightness = (lo, hi, alpha) => rng.powerLaw(lo, hi, alpha);

  // --- Bulge: flattened Hernquist-like cloud of old golden stars on
  // randomly inclined near-circular orbits (velocity dispersion supported).
  for (let n = 0; n < counts.bulge; n++) {
    // Hernquist cumulative mass M(<r) ∝ r²/(r+a)² → r = a·√u / (1 − √u).
    const u = Math.sqrt(rng.next() * 0.985);
    const a = GALAXY.bulgeScale * 0.72;
    const R = Math.max((a * u) / (1 - u), 0.25);
    // Isotropic orbit normals compressed toward the disk axis flatten the
    // bulge (q ≈ 0.6); retrograde orbits come from the sign of w below.
    const incl = Math.acos(rng.next()) * 0.65;
    put({
      kind: KIND.BULGE,
      R,
      M0: rng.range(0, Math.PI * 2),
      w: angularVelocity(R) * (rng.next() < 0.82 ? 1 : -1) * rng.range(0.75, 1.0),
      incl,
      node: rng.range(0, Math.PI * 2),
      temp: temperature(rng, KIND.BULGE),
      size: rng.range(0.9, 1.5),
      bright: brightness(0.35, 6, 2.4) * (R < 1.5 ? 1.35 : 1),
    });
  }

  // --- Thin disk: exponential profile, weak density-wave response.
  const sampleDiskRadius = (h, min, max) => {
    let R;
    do {
      // Gamma(2) radial distribution for an exponential surface density.
      R = -h * Math.log(rng.next() * rng.next() + 1e-9);
    } while (R < min || R > max);
    return R;
  };

  for (let n = 0; n < counts.thinDisk; n++) {
    const R = sampleDiskRadius(24, 3.5, GALAXY.diskRadius * 1.15);
    const flare = 1 + Math.max(0, R - 60) / 50;
    put({
      kind: KIND.DISK,
      R,
      M0: randomM0(),
      w: diskW(R),
      A: rng.range(0.25, 0.5),
      zAmp: Math.abs(rng.sech2(0.55 * flare)),
      zPhase: rng.range(0, Math.PI * 2),
      nu: verticalFrequency(R),
      offR: rng.gaussian() * 0.8,
      offT: rng.gaussian() * 0.8,
      temp: temperature(rng, KIND.DISK),
      size: rng.range(0.8, 1.3),
      bright: brightness(0.25, 5, 2.5),
    });
  }

  // --- Thick disk: hotter, older, smoother.
  for (let n = 0; n < counts.thickDisk; n++) {
    const R = sampleDiskRadius(20, 3, GALAXY.diskRadius);
    put({
      kind: KIND.DISK,
      R,
      M0: randomM0(),
      w: diskW(R),
      A: rng.range(0.05, 0.2),
      zAmp: Math.abs(rng.sech2(2.2)),
      zPhase: rng.range(0, Math.PI * 2),
      nu: verticalFrequency(R) * 0.7,
      offR: rng.gaussian() * 1.5,
      offT: rng.gaussian() * 1.5,
      temp: temperature(rng, KIND.DISK) * 0.95,
      size: rng.range(0.8, 1.2),
      bright: brightness(0.2, 3, 2.6),
    });
  }

  // --- Young stars: strong arm response; brightness fades with the arm
  // phase travelled since the last crest passage (stellar lifetimes).
  for (let n = 0; n < counts.young; n++) {
    const R = sampleDiskRadius(30, GALAXY.armStartRadius, GALAXY.diskRadius * 1.05);
    put({
      kind: KIND.YOUNG,
      R,
      M0: randomM0(),
      w: diskW(R),
      A: rng.range(0.65, 0.85),
      zAmp: Math.abs(rng.sech2(0.18)),
      zPhase: rng.range(0, Math.PI * 2),
      nu: verticalFrequency(R),
      life: rng.range(0.5, 1.6),
      offR: rng.gaussian() * 0.6,
      offT: rng.gaussian() * 0.6,
      shift: 0.08,
      temp: temperature(rng, KIND.YOUNG),
      size: rng.range(1.0, 1.6),
      bright: brightness(0.6, 14, 2.1),
    });
  }

  // --- Stellar nurseries: compact clumps (HII regions) of hot stars and
  // ionised gas sharing one guiding orbit, so clumps never shear apart.
  const clumpSize = 40;
  const clumps = Math.ceil(counts.nursery / clumpSize);
  let placed = 0;
  for (let c = 0; c < clumps && placed < counts.nursery; c++) {
    const R = sampleDiskRadius(32, GALAXY.armStartRadius * 1.4, GALAXY.diskRadius * 0.95);
    const M0 = randomM0();
    const life = rng.range(0.35, 0.8);
    const radius = rng.range(0.35, 1.1);
    const zAmp = Math.abs(rng.sech2(0.12));
    const zPhase = rng.range(0, Math.PI * 2);
    const n = Math.min(clumpSize, counts.nursery - placed);
    for (let k = 0; k < n; k++) {
      // H-alpha pink for a fraction of the gas glow, blue-white for stars.
      const pink = rng.next() < 0.22;
      put({
        kind: KIND.NURSERY,
        R,
        M0,
        w: diskW(R),
        A: 0.82,
        zAmp,
        zPhase,
        nu: verticalFrequency(R),
        life,
        offR: rng.gaussian() * radius,
        offY: rng.gaussian() * radius * 0.35,
        offT: rng.gaussian() * radius,
        shift: 0.12,
        temp: temperature(rng, KIND.NURSERY),
        tint: pink ? [1.0, 0.32, 0.55, 0.75] : null,
        size: pink ? rng.range(2.2, 4.0) : rng.range(1.2, 2.0),
        bright: pink ? rng.range(0.6, 1.6) : brightness(1.5, 20, 2.0),
      });
      placed++;
    }
  }

  // --- Stellar halo: sparse, spherical, old.
  for (let n = 0; n < counts.halo; n++) {
    const R = Math.min(8 + rng.exponential(35), 160);
    put({
      kind: KIND.HALO,
      R,
      M0: rng.range(0, Math.PI * 2),
      w: angularVelocity(R) * rng.range(0.4, 1.0) * (rng.next() < 0.5 ? 1 : -1),
      incl: Math.acos(1 - 2 * rng.next()),
      node: rng.range(0, Math.PI * 2),
      temp: temperature(rng, KIND.HALO),
      size: rng.range(0.8, 1.2),
      bright: brightness(0.25, 3, 2.6),
    });
  }

  // --- Globular clusters: dense balls on halo orbits (shared elements).
  const gcCount = 32;
  const perGc = Math.ceil(counts.globular / gcCount);
  placed = 0;
  for (let c = 0; c < gcCount && placed < counts.globular; c++) {
    const R = rng.range(14, 70);
    const M0 = rng.range(0, Math.PI * 2);
    const w = angularVelocity(R) * rng.range(0.5, 0.9) * (rng.next() < 0.6 ? 1 : -1);
    const incl = Math.acos(1 - 2 * rng.next());
    const node = rng.range(0, Math.PI * 2);
    const core = rng.range(0.15, 0.35);
    const n = Math.min(perGc, counts.globular - placed);
    for (let k = 0; k < n; k++) {
      // Plummer sphere sampling for the cluster's internal distribution.
      const rr = core / Math.sqrt(Math.pow(rng.next() * 0.97 + 0.01, -2 / 3) - 1);
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
        temp: rng.range(4200, 6400),
        size: rng.range(0.8, 1.2),
        bright: brightness(0.4, 4, 2.3),
      });
      placed++;
    }
  }

  return { ...data, count: i };
}
