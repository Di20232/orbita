// Volumetric galaxy: raymarches diffuse disk light and dust absorption
// (with reddening) through the disk slab; the golden core/bulge is added
// with an exact line integral per segment so the dust can slice through it.
// Requires orbit.glsl, noise.glsl and field.glsl prepended.

uniform mat4 uProjInv;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform float uSteps;
uniform float uEmission;
uniform float uDustOn;
uniform int uOctaves;
uniform float uScatter; // forward-scattered core light on dust (0 = off)
uniform vec4 uTile; // full-frame px offset (xy) and full-frame size (zw)
uniform vec2 uTileSize; // size of the current render target in px

varying vec2 vUv;

#define MAX_STEPS 128
#define FAR 1e4

vec2 slabHit(vec3 ro, vec3 rd, float h) {
  if (abs(rd.y) < 1e-6) return abs(ro.y) < h ? vec2(-FAR, FAR) : vec2(1.0, -1.0);
  float a = (-h - ro.y) / rd.y;
  float b = (h - ro.y) / rd.y;
  return vec2(min(a, b), max(a, b));
}

vec2 cylinderHit(vec3 ro, vec3 rd, float r) {
  float a = dot(rd.xz, rd.xz);
  float b = dot(ro.xz, rd.xz);
  float c = dot(ro.xz, ro.xz) - r * r;
  if (a < 1e-8) return c < 0.0 ? vec2(-FAR, FAR) : vec2(1.0, -1.0);
  float h = b * b - a * c;
  if (h < 0.0) return vec2(1.0, -1.0);
  h = sqrt(h);
  return vec2((-b - h) / a, (-b + h) / a);
}

float hg(float cosT, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (12.566 * pow(1.0 + g2 - 2.0 * g * cosT, 1.5));
}

void main() {
  vec4 view = uProjInv * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  view /= view.w;
  vec3 rd = normalize((uCamWorld * vec4(view.xyz, 0.0)).xyz);
  vec3 ro = uCamPos;

  // Disk slab (with room for the warp) ∩ cylinder.
  vec2 s = slabHit(ro, rd, 5.5);
  vec2 c = cylinderHit(ro, rd, 118.0);
  float t0 = max(max(s.x, c.x), 0.0);
  float t1 = min(s.y, c.y);

  if (t1 <= t0) {
    gl_FragColor = vec4(coreLight(ro, rd, 0.0, FAR) * uEmission, 1.0);
    return;
  }

  // Core light in front of the slab is unattenuated.
  vec3 L = coreLight(ro, rd, 0.0, t0);
  vec3 T = vec3(1.0);

  // Geometric step distribution: dense near the camera (detail while
  // flying through dust), coarse far away. Jitter is white noise on
  // full-frame pixel coordinates (tiled captures match the live view;
  // gradient noise would leave diagonal hatching without TAA).
  float len = t1 - t0;
  float scale = 6.0;
  float logRange = log(1.0 + len / scale);
  vec2 fullPx = uTile.xy + vUv * uTileSize;
  float jitter = hash12(floor(fullPx));

  float tPrev = t0;
  for (int i = 0; i < MAX_STEPS; i++) {
    if (float(i) >= uSteps) break;
    float tNext = t0 + scale * (exp((float(i) + 1.0) / uSteps * logRange) - 1.0);
    float tS = mix(tPrev, tNext, jitter);
    float dt = tNext - tPrev;
    vec3 p = ro + rd * tS;

    float d = uDustOn > 0.5 ? dustDensity(p, uOctaves) : 0.0;
    vec3 sigma = d * vec3(0.72, 1.0, 1.38);
    vec3 att = exp(-sigma * dt);

    vec3 src = diskEmission(p);
    if (uScatter > 0.0 && d > 0.0) {
      // Dust lit from behind by the core glows silver at its edges.
      float r2 = dot(p, p);
      src += d * uScatter * hg(dot(-rd, p * inversesqrt(r2)), 0.6) * uCoreColor / (r2 + 16.0);
    }
    // Exact integral of emission spread evenly across an absorbing
    // segment: the mean transmittance over the segment is (1 − e^−σΔt)/σΔt.
    vec3 f = mix(vec3(1.0), (1.0 - att) / max(sigma * dt, vec3(1e-5)), step(vec3(1e-5), sigma));
    L += T * (src * dt + coreLight(ro, rd, tPrev, tNext)) * f;
    T *= att;
    tPrev = tNext;
    if (max(T.r, max(T.g, T.b)) < 0.005) break;
  }

  // Core light beyond the slab, seen through the accumulated dust.
  L += T * coreLight(ro, rd, tPrev, FAR);
  gl_FragColor = vec4(L * uEmission, dot(T, vec3(0.3333)));
}
