import './hud.css';

const nf1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const nfInt = new Intl.NumberFormat('pt-BR');

export const TIME_STEPS = [0.1, 0.25, 0.5, 1, 2, 4, 10];
const SLIDER_MIN = -1.1;

export function formatScale(scale) {
  return scale <= 0 ? 'Pausado' : `${nf1.format(scale)}×`;
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c) node.append(c);
  return node;
}

// pt-BR heads-up display. All controls are real buttons/inputs with ARIA
// state; it fades out after 3 s idle and stays while it is being used.
export class Hud {
  constructor(root, { prefs, starCount, actions }) {
    this.prefs = prefs;
    this.actions = actions;
    this.hiddenByUser = false;
    this.pinnedUntil = performance.now() + 6000;
    this.lastActivity = performance.now();
    this.hovering = false;
    this.capturing = false;
    this.paused = false;

    const starsText = `${nfInt.format(starCount)} estrelas`;
    this.live = el('div', { class: 'sr-only', 'aria-live': 'polite' });

    const title = el('div', { class: 'hud__title' }, [el('h1', { text: 'Órbita' }), el('p', { text: `Galáxia espiral · ${starsText}` })]);

    this.fps = el('span', { class: 'hud__fps', text: `— fps · ${starsText}` });
    this.starsText = starsText;
    const fsBtn = el('button', { type: 'button', 'aria-label': 'Tela cheia (F)', title: 'Tela cheia (F)', onclick: () => actions.fullscreen() }, '⛶');
    const stats = el('div', { class: 'hud__stats' }, [this.fps, fsBtn]);

    // --- dock
    this.pauseBtn = el('button', { type: 'button', 'aria-label': 'Pausar simulação (Espaço)', title: 'Pausar (Espaço)', onclick: () => actions.togglePause() }, '❚❚');
    this.slider = el('input', {
      type: 'range',
      min: String(SLIDER_MIN),
      max: '1',
      step: '0.01',
      value: '0',
      'aria-label': 'Velocidade do tempo',
      oninput: () => {
        let v = Number(this.slider.value);
        if (Math.abs(v) < 0.04) {
          v = 0;
          this.slider.value = '0';
        }
        const scale = v <= SLIDER_MIN + 0.001 ? 0 : Math.pow(10, v);
        actions.setTimeScale(scale);
      },
    });
    this.timeLabel = el('label', { text: '1×' });
    const time = el('div', { class: 'hud__time' }, [this.timeLabel, this.slider]);

    this.modeCine = el('button', { type: 'button', role: 'radio', 'aria-checked': 'true', onclick: () => actions.setMode('cinematic') }, [
      el('span', { text: 'Cinematográfico', class: 'label-long' }),
      el('span', { text: '🎬', 'aria-hidden': 'true', class: 'hud__mobile-only' }),
    ]);
    this.modeFree = el('button', { type: 'button', role: 'radio', 'aria-checked': 'false', onclick: () => actions.setMode('free') }, [
      el('span', { text: 'Livre', class: 'label-long' }),
      el('span', { text: '✥', 'aria-hidden': 'true', class: 'hud__mobile-only' }),
    ]);
    const modes = el('div', { class: 'hud__segment', role: 'radiogroup', 'aria-label': 'Modo de câmera' }, [this.modeCine, this.modeFree]);

    this.settingsBtn = el('button', { type: 'button', 'aria-expanded': 'false', 'aria-controls': 'hud-settings', onclick: () => this.togglePopover() }, [
      el('span', { text: '⚙', 'aria-hidden': 'true' }),
      el('span', { text: 'Ajustes', class: 'label-long' }),
    ]);
    this.captureFill = el('i', { class: 'fill' });
    this.captureText = el('span', { text: 'Capturar 8K' });
    this.captureBtn = el('button', { type: 'button', class: 'hud__capture', title: 'Capturar imagem 7680×4320 (K)', onclick: () => (this.capturing ? actions.cancelCapture() : actions.capture()) }, [
      this.captureFill,
      el('span', { text: '◉', 'aria-hidden': 'true' }),
      this.captureText,
    ]);

    const dock = el('div', { class: 'hud__dock glass', role: 'toolbar', 'aria-label': 'Controles' }, [
      this.pauseBtn,
      time,
      el('span', { class: 'hud__sep' }),
      modes,
      el('span', { class: 'hud__sep' }),
      this.settingsBtn,
      this.captureBtn,
    ]);

    this.resume = el('div', { class: 'hud__resume glass', hidden: true }, [
      el('button', { type: 'button', onclick: () => actions.setMode('cinematic') }, '▶ Retomar voo (C)'),
    ]);

    // --- settings popover
    this.qualityBtns = {};
    const qRow = el('div', { class: 'row', role: 'radiogroup', 'aria-label': 'Qualidade' });
    for (const [key, label] of [
      ['baixa', 'Baixa'],
      ['media', 'Média'],
      ['alta', 'Alta'],
      ['ultra', 'Ultra'],
    ]) {
      const b = el('button', { type: 'button', role: 'radio', 'aria-checked': String(prefs.quality === key), onclick: () => actions.setQuality(key) }, label);
      this.qualityBtns[key] = b;
      qRow.append(b);
    }
    this.toggles = {};
    const toggleList = [
      ['dust', 'Poeira', 'D'],
      ['bloom', 'Bloom', 'B'],
      ['lens', 'Lente gravitacional', 'G'],
      ['letterbox', 'Letterbox 2,39:1', 'L'],
      ['captions', 'Legendas de cena', null],
      ['reducedMotion', 'Movimento reduzido', null],
    ];
    const tCol = el('div', { class: 'row' });
    for (const [key, label, k] of toggleList) {
      const b = el('button', { type: 'button', role: 'switch', class: 'hud__toggle', 'aria-checked': String(!!prefs[key]), onclick: () => actions.toggle(key) }, [
        el('span', { text: k ? `${label} (${k})` : label }),
        el('span', { class: 'switch', 'aria-hidden': 'true' }),
      ]);
      this.toggles[key] = b;
      tCol.append(b);
    }
    this.mobileSlider = el('div', { class: 'hud__mobile-only' });
    this.popover = el('div', { class: 'hud__popover glass', id: 'hud-settings', role: 'dialog', 'aria-label': 'Ajustes', hidden: true }, [
      el('h2', { text: 'Qualidade' }),
      qRow,
      el('h2', { text: 'Efeitos' }),
      tCol,
      this.mobileSlider,
      el('button', { type: 'button', onclick: () => this.showShortcuts(true) }, 'Atalhos de teclado (?)'),
    ]);

    this.caption = el('div', { class: 'hud__caption', 'aria-hidden': 'true' });
    this.toasts = el('div', { class: 'hud__toasts' });

    this.dialog = el('div', { class: 'hud__dialog', hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Atalhos de teclado', onclick: (e) => e.target === this.dialog && this.showShortcuts(false) }, [
      el('div', { class: 'panel glass' }, [
        el('h2', { text: 'Atalhos de teclado' }),
        el(
          'dl',
          {},
          [
            ['C', 'Alternar Cinematográfico / Livre'],
            ['Espaço', 'Pausar ou retomar a simulação'],
            [', .', 'Diminuir / aumentar a velocidade do tempo'],
            ['1–4', 'Qualidade (Baixa, Média, Alta, Ultra)'],
            ['D B G L', 'Poeira, bloom, lente, letterbox'],
            ['H', 'Mostrar / ocultar a interface'],
            ['K', 'Capturar 8K (Esc cancela)'],
            ['F', 'Tela cheia'],
            ['R', 'Reiniciar o voo'],
            ['?', 'Esta lista'],
          ].flatMap(([k, d]) => [el('dt', {}, el('kbd', { text: k })), el('dd', { text: d })]),
        ),
        el('button', { type: 'button', onclick: () => this.showShortcuts(false) }, 'Fechar'),
      ]),
    ]);

    this.root = el('div', { class: 'hud' }, [title, stats, this.caption, this.toasts, this.resume, this.popover, dock, this.dialog, this.live]);
    root.append(this.root);

    for (const node of [dock, stats, this.popover, this.resume]) {
      node.addEventListener('pointerenter', () => (this.hovering = true));
      node.addEventListener('pointerleave', () => (this.hovering = false));
    }
    const wake = () => this.activity();
    window.addEventListener('pointermove', wake, { passive: true });
    window.addEventListener('pointerdown', wake, { passive: true });
    window.addEventListener('wheel', wake, { passive: true });
    window.addEventListener('keydown', (e) => this.onKey(e));
    this.root.addEventListener('focusin', wake);
    // Drop focus left behind by mouse clicks so Space doesn't re-press the
    // last button and the HUD can still fade out.
    this.root.addEventListener('click', (e) => {
      const button = e.target.closest?.('button');
      if (button && e.detail > 0) button.blur();
    });
    this.slider.addEventListener('change', () => this.slider.blur());
  }

