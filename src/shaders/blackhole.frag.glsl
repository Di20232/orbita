// Supermassive black hole: lenses the rendered galaxy and draws the
// accretion disk by integrating bent light rays (Schwarzschild metric via
// the Binet equation: a = −1.5·Rs·h²·x / r⁵, h = |x × v|). Outside the
// traced sphere the exact weak-field deflection 2Rs/b is applied
// analytically, so the effect is continuous across its boundary.
// Requires orbit.glsl, noise.glsl and field.glsl prepended.

uniform sampler2D tDiffuse;
uniform sampler2D tFallback; // full-frame low-res frame (tiled capture)
uniform mat4 uProjInv;
uniform mat4 uCamWorld;
uniform mat4 uViewProjFull; // camera without view offset
uniform vec3 uCamPos;
uniform mat3 uBhFrame; // world → disk frame (disk in local XZ)
uniform vec4 uTile; // rendered rect in full-frame px (x, y, w, h), bottom-left origin
uniform vec2 uFullRes;
uniform float uTiled;
uniform float uRs;
uniform float uDiskIn;
uniform float uDiskOut;
uniform float uDiskGain;
uniform float uBhMass;
uniform float uRingGain;
uniform float uFocalPx; // full-frame focal length in px
uniform float uSteps;
uniform float uFade;
uniform float uEmission;
uniform int uDustSamples;

varying vec2 vUv;

#define MAX_STEPS 280
#define SWIRL_PERIOD 600.0

vec3 blackbody(float kelvin) {
  float t = clamp(kelvin, 1000.0, 40000.0) / 100.0;
  float r = t <= 66.0 ? 1.0 : clamp(1.29293618606 * pow(t - 60.0, -0.1332047592), 0.0, 1.0);
  float g = t <= 66.0
    ? clamp(0.39008157876 * log(t) - 0.63184144378, 0.0, 1.0)
    : clamp(1.12989086089 * pow(t - 60.0, -0.0755148492), 0.0, 1.0);
  float b = t >= 66.0 ? 1.0 : (t <= 19.0 ? 0.0 : clamp(0.54320678911 * log(t - 10.0) - 1.19625408914, 0.0, 1.0));
  return pow(vec3(r, g, b), vec3(2.2));
}

// What the unlensed camera sees toward a world-space point.
vec3 sampleScene(vec3 pointWorld) {
  vec4 clip = uViewProjFull * vec4(pointWorld, 1.0);
  if (clip.w <= 1e-4) return vec3(0.0);
  vec2 uvFull = clip.xy / clip.w * 0.5 + 0.5;
  vec2 uv = (uvFull * uFullRes - uTile.xy) / uTile.zw;
  if (all(greaterThan(uv, vec2(0.001))) && all(lessThan(uv, vec2(0.999)))) {
    return texture2D(tDiffuse, uv).rgb;
  }
  if (uTiled > 0.5 && all(greaterThan(uvFull, vec2(0.0))) && all(lessThan(uvFull, vec2(1.0)))) {
    return texture2D(tFallback, uvFull).rgb;
  }
  // Off-screen: stretch the edge, dimmed.
  return texture2D(tDiffuse, clamp(uv, vec2(0.001), vec2(0.999))).rgb * 0.45;
}

vec3 toWorld(vec3 local) {
  return local * uBhFrame; // transpose(uBhFrame) * local
}

vec3 bend(vec3 d, vec3 toward, float a) {
  return normalize(d * cos(a) + toward * sin(a));
}

float swirl(float r, float phi) {
  // Two time-offset copies cross-faded so the differential rotation can run
  // forever without winding the noise into rings (flow-map trick).
  float omega = sqrt(uBhMass / (r * r * r));
  float ta = mod(uTime, SWIRL_PERIOD);
  float tb = mod(uTime + 0.5 * SWIRL_PERIOD, SWIRL_PERIOD);
  float w = abs(2.0 * ta / SWIRL_PERIOD - 1.0);
  float pa = phi - omega * ta;
  float pb = phi - omega * tb + 1.7;
  float lr = log(r) * 9.0;
  float na = fbm(vec3(cos(pa) * 2.2, sin(pa) * 2.2, lr), 4);
  float nb = fbm(vec3(cos(pb) * 2.2, sin(pb) * 2.2, lr + 5.3), 4);
  return mix(na, nb, w);
}

