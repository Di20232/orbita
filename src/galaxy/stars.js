import * as THREE from 'three';
import starsVert from '../shaders/stars.vert.glsl?raw';
import starsFrag from '../shaders/stars.frag.glsl?raw';
import { GALAXY_GLSL, galaxyUniforms } from '../render/uniforms.js';

// All 320,000 stars in a single draw call. Positions are evaluated on the
// GPU from orbital elements, so the CPU never touches them per frame.
export function createStars(data) {
  const geometry = new THREE.BufferGeometry();
  // Three.js sizes draw calls from `position`; the real positions are
  // computed in the vertex shader, so this buffer stays zero.
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(data.count * 3), 3));
  geometry.setAttribute('aOrbit', new THREE.BufferAttribute(data.orbit, 4));
  geometry.setAttribute('aVert', new THREE.BufferAttribute(data.vert, 4));
  geometry.setAttribute('aOffset', new THREE.BufferAttribute(data.offset, 4));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(data.color, 3));
  geometry.setAttribute('aProps', new THREE.BufferAttribute(data.props, 4));
  geometry.setAttribute('aNode', new THREE.BufferAttribute(data.node, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...galaxyUniforms,
      uViewportH: { value: 1080 },
      uResScale: { value: 1 },
      uFluxK: { value: 14000 },
      uMaxSprite: { value: 64 },
      uExtinction: { value: 1 },
      uDustSamples: { value: 5 },
      uSpikeLen: { value: 26 },
      uSpikeAngle: { value: 0.26 },
    },
    vertexShader: GALAXY_GLSL + starsVert,
    fragmentShader: starsFrag,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 1;
  return points;
}

// Faint foreground/background sky so the void has depth and parallax.
// These are not part of the galaxy's 320,000 stars.
export function createSky(count = 2400, seed = 7) {
  let s = seed;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const z = 2 * rand() - 1;
    const t = 2 * Math.PI * rand();
    const r = Math.sqrt(1 - z * z);
    pos.set([r * Math.cos(t) * 3000, z * 3000, r * Math.sin(t) * 3000], i * 3);
    const warm = rand();
    const b = Math.pow(rand(), 6) * 0.9 + 0.04;
    col.set([b * (0.8 + 0.2 * warm), b * 0.85, b * (1.0 - 0.25 * warm)], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const material = new THREE.ShaderMaterial({
    uniforms: { uResScale: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute vec3 color;
      uniform float uResScale;
      varying vec3 vColor;
      void main() {
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = 2.2 * uResScale;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() {
        vec2 p = gl_PointCoord * 2.0 - 1.0;
        float i = exp(-dot(p, p) * 4.0);
        gl_FragColor = vec4(vColor * i, 1.0);
      }`,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
  const sky = new THREE.Points(geometry, material);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  // The sky follows the camera so it behaves as if infinitely far away.
  sky.onBeforeRender = (renderer, scene, camera) => {
    sky.position.copy(camera.position);
    sky.updateMatrixWorld();
  };
  return sky;
}
