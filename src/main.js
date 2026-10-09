import './style.css';

const loading = document.getElementById('loading');
const msg = loading.querySelector('.loading__msg');
const bar = loading.querySelector('.loading__bar i');

const ui = {
  status(text) {
    msg.textContent = text;
  },
  progress(fraction) {
    bar.style.width = `${Math.round(fraction * 100)}%`;
  },
  done() {
    loading.classList.add('is-done');
    setTimeout(() => loading.remove(), 1400);
  },
  fail(text, { reload = false } = {}) {
    msg.textContent = text;
    if (reload) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = 'Recarregar';
      b.onclick = () => location.reload();
      msg.append(document.createElement('br'), b);
    }
  },
};

// Check WebGL2 before loading the heavy app bundle.
function probeWebGL2() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return null;
    const info = { halfFloat: !!gl.getExtension('EXT_color_buffer_float') || !!gl.getExtension('EXT_color_buffer_half_float') };
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return info;
  } catch {
    return null;
  }
}

const caps = probeWebGL2();
if (!caps) {
  ui.fail('WebGL2 indisponível — atualize o navegador e ative a aceleração por hardware.');
} else {
  ui.status('Gerando 320.000 estrelas…');
  import('./app.js')
    .then(({ startApp }) => startApp({ ui, caps }))
    .catch((err) => {
      console.error(err);
      ui.fail('Não foi possível iniciar a galáxia.', { reload: true });
    });
}
