import { describe, expect, it } from 'vitest';
import {
  GALAXY,
  LOOP_PERIOD,
  OMEGA0,
  PATTERN_SPEED,
  angularVelocity,
  armAngle,
  armPhase,
  armFeaturePoint,
  circularVelocity,
  diskStarPosition,
  quantizePeriod,
  relativeAngularVelocity,
  verticalFrequency,
} from '../src/galaxy/physics.js';

describe('rotation curve', () => {
  it('is flat in the outer disk (dark-matter halo)', () => {
    const v30 = circularVelocity(30);
    for (const r of [40, 60, 80, 100]) {
      expect(Math.abs(circularVelocity(r) - v30) / v30).toBeLessThan(0.12);
    }
  });

  it('rises toward the black hole (Keplerian core)', () => {
    expect(angularVelocity(0.5)).toBeGreaterThan(angularVelocity(2) * 3);
  });

  it('places corotation at the configured radius (within the loop quantum)', () => {
    expect(Math.abs(angularVelocity(GALAXY.corotationRadius) - PATTERN_SPEED)).toBeLessThanOrEqual(OMEGA0 / 2);
  });
});

describe('density wave', () => {
  it('maps mean anomaly continuously across wraps', () => {
    let prev = armPhase(-20, 0.7);
    for (let M = -20; M < 20; M += 0.01) {
      const x = armPhase(M, 0.7);
      expect(x).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(x - prev).toBeLessThan(0.05);
      prev = x;
    }
  });

  it('is the identity when there is no arm (A = 0)', () => {
    for (const M of [-3, -1, 0, 0.5, 2.9, 7.1]) {
      expect(armPhase(M, 0)).toBeCloseTo(M, 10);
    }
  });

  it('makes stars linger near the arm crest', () => {
    // Sample a star's arm phase uniformly in time: about 2.4× more samples
    // fall within ±0.5 rad of the crest than for a uniform distribution.
    const A = 0.75;
    let near = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const M = -Math.PI + (2 * Math.PI * (i + 0.5)) / N;
      if (Math.abs(armPhase(M, A)) < 0.5) near++;
    }
    const uniformFraction = 1 / (2 * Math.PI);
    expect(near / N).toBeGreaterThan(uniformFraction * 2);
  });

  it('winds trailing arms that rotate rigidly with the pattern speed', () => {
    expect(armAngle(40, 0)).toBeLessThan(armAngle(20, 0));
    const dt = 10;
    expect(armAngle(30, dt) - armAngle(30, 0)).toBeCloseTo(PATTERN_SPEED * dt, 10);
  });

  it('keeps disk stars on their guiding radius', () => {
    const star = { R: 37, M0: 1.2, A: 0.6, zAmp: 0.4, zPhase: 0.3, nu: 0.1 };
    for (const t of [0, 13, 250, 1000]) {
      const [x, y, z] = diskStarPosition(star, t);
      expect(Math.hypot(x, z)).toBeCloseTo(37, 6);
      expect(Math.abs(y)).toBeLessThanOrEqual(0.4 + 1e-9);
    }
  });

  it('moves stars counter-clockwise when seen from +Y', () => {
    const star = { R: 20, M0: 0, A: 0 };
    const [x0, , z0] = diskStarPosition(star, 0);
    const [x1, , z1] = diskStarPosition(star, 0.5);
    // Counter-clockwise from +Y is a positive rotation about +Y in Three.js'
    // right-handed frame, i.e. (p0 × p1)·ŷ > 0.
    const cross = z0 * x1 - x0 * z1;
    expect(cross).toBeGreaterThan(0);
  });
});

describe('loop periodicity', () => {
  it('quantises every frequency to multiples of 2π / LOOP_PERIOD', () => {
    for (const w of [PATTERN_SPEED, relativeAngularVelocity(13.7), verticalFrequency(42.1)]) {
      const k = w / OMEGA0;
      expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-6);
    }
    expect(LOOP_PERIOD / quantizePeriod(37.3)).toBeCloseTo(Math.round(LOOP_PERIOD / quantizePeriod(37.3)), 9);
  });

  it('returns every disk star to the same place after one loop', () => {
    const star = { R: 23.4, M0: 0.7, A: 0.4, zAmp: 0.8, zPhase: 1.1, nu: verticalFrequency(23.4), offR: 0.3, offT: -0.2 };
    const a = diskStarPosition(star, 123.4);
    const b = diskStarPosition(star, 123.4 + LOOP_PERIOD);
    for (let k = 0; k < 3; k++) expect(b[k]).toBeCloseTo(a[k], 6);
  });
});

describe('arm features', () => {
  it('puts the dust lane upstream (behind) of the arm crest inside corotation', () => {
    const R = 40;
    const crest = armFeaturePoint(R, 0, 0);
    const lane = armFeaturePoint(R, 0, -0.3);
    const angle = (p) => Math.atan2(-p[2], p[0]);
    let d = angle(lane) - angle(crest);
    d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
    // Stars inside corotation rotate faster than the pattern (toward +φ),
    // so upstream is the −φ side.
    expect(d).toBeLessThan(0);
  });

  it('orients a dust lane through the flyby dust-lane shot at t = 0', () => {
    const R = Math.hypot(40, 12);
    const lane = armFeaturePoint(R, 0, -0.3);
    const other = armFeaturePoint(R, 0, -0.3, 1);
    const miss = Math.min(Math.hypot(lane[0] - 40, lane[2] + 12), Math.hypot(other[0] - 40, other[2] + 12));
    expect(miss).toBeLessThan(0.05);
  });
});
