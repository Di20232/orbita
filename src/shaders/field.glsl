// Analytic galaxy fields shared by the volume raymarcher (diffuse light and
// dust), the star shader (per-star extinction) and the black-hole pass.
// Requires orbit.glsl and noise.glsl. Everything is expressed relative to
// the rotating spiral pattern, so lanes stay locked to the stars.

uniform float uDustDensity;

// Azimuth relative to the nearest arm crest, in [-PI/2, PI/2).
float armOffset(float r, float phi) {
  float d = phi - armAngle(r, uTime);
  return d - PI * floor(d / PI + 0.5);
}

// Time-averaged stellar crowding of the density wave (mean = 1).
float crowd(float x, float A) {
  return sqrt(1.0 - A * A) / (1.0 - A * cos(x));
}

// Noise coordinates in the "unwound" spiral frame: arms become straight,
// so stretching along ln r makes filaments follow the pitch angle.
vec3 spiralCoords(float r, float phi, float y) {
  float u = phi - armAngle(r, uTime);
  return vec3(cos(u) * 15.0, sin(u) * 15.0, log(max(r, 1.0)) * 4.0 + y * 0.8);
}

float dustDensity(vec3 p, int octaves) {
  float r = length(p.xz);
  float radial = exp(-r / 40.0) * smoothstep(2.5, 9.0, r) * (1.0 - smoothstep(100.0, 115.0, r));
  if (radial < 1e-4) return 0.0;
  float phi = atan(-p.z, p.x);
  float y = p.y - warpHeight(r, phi);
  float vert = exp(-abs(y) / 0.45);
  if (vert < 2e-3) return 0.0;

  float s = upstreamSign(r);
  float da = armOffset(r, phi);
  // Main lane on the concave (upstream) edge of the arm, a fainter
  // secondary lane nearer the crest.
  float main = (da + 0.30 * s) / 0.08;
  float lane = exp(-0.5 * main * main);
  float sec = (da + 0.12 * s) / 0.12;
  lane += 0.4 * exp(-0.5 * sec * sec);
  // Feathers: short spurs peeling off the lane downstream every Δln r ≈ 0.15.
  float down = (da + 0.30 * s) * s;
  float spurPhase = fract(log(max(r, 1.0)) / 0.15 + down * 2.4);
  float spur = smoothstep(0.0, 0.03, down) * exp(-down / 0.22) * exp(-pow((spurPhase - 0.5) / 0.08, 2.0));
  lane += 0.55 * spur;

  vec3 q = spiralCoords(r, phi, y);
  float warp = vnoise(q * 0.35) * 2.5;
  float n = fbm(q * 0.55 + vec3(warp, -warp, 0.0), octaves);
  float clump = smoothstep(0.28, 0.75, n);
  return uDustDensity * radial * vert * (0.25 + 1.6 * lane) * (0.15 + 1.7 * clump);
}

// Diffuse disk light (unresolved stars + nebular glow), linear RGB.
vec3 diskEmission(vec3 p) {
  float r = length(p.xz);
  float phi = atan(-p.z, p.x);
  float y = p.y - warpHeight(r, phi);
  float hz = 0.9 * sqrt(1.0 + (r / 80.0) * (r / 80.0));
  float disk = exp(-r / 25.0) * smoothstep(2.0, 10.0, r) * exp(-abs(y) / hz);
  if (r > 100.0) disk *= exp(-((r - 100.0) / 14.0) * ((r - 100.0) / 14.0));
  if (disk < 1e-5) return vec3(0.0);

  float taper = armTaper(r);
  float s = upstreamSign(r);
  float da = armOffset(r, phi);
  float old = crowd(2.0 * da, 0.45 * taper);
  // OB light: born on the birth line, drifting downstream as it fades.
  float down = (da + 0.22 * s) * s;
  float young = smoothstep(-0.04, 0.03, down) * exp(-max(down, 0.0) / 0.32) * taper;
  vec3 col = disk * (vec3(1.0, 0.82, 0.62) * 0.3 * old + vec3(0.45, 0.62, 1.0) * 0.9 * young);

  // HII haze: clumpy blue/pink knots just downstream of the dust lane.
  float hii = young * exp(-abs(y) / 0.4);
  if (hii > 0.05) {
    float n = vnoise(spiralCoords(r, phi, y) * 1.3 + 7.0);
    float knot = pow(smoothstep(0.45, 0.95, n), 2.0) * hii;
    col += disk * knot * mix(vec3(0.4, 0.58, 1.0), vec3(1.0, 0.36, 0.6), smoothstep(0.8, 0.95, n)) * 3.5;
  }
  return col;
}

// Exact line integral of a flattened Plummer-like emissivity
// j = 1 / (|S·x|² + a²)², S = diag(1, 1/q, 1), along o + d·s for s∈[t0,t1].
float bulgeLine(vec3 o, vec3 d, float t0, float t1, float a, float q) {
  vec3 S = vec3(1.0, 1.0 / q, 1.0);
  vec3 so = o * S;
  vec3 sd = d * S;
  float k = length(sd);
  sd /= k;
  t0 *= k;
  t1 *= k;
  float tc = -dot(so, sd);
  float c2 = max(dot(so, so) - tc * tc, 0.0) + a * a;
  float c = sqrt(c2);
  float u1 = t1 - tc;
  float u0 = t0 - tc;
  float F1 = u1 / (2.0 * c2 * (u1 * u1 + c2)) + atan(u1 / c) / (2.0 * c2 * c);
  float F0 = u0 / (2.0 * c2 * (u0 * u0 + c2)) + atan(u0 / c) / (2.0 * c2 * c);
  return (F1 - F0) / k;
}

uniform vec3 uCoreColor;
uniform vec3 uBulgeColor;
uniform vec2 uCoreAmp; // core, bulge amplitudes

// Golden core + bulge light along a ray segment (exact, band-free).
vec3 coreLight(vec3 o, vec3 d, float t0, float t1) {
  return uCoreColor * uCoreAmp.x * bulgeLine(o, d, t0, t1, 0.7, 0.7) +
         uBulgeColor * uCoreAmp.y * bulgeLine(o, d, t0, t1, 3.5, 0.62);
}

// Optical depth of dust between two points, clipped to the dust slab.
float dustColumn(vec3 a, vec3 b, int samples, int octaves) {
  const float H = 3.2;
  vec3 d = b - a;
  float t0 = 0.0;
  float t1 = 1.0;
  if (abs(d.y) > 1e-5) {
    float ta = (-H - a.y) / d.y;
    float tb = (H - a.y) / d.y;
    t0 = max(t0, min(ta, tb));
    t1 = min(t1, max(ta, tb));
  } else if (abs(a.y) > H) {
    return 0.0;
  }
  if (t1 <= t0) return 0.0;
  float len = length(d) * (t1 - t0);
  float tau = 0.0;
  float n = float(samples);
  for (int i = 0; i < 12; i++) {
    if (i >= samples) break;
    float t = mix(t0, t1, (float(i) + 0.5) / n);
    tau += dustDensity(a + d * t, octaves);
  }
  return tau * len / n;
}

vec3 extinctionColor(float tau) {
  return exp(-tau * vec3(0.72, 1.0, 1.38));
}
