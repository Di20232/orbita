import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { VolumePass } from './VolumePass.js';
import { BlackHolePass } from './BlackHolePass.js';
import { GodRaysPass } from './GodRaysPass.js';
import { SnapshotPass, createGradePass, createLowFreqAddPass } from './GradePass.js';
import { galaxyUniforms } from './uniforms.js';

// Every preset keeps all 320,000 stars; they differ in resolution and in
// how carefully the volumetric effects are sampled.
export const QUALITY = {
  baixa: { label: 'Baixa', dpr: 0.75, volScale: 0.33, volSteps: 24, octaves: 2, extSamples: 2, bhSteps: 70, godRays: 0, ca: false, scatter: 0 },
  media: { label: 'Média', dpr: 1, volScale: 0.5, volSteps: 36, octaves: 3, extSamples: 3, bhSteps: 110, godRays: 32, ca: true, scatter: 1.2 },
  alta: { label: 'Alta', dpr: 1.5, volScale: 0.5, volSteps: 48, octaves: 3, extSamples: 5, bhSteps: 160, godRays: 64, ca: true, scatter: 1.5 },
  ultra: { label: 'Ultra', dpr: 2, supersample: 1.5, volScale: 0.5, volSteps: 72, octaves: 4, extSamples: 6, bhSteps: 220, godRays: 64, ca: true, scatter: 1.5 },
};

const CAPTURE_PRESET = { volScale: 0.5, volSteps: 80, octaves: 4, extSamples: 8, bhSteps: 260, godRays: 96 };
const DPR_LEVELS = [0.6, 0.75, 0.85, 1, 1.25, 1.5, 2];
const BLOOM_THRESHOLD = 1.2;

export class Pipeline {
  constructor({ canvas, camera, stars, sky }) {
    this.camera = camera;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NoToneMapping;
    r.setClearColor(0x000000, 1);

    const gl = r.getContext();
    this.maxPointSize = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1] || 64;

    this.scene = new THREE.Scene();
    this.stars = stars;
    this.scene.add(sky);
    this.sky = sky;

    this.volume = new VolumePass(camera);
    this.scene.add(this.volume.compositeMesh);
    this.scene.add(stars);

