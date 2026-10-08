// Deterministic PRNG so the same seed always produces the same galaxy.
export function createRng(seed = 1) {
  let s = seed >>> 0;
  const next = () => {
    // mulberry32
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  let spare = null;
  const gaussian = () => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u = 0;
    while (u === 0) u = next();
    const v = next();
    const mag = Math.sqrt(-2 * Math.log(u));
    spare = mag * Math.sin(2 * Math.PI * v);
    return mag * Math.cos(2 * Math.PI * v);
  };

  return {
    next,
    gaussian,
    range: (min, max) => min + (max - min) * next(),
    // Exponential deviate with the given scale length.
    exponential: (scale) => -scale * Math.log(1 - next()),
    // Sech^2 vertical profile (isothermal sheet), returns height for scale h.
    sech2: (h) => {
      const u = next() * 0.999998 + 0.000001;
      return h * Math.atanh(2 * u - 1);
    },
    // Power law dN/dx ~ x^-alpha on [min, max] (alpha != 1).
    powerLaw: (min, max, alpha) => {
      const a = 1 - alpha;
      const lo = Math.pow(min, a);
      const hi = Math.pow(max, a);
      return Math.pow(lo + (hi - lo) * next(), 1 / a);
    },
  };
}
