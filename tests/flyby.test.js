import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { Flyby, KEYFRAMES, LOOP_SECONDS, R_SAFE, createPose } from '../src/camera/flyby.js';

describe('cinematic flyby', () => {
  const flyby = new Flyby();
  const pose = createPose();

  it('produces finite poses that never enter the black-hole safety sphere', () => {
    for (let i = 0; i < 4000; i++) {
      const t = (i / 4000) * LOOP_SECONDS;
      flyby.evaluate(t, 37.5, 16 / 9, pose);
      for (const v of [...pose.position.toArray(), ...pose.target.toArray(), pose.fov, pose.bank]) {
        expect(Number.isFinite(v)).toBe(true);
      }
      expect(pose.position.length()).toBeGreaterThanOrEqual(R_SAFE - 1e-9);
      expect(pose.fov).toBeGreaterThan(20);
      expect(pose.fov).toBeLessThanOrEqual(70);
    }
  });

  it('moves continuously (no jumps between consecutive frames)', () => {
    const prev = createPose();
    flyby.evaluate(0, 0, 16 / 9, prev);
    let maxStep = 0;
    for (let i = 1; i <= 6600; i++) {
      flyby.evaluate(i / 60, 0, 16 / 9, pose);
      maxStep = Math.max(maxStep, pose.position.distanceTo(prev.position));
      prev.position.copy(pose.position);
    }
    // ~110 s at 60 fps: the fastest stretch stays well under 3 su/frame.
    expect(maxStep).toBeLessThan(3);
  });

  it('loops seamlessly', () => {
    const a = flyby.evaluate(0, 0, 16 / 9, createPose());
    const b = flyby.evaluate(LOOP_SECONDS - 1e-6, 0, 16 / 9, createPose());
    expect(a.position.distanceTo(b.position)).toBeLessThan(1e-3);
    expect(a.target.distanceTo(b.target)).toBeLessThan(1e-3);
  });

  it('passes through every keyframe on time', () => {
    const still = new Flyby({ reducedMotion: true }); // no drift
    for (const k of KEYFRAMES) {
      still.evaluate((k.t / LOOP_SECONDS) * still.duration, 0, 16 / 9, pose);
      const [x, y, z] = k.pos;
      const r = Math.hypot(x, y, z);
      // Allow for the smooth safety push-out near the black hole.
      expect(pose.position.distanceTo(new Vector3(x, y, z))).toBeLessThan(r < 10 ? 0.6 : 0.05);
    }
  });
});