    const composer = new EffectComposer(r, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false }));
    this.composer = composer;
    this.snapScene = new SnapshotPass();
    this.blackHole = new BlackHolePass(camera);
    this.snapBefore = new SnapshotPass();
    this.godRays = new GodRaysPass(camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.55, BLOOM_THRESHOLD);
    this.bloom.highPassUniforms.smoothWidth.value = 0.4;
    this.snapAfter = new SnapshotPass();
    this.lowFreq = createLowFreqAddPass();
    this.grade = createGradePass();
    this.output = new OutputPass();

    composer.addPass(this.volume);
    composer.addPass(new RenderPass(this.scene, camera));
    composer.addPass(this.snapScene);
    composer.addPass(this.blackHole);
    composer.addPass(this.snapBefore);
    composer.addPass(this.godRays);
    composer.addPass(this.bloom);
    composer.addPass(this.snapAfter);
    composer.addPass(this.lowFreq);
    composer.addPass(this.grade);
    composer.addPass(this.output);

    this.settings = { dust: true, bloom: true, lens: true, letterbox: false, reducedMotion: false };
    this.exposure = 1;
    this.baseExposure = 1.15;
    this.letterboxAnim = 0;
    this.grainClock = 0;
    this.size = { width: 1, height: 1 };
    this.dprCap = 1.5;
    this.dpr = 1;
    this.frameEma = 16.7;
    this.slowTime = 0;
    this.fastTime = 0;
    this.dprCooldown = 0;
    this.capturing = false;
    this.setQuality('alta');
  }

  setQuality(name) {
    const q = QUALITY[name] || QUALITY.alta;
    this.qualityName = name;
    this.quality = q;
    // Never render above the display density, except Ultra which may
    // supersample low-density screens.
    const device = window.devicePixelRatio || 1;
    this.dprCap = Math.min(q.dpr, Math.max(device, q.supersample ?? 1));
    this.dpr = this.dprCap;
    this.applyPreset(q);
    this.resize(this.size.width, this.size.height);
  }

  applyPreset(q) {
    this.volume.scale = q.volScale;
    const vu = this.volume.material.uniforms;
    vu.uSteps.value = q.volSteps;
    vu.uOctaves.value = q.octaves;
    vu.uScatter.value = q.scatter ?? 1.5;
    this.stars.material.uniforms.uDustSamples.value = q.extSamples;
    this.blackHole.material.uniforms.uSteps.value = q.bhSteps;
    this.blackHole.material.uniforms.uDustSamples.value = Math.max(2, q.extSamples);
    this.godRays.taps = q.godRays;
    this.caAmount = q.ca === false ? 0 : 1.6;
  }

  resize(width, height) {
    this.size = { width: Math.max(1, width), height: Math.max(1, height) };
    if (this.capturing) return;
    const r = this.renderer;
    r.setPixelRatio(this.dpr);
    r.setSize(this.size.width, this.size.height, false);
    this.composer.setPixelRatio(this.dpr);
    this.composer.setSize(this.size.width, this.size.height);
  }

  get bufferSize() {
    return { width: Math.round(this.size.width * this.dpr), height: Math.round(this.size.height * this.dpr) };
  }

  // Adaptive resolution: drop a DPR level when frames are slow, climb back
  // after sustained headroom. Each change reallocates targets, so it is
  // rate-limited.
  adaptResolution(dtMs) {
    if (this.capturing) return;
    this.frameEma += (dtMs - this.frameEma) * 0.05;
    this.dprCooldown = Math.max(0, this.dprCooldown - dtMs);
    const budget = 1000 / 60;
    if (this.frameEma > budget * 1.25) this.slowTime += dtMs;
    else this.slowTime = 0;
    if (this.frameEma < budget * 1.08) this.fastTime += dtMs;
    else this.fastTime = 0;
    if (this.dprCooldown > 0) return;
    const idx = DPR_LEVELS.findIndex((v) => v >= this.dpr - 1e-3);
    if (this.slowTime > 600 && idx > 0) {
      this.dpr = DPR_LEVELS[idx - 1];
      this.slowTime = 0;
      this.dprCooldown = 1500;
      this.resize(this.size.width, this.size.height);
    } else if (this.fastTime > 5000 && idx < DPR_LEVELS.length - 1 && DPR_LEVELS[idx + 1] <= this.dprCap + 1e-3) {
      this.dpr = DPR_LEVELS[idx + 1];
      this.fastTime = 0;
      this.dprCooldown = 1500;
      this.resize(this.size.width, this.size.height);
    }
  }

  // Per-frame uniform updates for a frame of `fullW × fullH` full-frame
  // pixels rendered into a `targetW × targetH` target at full-frame offset
  // (x, y) (bottom-left origin).
  updateFrame({ fullW, fullH, targetW, targetH, x = 0, y = 0, tiled = false }) {
    const resScale = fullH / 1080;
    const su = this.stars.material.uniforms;
    su.uViewportH.value = targetH;
    su.uResScale.value = resScale;
    su.uMaxSprite.value = Math.min(this.maxPointSize, 220 * resScale);
    su.uExtinction.value = this.settings.dust ? 1 : 0;
    this.sky.material.uniforms.uResScale.value = resScale;

    const vu = this.volume.material.uniforms;
    vu.uDustOn.value = this.settings.dust ? 1 : 0;
    vu.uTile.value.set(x, y, fullW, fullH);
    vu.uTileSize.value.set(targetW, targetH);

    const exposure = this.baseExposure * this.exposure;
    const threshold = BLOOM_THRESHOLD / exposure;
    this.bloom.threshold = threshold;
    this.bloom.enabled = this.settings.bloom && !tiled;

    this.blackHole.lensEnabled = this.settings.lens;
    const bhu = this.blackHole.material.uniforms;
    bhu.uTile.value.set(x, y, targetW, targetH);
    bhu.uTiled.value = tiled ? 1 : 0;
    this.blackHole.enabled = this.blackHole.update(fullW, fullH) > 0;

    this.godRays.enabled = !tiled && this.godRays.taps > 0 && this.godRays.update(threshold * 0.8);

    const g = this.grade.uniforms;
    g.uExposure.value = exposure;
    g.uCA.value = this.settings.reducedMotion ? 0 : this.caAmount;
    g.uGrain.value = this.settings.reducedMotion ? 0 : 0.03;
    g.uLetterbox.value = this.letterboxAnim;
    g.uTile.value.set(x, y, targetW, targetH);
    g.uFullRes.value.set(fullW, fullH);
    g.uGrainSeed.value = Math.floor(this.grainClock * 24) % 997;

    const lf = this.lowFreq.uniforms;
    lf.uTile.value.set(x, y, targetW, targetH);
    lf.uFullRes.value.set(fullW, fullH);
  }

  render(dtSeconds) {
    // Letterbox matte eases in/out over 0.7 s.
    const target = this.settings.letterbox ? 1 : 0;
    const step = dtSeconds / 0.7;
    this.letterboxAnim += THREE.MathUtils.clamp(target - this.letterboxAnim, -step, step);
    this.grainClock += dtSeconds;
    const { width, height } = this.bufferSize;
    this.updateFrame({ fullW: width, fullH: height, targetW: width, targetH: height });
    this.composer.render(dtSeconds);
  }

  letterboxBars() {
    const aspect = this.size.width / this.size.height;
    return Math.max(0, (1 - aspect / 2.39) / 2) * this.letterboxAnim;
  }

  // Tiled still capture (default 7680×4320). One tile per animation frame
  // keeps each GPU submission short; bloom and god rays come from a
  // full-frame pre-pass so tiles have no seams.
  async capture({ width = 7680, height = 4320, cols = 4, rows = 4, onProgress, signal } = {}) {
    const r = this.renderer;
    const camera = this.camera;
    const composer = this.composer;
    this.capturing = true;
    const saved = { dpr: this.dpr, quality: this.quality };
    const nextFrame = () => new Promise((res) => requestAnimationFrame(() => res()));
    const tileW = Math.ceil(width / cols);
    const tileH = Math.ceil(height / rows);
    const guard = 160;
    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    const ctx = out.getContext('2d');
    if (!ctx) throw new Error('canvas');

    const readTarget = new THREE.WebGLRenderTarget(tileW + 2 * guard, tileH + 2 * guard, { type: THREE.UnsignedByteType, depthBuffer: false });
    const copyMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tDiffuse, vUv); }',
      depthTest: false,
      depthWrite: false,
    });
    const copyQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), copyMat);
    const copyScene = new THREE.Scene();
    copyScene.add(copyQuad);
    const copyCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const lowW = 1920;
    const lowH = Math.round((1920 * height) / width);
    try {
      composer.renderToScreen = false;
      this.applyPreset({ ...this.quality, ...CAPTURE_PRESET });

      // 1) Full-frame pre-pass: unlensed scene (lens fallback), and the
      //    bloom + god-ray layer as (after − before).
      composer.setPixelRatio(1);
      composer.setSize(lowW, lowH);
      for (const s of [this.snapScene, this.snapBefore, this.snapAfter]) {
        s.enabled = true;
        s.setSize(lowW, lowH);
      }
      this.updateFrame({ fullW: lowW, fullH: lowH, targetW: lowW, targetH: lowH });
      composer.render(0);
      for (const s of [this.snapScene, this.snapBefore, this.snapAfter]) s.enabled = false;
      await nextFrame();

      // 2) Tiles.
      this.lowFreq.enabled = true;
      this.lowFreq.uniforms.tAfter.value = this.snapAfter.target.texture;
      this.lowFreq.uniforms.tBefore.value = this.snapBefore.target.texture;
      this.blackHole.material.uniforms.tFallback.value = this.snapScene.target.texture;
      composer.setSize(tileW + 2 * guard, tileH + 2 * guard);
      const pixels = new Uint8Array((tileW + 2 * guard) * (tileH + 2 * guard) * 4);
      const total = cols * rows;
      let done = 0;
      for (let ty = 0; ty < rows; ty++) {
        for (let tx = 0; tx < cols; tx++) {
          if (signal?.aborted) throw new DOMException('cancelado', 'AbortError');
          const x = tx * tileW - guard;
          const yTop = ty * tileH - guard;
          const w = tileW + 2 * guard;
          const h = tileH + 2 * guard;
          camera.setViewOffset(width, height, x, yTop, w, h);
          camera.updateProjectionMatrix();
          this.updateFrame({ fullW: width, fullH: height, targetW: w, targetH: h, x, y: height - yTop - h, tiled: true });
          composer.render(0);

          copyMat.uniforms.tDiffuse.value = composer.readBuffer.texture;
          r.setRenderTarget(readTarget);
          r.render(copyScene, copyCam);
          r.readRenderTargetPixels(readTarget, 0, 0, w, h, pixels);
          r.setRenderTarget(null);

          const cw = Math.min(tileW, width - tx * tileW);
          const chh = Math.min(tileH, height - ty * tileH);
          const img = ctx.createImageData(cw, chh);
          for (let row = 0; row < chh; row++) {
            // Read-back rows are bottom-up; the guard band is cropped.
            const srcRow = h - 1 - (guard + row);
            const src = (srcRow * w + guard) * 4;
            img.data.set(pixels.subarray(src, src + cw * 4), row * cw * 4);
          }
          ctx.putImageData(img, tx * tileW, ty * tileH);
          done++;
          onProgress?.(done / total);
          await nextFrame();
        }
      }

      // Crop to the 2.39:1 frame when the letterbox is on.
      let final = out;
      if (this.settings.letterbox) {
        const ch = Math.round(width / 2.39);
        final = document.createElement('canvas');
        final.width = width;
        final.height = ch;
        final.getContext('2d').drawImage(out, 0, (height - ch) / 2, width, ch, 0, 0, width, ch);
      }
      return await new Promise((resolve, reject) =>
        final.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/png'),
      );
    } finally {
      camera.clearViewOffset();
      camera.updateProjectionMatrix();
      this.lowFreq.enabled = false;
      this.blackHole.material.uniforms.uTiled.value = 0;
      composer.renderToScreen = true;
      readTarget.dispose();
      copyMat.dispose();
      this.capturing = false;
      this.dpr = saved.dpr;
      this.applyPreset(saved.quality);
      this.resize(this.size.width, this.size.height);
    }
  }

  setTime(t) {
    galaxyUniforms.uTime.value = t;
  }
}
