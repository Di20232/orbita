import * as THREE from 'three';
import { loadGalaxy } from './galaxy/loadGalaxy.js';
import { TOTAL_STARS } from './galaxy/generate.js';
import { createSky, createStars } from './galaxy/stars.js';
import { LOOP_PERIOD } from './galaxy/physics.js';
import { Pipeline, QUALITY } from './render/pipeline.js';
import { Director } from './camera/director.js';
import { Hud, TIME_STEPS } from './ui/hud.js';

const PREFS_KEY = 'orbita.prefs.v1';

function loadPrefs(defaults) {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    return { ...defaults, ...saved };
  } catch {
    return { ...defaults };
  }
}

function savePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Private mode or storage disabled: preferences just won't persist.
  }
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export async function startApp({ ui, caps }) {
  const params = new URLSearchParams(location.search);
  const reducedMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const prefs = loadPrefs({
    quality: caps.halfFloat ? (coarse ? 'media' : 'alta') : 'baixa',
    dust: true,
    bloom: true,
    lens: true,
    letterbox: false,
    captions: true,
    reducedMotion: reducedMQ.matches,
    hintShown: false,
  });
  if (!caps.halfFloat) prefs.quality = 'baixa';
  if (params.has('quality') && QUALITY[params.get('quality')]) prefs.quality = params.get('quality');
  // Shareable/testable overrides, e.g. ?dust=0&letterbox=1.
  for (const key of ['dust', 'bloom', 'lens', 'letterbox', 'captions']) {
    if (params.has(key)) prefs[key] = params.get(key) === '1';
  }

  // ------------------------------------------------------------- stars
  const data = await loadGalaxy({ onProgress: (f) => ui.progress(0.05 + f * 0.75) });
  ui.status('Compilando shaders…');
  ui.progress(0.85);
  await new Promise((r) => requestAnimationFrame(r));

  const container = document.getElementById('app');
  const canvas = document.getElementById('galaxy');
  const camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.05, 6000);
  const stars = createStars(data);
  const sky = createSky();
  const pipeline = new Pipeline({ canvas, camera, stars, sky });
  Object.assign(pipeline.settings, {
    dust: prefs.dust,
    bloom: prefs.bloom,
    lens: prefs.lens,
    letterbox: prefs.letterbox,
    reducedMotion: prefs.reducedMotion,
  });
  pipeline.letterboxAnim = prefs.letterbox ? 1 : 0;
  pipeline.size = { width: container.clientWidth, height: container.clientHeight };
  pipeline.setQuality(prefs.quality);

  const director = new Director(camera, canvas, { reducedMotion: prefs.reducedMotion });
  if (params.has('t')) director.flyTime = Number(params.get('t')) || 0;
  director.frozen = params.get('freeze') === '1';

  // ------------------------------------------------------- simulation clock
  const clock = {
    sim: Number(params.get('sim')) || 0, // sim-seconds, double precision
    target: 1,
    current: 1,
    paused: params.get('paused') === '1',
  };
  if (clock.paused) clock.current = 0;

  // Compile shaders up front (async where supported) so the first frames
  // don't hitch.
  try {
    if (pipeline.renderer.compileAsync) await pipeline.renderer.compileAsync(pipeline.scene, camera);
  } catch {
    // Compilation will happen lazily on the first frame.
  }
  ui.status('Preparando o voo…');
  ui.progress(1);
  director.update(0, clock.sim % LOOP_PERIOD);
  director.updateExposure(1e6); // start already adapted to the first shot
  pipeline.setTime(clock.sim % LOOP_PERIOD);
  pipeline.exposure = 0;
  pipeline.render(0);
  await new Promise((r) => setTimeout(r, 300));

  // ------------------------------------------------------------------- HUD
  let capture = null;
  const actions = {
    togglePause() {
      clock.paused = !clock.paused;
      hud.setPaused(clock.paused);
      hud.setTimeScale(clock.target, clock.paused);
    },
    setTimeScale(scale) {
      if (scale <= 0) {
        clock.paused = true;
      } else {
        clock.paused = false;
        clock.target = scale;
      }
      hud.setPaused(clock.paused);
      hud.setTimeScale(clock.target, clock.paused);
    },
    stepTime(dir) {
      let i = TIME_STEPS.findIndex((s) => s >= clock.target - 1e-6);
      if (i < 0) i = TIME_STEPS.length - 1;
      i = THREE.MathUtils.clamp(i + dir, 0, TIME_STEPS.length - 1);
      actions.setTimeScale(TIME_STEPS[i]);
    },
    setMode(mode) {
      if (mode === 'free') director.toFree();
      else director.toCinematic(clock.sim % LOOP_PERIOD);
    },
    toggleMode() {
      actions.setMode(director.mode === 'free' ? 'cinematic' : 'free');
    },
    setQuality(key) {
      prefs.quality = key;
      savePrefs(prefs);
      pipeline.setQuality(key);
      hud.setQuality(key);
      hud.announce(`Qualidade ${QUALITY[key].label}`);
    },
    toggle(key) {
      prefs[key] = !prefs[key];
      savePrefs(prefs);
      hud.setToggle(key, prefs[key]);
      if (key in pipeline.settings) pipeline.settings[key] = prefs[key];
      if (key === 'reducedMotion') director.setReducedMotion(prefs[key]);
    },
    fullscreen() {
      if (document.fullscreenElement) document.exitFullscreen?.();
      else document.documentElement.requestFullscreen?.().catch(() => {});
    },
    restart() {
      director.restart();
    },
    capture: () => runCapture({}),
    cancelCapture() {
      capture?.abort();
    },
  };

  const hud = new Hud(document.body, { prefs, starCount: TOTAL_STARS, actions });
  hud.setQuality(prefs.quality);
  hud.setPaused(clock.paused);
  hud.setTimeScale(clock.target, clock.paused);
  if (params.get('hud') === '0') hud.hiddenByUser = true;

  director.addEventListener('mode', (e) => hud.setMode(e.detail));
  director.addEventListener('shot', (e) => {
    if (director.mode === 'cinematic') hud.showCaption(e.detail);
  });

  async function runCapture({ width = 7680, height = 4320, cols = 4, rows = 4 }) {
    if (capture) return;
    if (width === 7680 && isIOS()) {
      ({ width, height, cols, rows } = { width: 3840, height: 2160, cols: 2, rows: 2 });
    }
    capture = new AbortController();
    hud.setCapture('running', 0);
    try {
      const blob = await pipeline.capture({ width, height, cols, rows, signal: capture.signal, onProgress: (f) => hud.setCapture('running', f) });
      download(blob, `orbita-${width >= 7680 ? '8k' : '4k'}-${timestamp()}.png`);
      hud.setCapture('done');
      hud.announce('Imagem salva');
    } catch (err) {
      hud.setCapture('idle');
      if (err?.name === 'AbortError') {
        hud.toast('Captura cancelada', { duration: 2000 });
      } else {
        console.error(err);
        hud.toast('Não foi possível capturar em 8K — tente 4K', {
          duration: 8000,
          buttons: width > 3840 ? [{ label: 'Capturar 4K', onClick: () => setTimeout(() => runCapture({ width: 3840, height: 2160, cols: 2, rows: 2 }), 0) }] : [],
        });
      }
    } finally {
      capture = null;
    }
  }

  // Double-click in free mode: orbit around the clicked point of the disk.
  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  canvas.addEventListener('dblclick', (e) => {
    if (director.mode !== 'free') return;
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    if (hit && hit.length() < 160) director.focusOn(hit);
  });

  // --------------------------------------------------------------- resize
  let resizeTimer = 0;
  const onResize = () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => pipeline.resize(w, h), 150);
  };
  new ResizeObserver(onResize).observe(container);
  const watchDpr = () => {
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mq.addEventListener('change', () => {
      pipeline.setQuality(prefs.quality);
      watchDpr();
    }, { once: true });
  };
  watchDpr();
  reducedMQ.addEventListener('change', () => {
    prefs.reducedMotion = reducedMQ.matches;
    pipeline.settings.reducedMotion = prefs.reducedMotion;
    director.setReducedMotion(prefs.reducedMotion);
    hud.setToggle('reducedMotion', prefs.reducedMotion);
  });

  // ----------------------------------------------------------- GPU resets
  let lostToast = null;
  canvas.addEventListener('webglcontextlost', () => {
    lostToast = hud.toast('A GPU foi reiniciada. Restaurando…', {
      duration: 0,
      buttons: [{ label: 'Recarregar', onClick: () => location.reload() }],
    });
  });
  canvas.addEventListener('webglcontextrestored', () => {
    lostToast?.();
    pipeline.resize(container.clientWidth, container.clientHeight);
  });

  // ---------------------------------------------------------------- loop
  let last = performance.now();
  const startedAt = last;
  let fpsEma = 60;
  let fpsTimer = 0;
  let slowFor = 0;
  let perfAsked = false;
  let autoReturn = null;

  const frame = () => {
    const now = performance.now();
    const dtMs = Math.min(now - last, 100);
    last = now;
    const dt = dtMs / 1000;

    hud.tick(now);
    if (pipeline.capturing) return;

    // Time-scale changes ramp (~0.3 s); pausing glides to a stop (~0.4 s).
    const target = clock.paused ? 0 : clock.target;
    clock.current += (target - clock.current) * (1 - Math.exp(-dt / (clock.paused ? 0.13 : 0.1)));
    if (Math.abs(clock.current - target) < 1e-4) clock.current = target;
    clock.sim += dt * clock.current;
    const simTime = clock.sim % LOOP_PERIOD;

    director.update(dt, simTime);
    // Intro: fade up from −5 EV while the loading screen dissolves.
    const intro = THREE.MathUtils.smoothstep((now - startedAt) / 1000, 0, 1.6);
    pipeline.setTime(simTime);
    pipeline.exposure = Math.pow(2, THREE.MathUtils.lerp(-5, director.exposureEV, intro));
    pipeline.render(dt);
    pipeline.adaptResolution(dtMs);
    hud.setLetterboxBar(pipeline.letterboxBars() * container.clientHeight);

    fpsEma += (1000 / Math.max(dtMs, 1) - fpsEma) * 0.08;
    fpsTimer += dt;
    if (fpsTimer > 0.5) {
      fpsTimer = 0;
      hud.setFps(fpsEma);
    }

    // Offer a lighter preset after 5 s of sustained low frame rate.
    slowFor = fpsEma < 40 ? slowFor + dt : 0;
    if (!perfAsked && slowFor > 5 && (prefs.quality === 'alta' || prefs.quality === 'ultra')) {
      perfAsked = true;
      hud.toast('Desempenho baixo. Mudar para Média?', {
        duration: 12000,
        buttons: [
          { label: 'Mudar', onClick: () => actions.setQuality('media') },
          { label: 'Ignorar', onClick: () => {} },
        ],
      });
    }

    // Free mode: resume the flight after 90 s without interaction.
    if (director.mode === 'free' && !prefs.reducedMotion) {
      const idle = now - Math.max(director.lastInteraction, hud.lastActivity);
      if (idle > 90000 && !autoReturn) {
        const close = hud.toast('Retomando voo em 5 s — mova o mouse para cancelar', { duration: 5000 });
        const at = now + 5000;
        autoReturn = { close, at };
      }
      if (autoReturn) {
        if (hud.lastActivity > autoReturn.at - 5000 + 200) {
          autoReturn.close();
          autoReturn = null;
        } else if (now >= autoReturn.at) {
          autoReturn = null;
          actions.setMode('cinematic');
        }
      }
    } else if (autoReturn) {
      autoReturn.close();
      autoReturn = null;
    }
  };

  const start = () => {
    last = performance.now();
    pipeline.renderer.setAnimationLoop(frame);
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pipeline.renderer.setAnimationLoop(null);
    else start();
  });
  start();
  ui.done();

  if (!prefs.hintShown) {
    setTimeout(() => hud.toast('Arraste para explorar · H oculta a interface · ? atalhos', { duration: 7000 }), 2200);
    prefs.hintShown = true;
    savePrefs(prefs);
  }

  if (params.has('debug')) Object.assign(window, { __orbita: { pipeline, director, clock, hud }, __THREE: THREE });
}