  activity() {
    this.lastActivity = performance.now();
  }

  // Called every frame.
  tick(now) {
    const popoverOpen = !this.popover.hidden || !this.dialog.hidden;
    // Only keyboard focus keeps the HUD awake (a mouse click also focuses).
    const active = document.activeElement;
    const focusInside = !!active && active !== document.body && this.root.contains(active) && active.matches(':focus-visible');
    const keepAwake = this.hovering || popoverOpen || focusInside || this.capturing || now < this.pinnedUntil;
    const idle = this.hiddenByUser || (!keepAwake && now - this.lastActivity > 3000);
    this.root.classList.toggle('is-idle', idle);
    document.body.classList.toggle('cursor-hidden', idle && !this.hiddenByUser);
  }

  togglePopover(force) {
    const open = force ?? this.popover.hidden;
    this.popover.hidden = !open;
    this.settingsBtn.setAttribute('aria-expanded', String(open));
    // On narrow screens the time control lives inside the popover.
    const time = this.timeLabel.parentElement;
    if (open && window.matchMedia('(max-width: 640px)').matches) {
      this.mobileSlider.append(time);
    } else if (!open && time.parentElement === this.mobileSlider) {
      this.pauseBtn.after(time);
    }
  }

  showShortcuts(open) {
    this.dialog.hidden = !open;
    if (open) this.dialog.querySelector('button').focus();
  }

