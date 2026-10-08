import * as THREE from 'three';
import orbitGLSL from '../shaders/orbit.glsl?raw';
import noiseGLSL from '../shaders/noise.glsl?raw';
import fieldGLSL from '../shaders/field.glsl?raw';
import { ARM_WIND, GALAXY, LOOP_PERIOD, PATTERN_SPEED } from '../galaxy/physics.js';

// Shared GLSL prelude: orbit math + noise + analytic galaxy fields.
export const GALAXY_GLSL = `${orbitGLSL}\n${noiseGLSL}\n${fieldGLSL}\n`;

// One set of uniform objects shared by every material, so the galaxy
// clock and fields are updated once per frame and stay in lockstep.
export const galaxyUniforms = {
  uTime: { value: 0 },
  uLoop: { value: LOOP_PERIOD },
  uPatternSpeed: { value: PATTERN_SPEED },
  uArmWind: { value: ARM_WIND },
  uArmRef: { value: GALAXY.armRefRadius },
  uArmPhase0: { value: GALAXY.armPhase0 },
  uArmStart: { value: GALAXY.armStartRadius },
  uDiskRadius: { value: GALAXY.diskRadius },
  uCorotation: { value: GALAXY.corotationRadius },
  uWarp: { value: new THREE.Vector4(GALAXY.warpAmplitude, GALAXY.warpStart, GALAXY.warpScale, GALAXY.warpPhase) },
  uDustDensity: { value: 1.6 },
  uCoreColor: { value: new THREE.Color(1.0, 0.72, 0.36) },
  uBulgeColor: { value: new THREE.Color(1.0, 0.64, 0.3) },
  uCoreAmp: { value: new THREE.Vector2(0.55, 18.0) },
};
