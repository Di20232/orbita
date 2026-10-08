import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import volumeFrag from '../shaders/volume.frag.glsl?raw';
import { GALAXY_GLSL, galaxyUniforms } from './uniforms.js';

const FULLSCREEN_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }`;

// Raymarches the diffuse galaxy light and dust into a reduced-resolution
// target. The result is composited inside the scene by `compositeMesh`
// (dst = L + dst·T) before the stars, so it attenuates only the sky behind
// it while every star carries its own extinction.
export class VolumePass extends Pass {
  constructor(camera) {
    super();
    this.camera = camera;
    this.needsSwap = false;
    this.clear = false;
    this.scale = 0.5;
    this.rt = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        ...galaxyUniforms,
        uProjInv: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uCamPos: { value: new THREE.Vector3() },
        uSteps: { value: 48 },
        uEmission: { value: 1 },
        uDustOn: { value: 1 },
        uOctaves: { value: 3 },
        uScatter: { value: 1.5 },
        uTile: { value: new THREE.Vector4(0, 0, 1, 1) },
        uTileSize: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: GALAXY_GLSL + volumeFrag,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);

    this.compositeMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: { tVolume: { value: this.rt.texture } },
        vertexShader: FULLSCREEN_VERT,
        fragmentShader: /* glsl */ `
          uniform sampler2D tVolume;
          varying vec2 vUv;
          void main() { gl_FragColor = texture2D(tVolume, vUv); }`,
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.SrcAlphaFactor,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.compositeMesh.frustumCulled = false;
    this.compositeMesh.renderOrder = 0;
  }

  setSize(width, height) {
    this.rt.setSize(Math.max(1, Math.round(width * this.scale)), Math.max(1, Math.round(height * this.scale)));
    this.material.uniforms.uTileSize.value.set(width, height);
  }

  render(renderer) {
    const u = this.material.uniforms;
    this.camera.updateMatrixWorld();
    u.uProjInv.value.copy(this.camera.projectionMatrixInverse);
    u.uCamWorld.value.copy(this.camera.matrixWorld);
    u.uCamPos.value.setFromMatrixPosition(this.camera.matrixWorld);
    renderer.setRenderTarget(this.rt);
    this.quad.render(renderer);
  }

  dispose() {
    this.rt.dispose();
    this.material.dispose();
    this.quad.dispose();
  }
}

export { FULLSCREEN_VERT };
