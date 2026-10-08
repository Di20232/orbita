uniform float uSpikeAngle;

varying vec3 vColor;
varying float vSigma;
varying float vSprite;
varying float vSpike;
varying float vGas;

void main() {
  vec2 p = (gl_PointCoord - 0.5) * vSprite; // pixels from the centre
  float rr = length(p) / (0.5 * vSprite);
  if (rr > 1.0) discard;
  float s2 = dot(p, p) / (vSigma * vSigma);

  float I;
  if (vGas > 0.5) {
    // Ionised hydrogen puff: soft and diffuse.
    I = exp(-0.5 * s2) * 0.35;
  } else {
    // Gaussian core + Moffat (β = 2.5) wing.
    I = exp(-0.5 * s2) + 0.015 * pow(1.0 + 0.16 * s2, -2.5);
    if (vSpike > 0.0) {
      float c = cos(uSpikeAngle);
      float s = sin(uSpikeAngle);
      vec2 q = abs(mat2(c, s, -s, c) * p);
      float L = 0.5 * vSprite;
      float w2 = 0.5 * vSigma * vSigma;
      I += vSpike * 0.03 * (exp(-0.5 * q.y * q.y / w2) * pow(max(1.0 - q.x / L, 0.0), 3.0) +
                            exp(-0.5 * q.x * q.x / w2) * pow(max(1.0 - q.y / L, 0.0), 3.0));
    }
  }
  I *= 1.0 - smoothstep(0.85, 1.0, rr);
  gl_FragColor = vec4(vColor * I, 1.0);
}