  setMode(mode) {
    const cine = mode === 'cinematic';
    this.modeCine.setAttribute('aria-checked', String(cine));
    this.modeFree.setAttribute('aria-checked', String(!cine));
    this.resume.hidden = cine;
    this.announce(cine ? 'Modo cinematográfico' : 'Modo livre');
  }

  setPaused(paused) {
    this.paused = paused;
    this.pauseBtn.textContent = paused ? '▶' : '❚❚';
    this.pauseBtn.setAttribute('aria-label', paused ? 'Retomar simulação (Espaço)' : 'Pausar simulação (Espaço)');
  }

  setTimeScale(scale, paused) {
    this.timeLabel.textContent = paused ? 'Pausado' : formatScale(scale);
    if (document.activeElement !== this.slider) {
      this.slider.value = String(scale <= 0 ? SLIDER_MIN : Math.log10(scale));
    }
  }

  setQuality(key) {
    for (const [k, b] of Object.entries(this.qualityBtns)) b.setAttribute('aria-checked', String(k === key));
  }

  setToggle(key, value) {
    this.toggles[key]?.setAttribute('aria-checked', String(!!value));
  }

  setFps(fps) {
    this.fps.textContent = `${Math.round(fps)} fps · ${this.starsText}`;
    this.fps.classList.toggle('is-warn', fps < 45 && fps >= 30);
    this.fps.classList.toggle('is-bad', fps < 30);
  }

  setLetterboxBar(px) {
    this.root.style.setProperty('--bar-h', `${px}px`);
  }

