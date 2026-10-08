import { describe, expect, it } from 'vitest';
import {
  GALAXY,
  PATTERN_SPEED,
  angularVelocity,
  armAngle,
  armPhase,
  circularVelocity,
  diskStarPosition,
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

  it('places corotation at the configured radius', () => {
    expect(angularVelocity(GALAXY.corotationRadius)).toBeCloseTo(PATTERN_SPEED, 10);
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
