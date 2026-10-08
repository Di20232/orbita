import { describe, expect, it } from 'vitest';
import { KIND, TOTAL_STARS, generateGalaxy } from '../src/galaxy/generate.js';

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
    const a = generateGalaxy({ seed: 7, scale: 0.01 });
    const b = generateGalaxy({ seed: 7, scale: 0.01 });
    expect(Array.from(a.orbit)).toEqual(Array.from(b.orbit));
  });

  it('keeps the golden core warm and the nurseries blue', () => {
    let bulgeRB = 0;
    let bulgeN = 0;
    let nurseryBlue = 0;
    let nurseryN = 0;
    for (let i = 0; i < g.count; i++) {
      const kind = g.props[i * 4 + 2];
      const r = g.color[i * 3];
      const b = g.color[i * 3 + 2];
      if (kind === KIND.BULGE) {
        bulgeRB += r - b;
        bulgeN++;
      } else if (kind === KIND.NURSERY) {
        if (b >= r) nurseryBlue++;
        nurseryN++;
      }
    }
    expect(bulgeRB / bulgeN).toBeGreaterThan(0.3);
    expect(nurseryBlue / nurseryN).toBeGreaterThan(0.7);
  });

  it('scales down for lower quality tiers', () => {
    const small = generateGalaxy({ scale: 0.25 });
    expect(small.count).toBe(80000);
  });
});
