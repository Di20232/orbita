// Requires orbit.glsl, noise.glsl and field.glsl prepended.
attribute vec4 aOrbit;
attribute vec4 aVert;
attribute vec4 aOffset;
attribute vec3 aColor;
attribute vec4 aProps;
attribute float aNode;

uniform float uViewportH; // height of the current render target (tile) in px
uniform float uResScale; // full-frame height / 1080
uniform float uFluxK;
uniform float uMaxSprite;
uniform float uExtinction; // 0 disables per-star dust extinction
uniform int uDustSamples;
uniform float uSpikeLen; // spike half-length in 1080p px

varying vec3 vColor;
varying float vSigma;
varying float vSprite;
varying float vSpike;
varying float vGas;

#define KIND_NURSERY 2.0
#define KIND_BULGE 3.0
#define SPIKE_FLAG 8.0

void main() {
  float code = aProps.z;
  float spike = step(SPIKE_FLAG - 0.5, code);
  float kind = code - SPIKE_FLAG * spike;

  vec3 pos;
  float fade = 1.0;
  float gas = 0.0;
  if (kind > KIND_BULGE - 0.5) {
    pos = sphericalPosition(aOrbit, aOffset, aProps.w, aNode);
  } else if (aVert.w > 0.0) {
    float life;
    pos = recycledPosition(aOrbit, aVert, aOffset, life);
    gas = step(0.5, aProps.w);
    // Stars switch on at birth and burn out; ionised gas disperses sooner.
    fade = gas > 0.5
      ? smoothstep(0.0, 0.1, life) * (1.0 - smoothstep(0.4, 0.7, life))
      : smoothstep(0.0, 0.12, life) * (1.0 - smoothstep(0.6, 1.0, life));
  } else {
    pos = diskPosition(aOrbit, aVert, aOffset);
  }

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  float d = max(-mv.z, 1e-3);
  // Focal length in full-frame pixels (exact under setViewOffset tiling).
  float fpx = projectionMatrix[1][1] * 0.5 * uViewportH;

  // A star is a PSF, not a disc: σ is the optics' blur in 1080p pixels,
  // widened only when the star is close enough to be resolved.
  float sigmaRef = 0.75 * uResScale;
  float sigma = max(length(vec2(sigmaRef, aProps.x * fpx / d)), 0.6);
  float flux = uFluxK * aProps.y * fade / (d * d + 16.0) * smoothstep(0.15, 1.2, d);
  // Peak in resolution-independent units: total energy is conserved, so
  // sub-pixel stars dim instead of flickering.
  float sr = sigma / uResScale;
  float peak = flux / (6.2832 * sr * sr);

  vGas = gas;
  vSpike = spike * smoothstep(3.0, 25.0, peak);
  float halfPx = max(3.0 * sigma + 1.0, vSpike * uSpikeLen * uResScale);
  vSprite = min(2.0 * halfPx, uMaxSprite);
  // Beyond the maximum sprite size keep the surface brightness.
  vSigma = min(sigma, max((0.5 * vSprite - 1.0) / 3.0, 0.5));

  vec3 ext = vec3(1.0);
  if (uExtinction > 0.0) {
    ext = extinctionColor(dustColumn(cameraPosition, pos, uDustSamples, 2) * uExtinction);
  }
  vColor = aColor * peak * ext;

  gl_PointSize = vSprite;
  gl_Position = projectionMatrix * mv;
  // Skip invisible stars entirely (saves fill rate).
  if (max(vColor.r, max(vColor.g, vColor.b)) < 2e-4) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
