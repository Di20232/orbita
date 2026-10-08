// GPU mirror of src/galaxy/physics.js — keep the two in sync.
// Requires uniforms: uTime, uPatternSpeed, uArmWind, uArmRef, uArmPhase0,
// uArmStart, uDiskRadius.

#define ARMS 2.0
#define TAU 6.283185307179586
#define PI 3.141592653589793

uniform float uTime;
uniform float uPatternSpeed;
uniform float uArmWind;
uniform float uArmRef;
uniform float uArmPhase0;
uniform float uArmStart;
uniform float uDiskRadius;

float armAngle(float R, float t) {
  float rr = max(R, uArmStart * 0.5);
  return uArmPhase0 - uArmWind * log(rr / uArmRef) + uPatternSpeed * t;
}

float armTaper(float R) {
  return smoothstep(uArmStart * 0.7, uArmStart * 1.8, R) *
         (1.0 - smoothstep(uDiskRadius * 0.82, uDiskRadius * 1.12, R));
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

// Disk star on its density-wave orbit. Returns world position; writes the
// wrapped arm phase (0 = crest) to `phaseOut` for brightness gating.
vec3 diskPosition(vec4 orbit, vec4 vert, vec4 offs, out float phaseOut) {
  float R = orbit.x;
  float w = orbit.z;
  float A = orbit.w * armTaper(R);
  float M = orbit.y + ARMS * w * uTime;
  vec2 xp = armPhase(M, A);
  float phi = armAngle(R, uTime) + xp.x / ARMS;
  phaseOut = xp.y * sign(w) - offs.w;
  float c = cos(phi);
  float s = sin(phi);
  float r = R + offs.x;
  float tang = offs.z;
  float y = vert.x * cos(vert.z * uTime + vert.y) + offs.y;
  return vec3(r * c - tang * s, y, -(r * s + tang * c));
}

// Star on an inclined circular orbit (bulge, halo, globular clusters).
vec3 sphericalPosition(vec4 orbit, vec4 offs, float incl, float node) {
  float R = orbit.x;
  float th = orbit.y + orbit.z * uTime;
  // Orbit in its own plane, then tilt by inclination and rotate by node.
  vec3 p = vec3((R + offs.x) * cos(th) - offs.z * sin(th), offs.y, -((R + offs.x) * sin(th) + offs.z * cos(th)));
  float ci = cos(incl);
  float si = sin(incl);
  p = vec3(p.x, p.y * ci - p.z * si, p.y * si + p.z * ci);
  float cn = cos(node);
  float sn = sin(node);
  return vec3(p.x * cn - p.z * sn, p.y, p.x * sn + p.z * cn);
}