  showCaption(text) {
    if (!this.prefs.captions) return;
    const c = this.caption;
    c.textContent = text;
    c.getAnimations().forEach((a) => a.cancel());
    c.animate(
      [
        { opacity: 0, offset: 0 },
        { opacity: 0.4, offset: 1 / 5.5 },
        { opacity: 0.4, offset: 4 / 5.5 },
        { opacity: 0, offset: 1 },
      ],
      { duration: 5500, easing: 'ease-in-out' },
    );
    this.announce(text);
  }

  toast(message, { buttons = [], duration = 4000 } = {}) {
    const node = el('div', { class: 'hud__toast', role: 'status' }, [el('span', { text: message })]);
    const close = () => node.remove();
    for (const { label, onClick } of buttons) {
      node.append(
        el('button', {
          type: 'button',
          onclick: () => {
            close();
            onClick?.();
          },
        }, label),
      );
    }
    this.toasts.append(node);
    if (duration) setTimeout(close, duration);
    this.activity();
    return close;
  }

  setCapture(state, progress = 0) {
    this.capturing = state === 'running';
    this.captureFill.style.width = state === 'running' ? `${Math.round(progress * 100)}%` : '0%';
    if (state === 'running') {
      this.captureText.textContent = `Capturando… ${Math.round(progress * 100)}% ✕`;
      this.captureBtn.setAttribute('aria-label', 'Cancelar captura');
    } else if (state === 'done') {
      this.captureText.textContent = 'Salvo ✓';
      this.captureBtn.removeAttribute('aria-label');
      setTimeout(() => {
        if (!this.capturing) this.captureText.textContent = 'Capturar 8K';
      }, 2000);
    } else {
      this.captureText.textContent = 'Capturar 8K';
      this.captureBtn.removeAttribute('aria-label');
    }
    if (state === 'running' && Math.round(progress * 100) % 25 === 0) this.announce(`Capturando ${Math.round(progress * 100)}%`);
  }

  announce(text) {
    this.live.textContent = text;
  }

  toggleHidden() {
    this.hiddenByUser = !this.hiddenByUser;
    if (this.hiddenByUser) {
      this.root.classList.add('is-idle');
      const t = this.toast('HUD oculto — H para mostrar', { duration: 1800 });
      // The toast must stay readable while the rest of the HUD is hidden.
      this.toasts.style.opacity = '1';
      setTimeout(() => {
        this.toasts.style.opacity = '';
        t();
      }, 1800);
    }
    this.activity();
  }

  onKey(e) {
    const el = document.activeElement;
    const typing = el && (el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type !== 'range'));
    // AltGr arrives as Ctrl+Alt on Windows; ABNT2 needs it for '?' on some laptops.
    const altGr = e.getModifierState?.('AltGraph');
    if (typing || ((e.ctrlKey || e.metaKey || e.altKey) && !altGr)) return;
    const a = this.actions;
    const key = e.key;
    let handled = true;
    switch (key.toLowerCase()) {
      case 'c':
        a.toggleMode();
        break;
      case ' ':
        a.togglePause();
        break;
      case ',':
        a.stepTime(-1);
        break;
      case '.':
        a.stepTime(1);
        break;
      case '1':
      case '2':
      case '3':
      case '4':
        a.setQuality(['baixa', 'media', 'alta', 'ultra'][Number(key) - 1]);
        break;
      case 'd':
        a.toggle('dust');
        break;
      case 'b':
        a.toggle('bloom');
        break;
      case 'g':
        a.toggle('lens');
        break;
      case 'l':
        a.toggle('letterbox');
        break;
      case 'h':
        this.toggleHidden();
        break;
      case 'k':
        if (!this.capturing) a.capture();
        break;
      case 'escape':
        if (this.capturing) a.cancelCapture();
        else if (!this.dialog.hidden) this.showShortcuts(false);
        else if (!this.popover.hidden) this.togglePopover(false);
        else handled = false;
        break;
      case 'f':
        a.fullscreen();
        break;
      case 'r':
        a.restart();
        break;
      case '?':
        this.showShortcuts(this.dialog.hidden);
        break;
      default:
        handled = false;
    }
    if (handled) {
      e.preventDefault();
      if (key.toLowerCase() !== 'h') this.activity();
    }
  }
}
