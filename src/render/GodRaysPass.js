import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { FULLSCREEN_VERT } from './VolumePass.js';

const tmp = new THREE.Vector3();

// Volumetric light scattering from the golden core (GPU Gems 3, ch. 13):
// bright-pass around the core, radial blur toward it at quarter
// resolution, added back. Strongest near edge-on views, where dust lanes
// break the core's light into shafts.
export class GodRaysPass extends Pass {
  constructor(camera) {
    super();
    this.camera = camera;
    this.taps = 64;
    this.rtA = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.rtB = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.light = new THREE.Vector2(0.5, 0.5);

    this.brightMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uLight: { value: this.light }, uAspect: { value: 1 }, uThreshold: { value: 1 } },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform vec2 uLight;
        uniform float uAspect;
        uniform float uThreshold;
        varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tDiffuse, vUv).rgb;
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          vec2 d = (vUv - uLight) * vec2(uAspect, 1.0);
          float mask = exp(-dot(d, d) * 6.0);
          gl_FragColor = vec4(c * max(l - uThreshold, 0.0) / max(l, 1e-4) * mask, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.blurMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uLight: { value: this.light }, uTaps: { value: 64 } },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform vec2 uLight;
        uniform float uTaps;
        varying vec2 vUv;
        void main() {
          vec2 delta = (vUv - uLight) / uTaps * 0.95;
          vec2 uv = vUv;
          float decay = 1.0;
          vec3 sum = vec3(0.0);
          for (int i = 0; i < 96; i++) {
            if (float(i) >= uTaps) break;
            uv -= delta;
            sum += texture2D(tDiffuse, uv).rgb * decay;
            decay *= 0.965;
          }
          gl_FragColor = vec4(sum * 0.4 / uTaps * 8.0, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.addMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, tRays: { value: this.rtB.texture }, uStrength: { value: 0.2 } },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform sampler2D tRays;
        uniform float uStrength;
        varying vec2 vUv;
        void main() {
          gl_FragColor = vec4(texture2D(tDiffuse, vUv).rgb + texture2D(tRays, vUv).rgb * uStrength, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad();
  }

  setSize(width, height) {
    const w = Math.max(1, Math.round(width / 4));
    const h = Math.max(1, Math.round(height / 4));
    this.rtA.setSize(w, h);
    this.rtB.setSize(w, h);
    this.brightMat.uniforms.uAspect.value = width / height;
  }

  // Returns false when the core is behind the camera (pass skipped).
  update(threshold) {
    const cam = this.camera;
    cam.updateMatrixWorld();
    tmp.set(0, 0, 0).applyMatrix4(cam.matrixWorldInverse);
    if (tmp.z > -1) return false;
    const dist = tmp.length();
    tmp.applyMatrix4(cam.projectionMatrix);
    this.light.set(tmp.x * 0.5 + 0.5, tmp.y * 0.5 + 0.5);
    // Shafts mostly when looking at the core through the disk plane.
    const camPos = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
    const edgeOn = 1 - THREE.MathUtils.smoothstep(Math.abs(camPos.y) / Math.max(camPos.length(), 1e-3), 0.05, 0.4);
    this.addMat.uniforms.uStrength.value = (0.05 + 0.25 * edgeOn) * THREE.MathUtils.clamp(dist / 15, 0, 1);
    this.brightMat.uniforms.uThreshold.value = threshold;
    this.blurMat.uniforms.uTaps.value = this.taps;
    return true;
  }

  render(renderer, writeBuffer, readBuffer) {
    this.brightMat.uniforms.tDiffuse.value = readBuffer.texture;
    this.quad.material = this.brightMat;
    renderer.setRenderTarget(this.rtA);
    this.quad.render(renderer);

    this.blurMat.uniforms.tDiffuse.value = this.rtA.texture;
    this.quad.material = this.blurMat;
    renderer.setRenderTarget(this.rtB);
    this.quad.render(renderer);

    this.addMat.uniforms.tDiffuse.value = readBuffer.texture;
    this.quad.material = this.addMat;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose() {
    this.rtA.dispose();
    this.rtB.dispose();
    this.brightMat.dispose();
    this.blurMat.dispose();
    this.addMat.dispose();
    this.quad.dispose();
  }
}