// Accretion disk where a ray crosses the disk plane (local frame).
// Returns premultiplied colour (rgb) and opacity (a).
vec4 diskSample(vec3 p, vec3 rayDir) {
  float r = length(p.xz);
  float x = r / uDiskIn;
  // Novikov–Thorne / Shakura–Sunyaev profile, normalised to peak ≈ 1.
  float T = pow(x, -0.75) * pow(max(1.0 - inversesqrt(x), 0.0), 0.25) / 0.488;

  // Keplerian orbital speed (G·M = Rs/2 in c = 1 units), CCW from +Y.
  float beta = min(sqrt(uRs / (2.0 * max(r - uRs, 0.05 * uRs))), 0.8);
  vec3 vdir = vec3(p.z, 0.0, -p.x) / r;
  float mu = dot(vdir, -rayDir);
  float gamma = inversesqrt(1.0 - beta * beta);
  // Doppler × gravitational redshift.
  float g = sqrt(max(1.0 - uRs / r, 0.02)) / (gamma * (1.0 - beta * mu));

  float n = swirl(r, atan(-p.z, p.x));
  float streak = 0.4 + 1.2 * smoothstep(0.25, 0.85, n);
  float edge = smoothstep(uDiskIn, uDiskIn * 1.2, r) * (1.0 - smoothstep(uDiskOut * 0.6, uDiskOut, r));
  vec3 col = blackbody(7000.0 * T * g) * pow(g, 3.5) * T * T * streak * edge * uDiskGain;
  float alpha = clamp(edge * (0.55 + 0.45 * smoothstep(0.3, 0.8, n)) * 0.92, 0.0, 1.0);
  return vec4(col * alpha, alpha);
}

