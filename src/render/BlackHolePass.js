import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import blackholeFrag from '../shaders/blackhole.frag.glsl?raw';
import { GALAXY_GLSL, galaxyUniforms } from './uniforms.js';
import { FULLSCREEN_VERT } from './VolumePass.js';
import { GALAXY } from '../galaxy/physics.js';

const tmp = new THREE.Vector3();

// Ray-traced supermassive black hole + gravitational lensing of the frame.
// Skipped entirely (and faded smoothly) when the hole is far off-screen.
export class BlackHolePass extends Pass {
  constructor(camera) {
    super();
    this.camera = camera;
    this.lensEnabled = true;
    this.fullCamera = camera.clone();
    const tilt = (GALAXY.bhDiskTiltDeg * Math.PI) / 180;
    // Disk tilted about the X axis, then turned so the tilt reads well.
    const frame = new THREE.Matrix4().makeRotationY(0.6).multiply(new THREE.Matrix4().makeRotationX(tilt));
    const worldToDisk = new THREE.Matrix3().setFromMatrix4(frame).transpose();

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        ...galaxyUniforms,
        tDiffuse: { value: null },
        tFallback: { value: null },
        uProjInv: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uViewProjFull: { value: new THREE.Matrix4() },
        uCamPos: { value: new THREE.Vector3() },
        uBhFrame: { value: worldToDisk },
        uTile: { value: new THREE.Vector4(0, 0, 1, 1) },
        uFullRes: { value: new THREE.Vector2(1, 1) },
        uTiled: { value: 0 },
        uRs: { value: GALAXY.bhRs },
        uDiskIn: { value: GALAXY.bhDiskInner },
        uDiskOut: { value: GALAXY.bhDiskOuter },
        uDiskGain: { value: 14 },
        uBhMass: { value: GALAXY.bhMass },
        uRingGain: { value: 6 },
        uFocalPx: { value: 1000 },
        uSteps: { value: 160 },
        uFade: { value: 1 },
        uEmission: { value: 1 },
        uDustSamples: { value: 6 },
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: GALAXY_GLSL + blackholeFrag,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  // Decide whether the hole influences this frame; returns the fade.
  update(fullWidth, fullHeight) {
    const cam = this.camera;
    const u = this.material.uniforms;
    cam.updateMatrixWorld();
    // Full-frame camera (no view offset) for projecting lensed samples.
    const full = this.fullCamera;
    full.copy(cam, false);
    full.clearViewOffset();
    full.updateProjectionMatrix();
    full.updateMatrixWorld();
    u.uViewProjFull.value.multiplyMatrices(full.projectionMatrix, full.matrixWorldInverse);
    u.uProjInv.value.copy(cam.projectionMatrixInverse);
    u.uCamWorld.value.copy(cam.matrixWorld);
    u.uCamPos.value.setFromMatrixPosition(cam.matrixWorld);
    u.uFullRes.value.set(fullWidth, fullHeight);
    const focal = (0.5 * fullHeight) / Math.tan(THREE.MathUtils.degToRad(full.fov) * 0.5);
    u.uFocalPx.value = focal;

    const D = u.uCamPos.value.length();
    const rStrong = 20 * GALAXY.bhRs;
    let fade = 0;
    if (this.lensEnabled) {
      if (D < rStrong * 1.5) {
        fade = 1;
      } else {
        tmp.set(0, 0, 0).applyMatrix4(full.matrixWorldInverse);
        if (tmp.z < 0) {
          tmp.applyMatrix4(full.projectionMatrix);
          const px = Math.abs(tmp.x) * 0.5 * fullWidth - 0.5 * fullWidth;
          const py = Math.abs(tmp.y) * 0.5 * fullHeight - 0.5 * fullHeight;
          const outside = Math.max(px, py, 0);
          const margin = (focal * rStrong * 2.5) / D + 8;
          fade = 1 - THREE.MathUtils.smoothstep(outside, margin * 0.5, margin);
        }
      }
    }
    u.uFade.value = fade;
    return fade;
  }

  render(renderer, writeBuffer, readBuffer) {
    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    if (!u.uTiled.value) u.tFallback.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose() {
    this.material.dispose();
    this.quad.dispose();
  }
}
