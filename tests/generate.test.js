import { describe, expect, it } from 'vitest';
import { KIND, SPIKE_FLAG, TOTAL_STARS, generateGalaxy } from '../src/galaxy/generate.js';

describe('generateGalaxy', () => {
  const g = generateGalaxy();

  it('creates exactly 320,000 stars', () => {
    expect(TOTAL_STARS).toBe(320000);
    expect(g.count).toBe(320000);
    expect(g.props.length).toBe(320000 * 4);
  });

  it('produces only finite attribute values', () => {
    for (const key of ['orbit', 'vert', 'offset', 'color', 'props', 'node']) {
      expect(g[key].every(Number.isFinite)).toBe(true);
    }
  });

  it('is deterministic for a given seed', () => {
    const checksum = (a) => a.reduce((acc, v, k) => acc + v * ((k % 7) + 1), 0);
    const again = generateGalaxy();
    expect(checksum(again.orbit)).toBe(checksum(g.orbit));
    expect(checksum(again.color)).toBe(checksum(g.color));
  }, 30000);

  it('keeps the golden core warm and the nurseries blue', () => {
    let bulgeRB = 0;
    let bulgeN = 0;
    let nurseryBlue = 0;
    let nurseryN = 0;
    for (let i = 0; i < g.count; i++) {
      const kind = g.props[i * 4 + 2];
      const r = g.color[i * 3];
      const b = g.color[i * 3 + 2];
      const gas = g.props[i * 4 + 3] > 0.5;
      if (kind === KIND.BULGE) {
        bulgeRB += r - b;
        bulgeN++;
      } else if (kind === KIND.NURSERY && !gas) {
        if (b >= r) nurseryBlue++;
        nurseryN++;
      }
    }
    expect(bulgeRB / bulgeN).toBeGreaterThan(0.3);
    expect(nurseryBlue / nurseryN).toBeGreaterThan(0.95);
  });

  it('flags exactly 0.5% of stars for diffraction spikes', () => {
    let spikes = 0;
    for (let i = 0; i < g.count; i++) if (g.props[i * 4 + 2] >= SPIKE_FLAG) spikes++;
    expect(spikes).toBe(1600);
  });

  it('recycles young stars and nurseries with loop-dividing lifetimes', () => {
    for (let i = 0; i < g.count; i++) {
      const kind = g.props[i * 4 + 2] % SPIKE_FLAG;
      const tau = g.vert[i * 4 + 3];
      if (kind === KIND.YOUNG || kind === KIND.NURSERY) {
        expect(tau).toBeGreaterThan(0);
        const n = 7200 / tau;
        expect(Math.abs(n - Math.round(n))).toBeLessThan(1e-3);
      } else {
        expect(tau).toBe(0);
      }
    }
  });
});