void main() {
  vec3 base = texture2D(tDiffuse, vUv).rgb;
  if (uFade <= 0.0) {
    gl_FragColor = vec4(base, 1.0);
    return;
  }

  vec4 view = uProjInv * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  view /= view.w;
  vec3 rdW = normalize((uCamWorld * vec4(view.xyz, 0.0)).xyz);
  vec3 ro = uBhFrame * uCamPos;
  vec3 rd = uBhFrame * rdW;

  float Rs = uRs;
  float Rtrace = 20.0 * Rs;
  float Rweak = 160.0 * Rs;
  float Dl = length(ro);
  // Thin-lens source plane: what sits behind the hole is mostly the bulge,
  // ~10 su deep, so the lensing scale stays put as the camera pulls away.
  float Dls = clamp(Dl, 4.0, 12.0);
  float tc = -dot(ro, rd);
  vec3 pc = ro + rd * tc;
  float b = length(pc);
  bool inside = Dl < Rtrace;

  if (b > Rweak || (tc < -Rtrace && !inside)) {
    gl_FragColor = vec4(base, 1.0);
    return;
  }

  vec3 result;
  if (b > Rtrace && !inside) {
    // Weak field: deflection accumulated along the part of the ray ahead
    // of the camera, Rs/b·(1 + tc/√(b²+tc²)) → 2Rs/b far behind the lens.
    float fall = 1.0 - smoothstep(0.5 * Rweak, Rweak, b);
    float a = Rs / b * (1.0 + tc / sqrt(b * b + tc * tc)) * fall * uFade;
    vec3 dirOut = bend(rd, -pc / b, a);
    result = sampleScene(toWorld(pc + dirOut * Dls));
  } else {
    // Strong field: integrate the photon path inside the trace sphere.
    float tStart = 0.0;
    if (!inside) {
      float bb = dot(ro, rd);
      tStart = -bb - sqrt(max(bb * bb - (dot(ro, ro) - Rtrace * Rtrace), 0.0));
    }
    vec3 pos = ro + rd * tStart;
    vec3 vel = rd;
    vec3 hv = cross(pos, vel);
    float h2 = dot(hv, hv);

    vec3 col = vec3(0.0);
    float alpha = 0.0;
    bool captured = false;
    for (int i = 0; i < MAX_STEPS; i++) {
      if (float(i) >= uSteps) break;
      float r = length(pos);
      if (r < Rs) {
        captured = true;
        break;
      }
      if (r > Rtrace * 1.001 && dot(pos, vel) > 0.0) break;
      float dt = clamp(0.1 * (r - 0.8 * Rs), 0.004, 0.6 * Rs * 4.0);
      vec3 prev = pos;
      vel += -1.5 * Rs * h2 * pos / pow(r, 5.0) * dt * 0.5;
      pos += vel * dt;
      vel += -1.5 * Rs * h2 * pos / pow(length(pos), 5.0) * dt * 0.5;

      if (prev.y * pos.y < 0.0 && alpha < 0.995) {
        vec3 hp = mix(prev, pos, prev.y / (prev.y - pos.y));
        float rr = length(hp.xz);
        if (rr > uDiskIn && rr < uDiskOut) {
          vec4 dsk = diskSample(hp, normalize(vel));
          col += (1.0 - alpha) * dsk.rgb;
          alpha += (1.0 - alpha) * dsk.a;
        }
      }
    }
    // Rays still orbiting after the step budget hug the photon sphere.
    if (!captured && length(pos) < 3.0 * Rs) captured = true;

    vec3 behind = vec3(0.0);
    if (!captured) {
      vec3 dirOut = normalize(vel);
      // Weak-field deflection from the stretches outside the traced sphere.
      float bImp = max(sqrt(h2), 1e-4);
      float S = sqrt(max(Rtrace * Rtrace - bImp * bImp, 0.0));
      float outer = Rs / bImp * (1.0 - S / Rtrace) * (inside ? 1.0 : 2.0);
      vec3 perp = -(pos - dirOut * dot(pos, dirOut));
      float pl = length(perp);
      if (pl > 1e-5) dirOut = bend(dirOut, perp / pl, outer);
      behind = sampleScene(toWorld(pos + dirOut * Dls));
    }

    // Crisp photon ring at the critical impact parameter b_c = 3√3/2·Rs,
    // at least one pixel wide, brighter on the approaching side.
    float bImp0 = length(cross(ro, rd));
    float pxSize = max(Dl, 1.0) / uFocalPx;
    float w = max(0.04 * Rs, pxSize);
    float ring = exp(-0.5 * pow((bImp0 - 2.598 * Rs) / w, 2.0)) * (0.02 * Rs / w);
    vec3 side = vec3(pc.z, 0.0, -pc.x);
    float approach = 1.0 + 0.6 * dot(normalize(side + 1e-6), -rd);
    col += ring * uRingGain * approach * vec3(1.0, 0.8, 0.55);

    // Light from the bulge in front of the hole still reaches us.
    float coverage = captured ? 1.0 : alpha;
    vec3 veil = coverage * coreLight(uCamPos, rdW, 0.0, max(tc, 0.0)) * uEmission;
    vec3 ext = extinctionColor(dustColumn(uCamPos, vec3(0.0), uDustSamples, 2));
    result = (col + veil) * ext + (1.0 - alpha) * behind;
  }
  // Never let a non-finite or half-float-overflowing pixel through: bloom
  // would smear it across the whole frame. (NaN fails every comparison.)
  bool finite = all(lessThan(result, vec3(6e4))) && all(greaterThanEqual(result, vec3(0.0)));
  gl_FragColor = vec4(mix(base, finite ? result : base, uFade), 1.0);
}
