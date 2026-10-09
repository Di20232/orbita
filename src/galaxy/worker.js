import { generateGalaxy } from './generate.js';

// Builds the 320,000 orbital elements off the main thread and transfers
// the typed arrays back without copying.
self.onmessage = (event) => {
  let last = 0;
  const data = generateGalaxy({
    seed: event.data?.seed,
    onProgress: (fraction, label) => {
      if (fraction - last > 0.04 || fraction === 1) {
        last = fraction;
        self.postMessage({ type: 'progress', fraction, label });
      }
    },
  });
  const buffers = ['orbit', 'vert', 'offset', 'color', 'props', 'node'].map((k) => data[k].buffer);
  self.postMessage({ type: 'done', data }, buffers);
};
