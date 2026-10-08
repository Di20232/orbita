// GPU mirror of src/galaxy/physics.js — keep the two in sync.

#define ARMS 2.0
#define TAU 6.283185307179586
#define PI 3.141592653589793

uniform float uTime; // sim time modulo uLoop (exactly periodic)
uniform float uLoop;
uniform float uPatternSpeed;
uniform float uArmWind;
uniform float uArmRef;
uniform float uArmPhase0;
uniform float uArmStart;
uniform float uDiskRadius;
uniform float uCorotation;
uniform vec4 uWarp; // amplitude, start radius, scale, phase

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float armAngle(float R, float t) {
  float rr = max(R, uArmStart * 0.5);
  return uArmPhase0 - uArmWind * log(rr / uArmRef) + uPatternSpeed * t;
}

float armTaper(float R) {
  return smoothstep(uArmStart * 0.7, uArmStart * 1.8, R) *
         (1.0 - smoothstep(uDiskRadius * 0.82, uDiskRadius * 1.12, R));
}

float upstreamSign(float R) {
  float x = clamp((uCorotation - R) / 10.0, -10.0, 10.0);
  float e = exp(2.0 * x);
  return (e - 1.0) / (e + 1.0);
}

float warpHeight(float R, float phi) {
  float s = max(0.0, (R - uWarp.y) / uWarp.z);
  return uWarp.x * s * s * sin(phi - uWarp.w);
}

// Exact solution of the density-wave "traffic jam" ODE (see physics.js).
// Returns the unwrapped arm phase; .y = wrapped phase in [-PI, PI).
vec2 armPhase(float M, float A) {
  float k = sqrt((1.0 - A) / (1.0 + A));
  float n = floor((M + PI) / TAU);
  float Mw = M - TAU * n;
  float h = 0.5 * Mw;
  float x = 2.0 * atan(k * sin(h), cos(h));
  return vec2(x + TAU * n, x);
}

vec3 placeInDisk(float r, float tang, float phi, float y) {
  float c = cos(phi);
  float s = sin(phi);
  return vec3(r * c - tang * s, y + warpHeight(r, phi), -(r * s + tang * c));
}

// Old disk star on its density-wave orbit.
// orbit = (R, M0, w = Ω − Ωp, A)   vert = (zAmp, zPhase, ν, 0)
// offs  = (radial, vertical, tangential, 0)
vec3 diskPosition(vec4 orbit, vec4 vert, vec4 offs) {
  float R = orbit.x;
  float A = orbit.w * armTaper(R);
  float M = orbit.y + ARMS * orbit.z * uTime;
  float phi = armAngle(R, uTime) + armPhase(M, A).x / ARMS;
  float y = vert.x * cos(vert.z * uTime + vert.y) + offs.y;
  return placeInDisk(R + offs.x, offs.z, phi, y);
}

// Young OB star or HII-region member, recycled through the spiral shock:
// born on the birth line (just downstream of the dust lane), it drifts at
// its own Ω for its lifetime τ, then is reborn on a hashed arm/radius.
// orbit = (R, seed, w, birthOffset)   vert = (zAmp, zPhase, ν, τ)
// offs  = (radial, vertical, tangential, t0). Returns age / τ in `life`.
vec3 recycledPosition(vec4 orbit, vec4 vert, vec4 offs, out float life) {
  float tau = vert.w;
  float c = (uTime + offs.w) / tau;
  float cycles = floor(uLoop / tau + 0.5);
  float n = mod(floor(c), cycles);
  float age = fract(c) * tau;
  life = age / tau;
  float seed = orbit.y;
  float hr = hash11(seed * 7.13 + n * 1.618);
  float ha = hash11(seed * 3.71 + n * 2.414 + 11.0);
  float hj = hash11(seed * 5.37 + n * 0.577 + 23.0);
  float R = max(orbit.x + (hr - 0.5) * 2.0, uArmStart);
  float phi = armAngle(R, uTime) + orbit.w * upstreamSign(R) + PI * step(0.5, ha) +
              (hj - 0.5) * 0.1 + orbit.z * age;
  float y = vert.x * cos(vert.z * uTime + vert.y) + offs.y;
  return placeInDisk(R + offs.x, offs.z, phi, y);
}

// Star on an inclined circular orbit (bulge, nuclear cluster, halo,
// globular clusters). orbit = (R, θ0, Ω, 0), offsets in the orbit frame.
vec3 sphericalPosition(vec4 orbit, vec4 offs, float incl, float node) {
  float R = orbit.x;
  float th = orbit.y + orbit.z * uTime;
  vec3 p = vec3((R + offs.x) * cos(th) - offs.z * sin(th), offs.y, -((R + offs.x) * sin(th) + offs.z * cos(th)));
  float ci = cos(incl);
  float si = sin(incl);
  p = vec3(p.x, p.y * ci - p.z * si, p.y * si + p.z * ci);
  float cn = cos(node);
  float sn = sin(node);
  return vec3(p.x * cn - p.z * sn, p.y, p.x * sn + p.z * cn);
}
