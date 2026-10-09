import { generateGalaxy } from './generate.js';

// Generate in a Web Worker when possible; fall back to the main thread.
export function loadGalaxy({ seed, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    } catch {
      resolve(generateGalaxy({ seed, onProgress }));
      return;
    }
    worker.onmessage = (e) => {
      if (e.data.type === 'progress') onProgress?.(e.data.fraction, e.data.label);
      else if (e.data.type === 'done') {
        worker.terminate();
        resolve(e.data.data);
      }
    };
    worker.onerror = (err) => {
      worker.terminate();
      try {
        resolve(generateGalaxy({ seed, onProgress }));
      } catch (e) {
        reject(e || err);
      }
    };
    worker.postMessage({ seed });
  });
}
