import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FULLSCREEN_VERT } from './VolumePass.js';

// Film finish, all in full-frame coordinates so tiled 8K captures match:
// chromatic aberration (HDR) → exposure → ACES → split-tone → vignette →
// letterbox → grain + dither. OutputPass only encodes to sRGB afterwards.
export function createGradePass() {
  const pass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uExposure: { value: 1 },
      uCA: { value: 1.6 }, // px at 1080p, at the frame corners
      uVignette: { value: 1 },
      uGrain: { value: 0.03 },
      uGrainSeed: { value: 0 },
      uLetterbox: { value: 0 },
      uTile: { value: new THREE.Vector4(0, 0, 1, 1) },
      uFullRes: { value: new THREE.Vector2(1, 1) },
    },
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform float uExposure;
      uniform float uCA;
      uniform float uVignette;
      uniform float uGrain;
      uniform float uGrainSeed;
      uniform float uLetterbox;
      uniform vec4 uTile;
      uniform vec2 uFullRes;
      varying vec2 vUv;

      // ACES filmic (Stephen Hill fit), with three.js' 1/0.6 convention.
      vec3 RRTAndODTFit(vec3 v) {
        vec3 a = v * (v + 0.0245786) - 0.000090537;
        vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
        return a / b;
      }
      vec3 aces(vec3 color) {
        const mat3 ACESInputMat = mat3(
          vec3(0.59719, 0.07600, 0.02840),
          vec3(0.35458, 0.90834, 0.13383),
          vec3(0.04823, 0.01566, 0.83777));
        const mat3 ACESOutputMat = mat3(
          vec3(1.60475, -0.10208, -0.00327),
          vec3(-0.53108, 1.10813, -0.07276),
          vec3(-0.07367, -0.00605, 1.07602));
        color = ACESInputMat * (color / 0.6);
        color = RRTAndODTFit(color);
        color = ACESOutputMat * color;
        return clamp(color, 0.0, 1.0);
      }

      float hash(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }

      void main() {
        vec2 px = uTile.xy + vUv * uTile.zw; // full-frame pixel
        vec2 fuv = px / uFullRes;
        vec2 c = fuv * 2.0 - 1.0;
        float aspect = uFullRes.x / uFullRes.y;
        vec2 ca = vec2(c.x * aspect, c.y);
        float r2 = dot(ca, ca) / (aspect * aspect + 1.0);

        // Radial chromatic aberration: red outward, blue inward.
        vec2 off = c * r2 * uCA * (uFullRes.y / 1080.0) / uTile.zw;
        vec3 col;
        col.r = texture2D(tDiffuse, vUv + off).r;
        col.g = texture2D(tDiffuse, vUv).g;
        col.b = texture2D(tDiffuse, vUv - off).b;

        col = aces(col * uExposure);

        // Split-tone: cool shadows, golden highlights.
        float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col *= mix(vec3(0.94, 0.98, 1.08), vec3(1.05, 1.0, 0.92), smoothstep(0.05, 0.75, l));

        // Vignette (r = 1 at the corners).
        col *= mix(1.0, mix(1.0, 0.72, smoothstep(0.45, 1.15, sqrt(r2))), uVignette);

        // Letterbox 2.39:1 matte.
        float bar = max(0.0, (1.0 - aspect / 2.39) * 0.5) * uLetterbox;
        if (fuv.y < bar || fuv.y > 1.0 - bar) col = vec3(0.0);

        // Grain + TPDF dither in an approximate display domain.
        vec3 g = pow(col, vec3(1.0 / 2.2));
        float n = hash(px + uGrainSeed * 17.0) - 0.5;
        float dither = (hash(px * 1.37 + 3.1) + hash(px * 0.71 + 9.7) - 1.0) / 255.0;
        g += n * uGrain * (1.0 - 0.6 * l) + dither;
        col = pow(max(g, 0.0), vec3(2.2));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  return pass;
}

// Copies the incoming frame into a stored target (no swap).
export class SnapshotPass extends ShaderPass {
  constructor() {
    super({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        varying vec2 vUv;
        void main() { gl_FragColor = texture2D(tDiffuse, vUv); }`,
    });
    this.needsSwap = false;
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.enabled = false;
    // Own quad: ShaderPass's internal one is private API.
    this.copyQuad = new FullScreenQuad(this.material);
  }

  // Only follows the composer while recording, so a stored snapshot keeps
  // its size (and contents) while capture tiles are rendered.
  setSize(width, height) {
    if (this.enabled) this.target.setSize(width, height);
  }

  render(renderer, writeBuffer, readBuffer) {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.target);
    this.copyQuad.render(renderer);
  }
}

// Adds a stored full-frame low-frequency layer (bloom + god rays from the
// capture pre-pass) at full-frame UVs, so tiles have no seams.
export function createLowFreqAddPass() {
  const pass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      tAfter: { value: null },
      tBefore: { value: null },
      uTile: { value: new THREE.Vector4(0, 0, 1, 1) },
      uFullRes: { value: new THREE.Vector2(1, 1) },
    },
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform sampler2D tAfter;
      uniform sampler2D tBefore;
      uniform vec4 uTile;
      uniform vec2 uFullRes;
      varying vec2 vUv;
      void main() {
        vec2 fuv = (uTile.xy + vUv * uTile.zw) / uFullRes;
        vec3 low = max(texture2D(tAfter, fuv).rgb - texture2D(tBefore, fuv).rgb, 0.0);
        gl_FragColor = vec4(texture2D(tDiffuse, vUv).rgb + low, 1.0);
      }`,
  });
  pass.enabled = false;
  return pass;
}
