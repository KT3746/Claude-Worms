/**
 * Som sintetizado com WebAudio — nenhum arquivo de áudio no projeto.
 *
 * O contexto só é criado no primeiro gesto do usuário, como exigem os
 * navegadores modernos.
 */

let ctx = null;
let master = null;
let enabled = true;

function ensure() {
  if (ctx) return ctx;
  // Fora do navegador (testes em Node, por exemplo) `window` nem existe —
  // sem esta guarda, qualquer efeito sonoro derrubava quem chamasse.
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? window.webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  master = ctx.createGain();
  master.gain.value = 0.35;
  master.connect(ctx.destination);
  return ctx;
}

function ready() {
  if (!enabled) return null;
  const context = ensure();
  if (!context) return null;
  if (context.state === 'suspended') context.resume();
  return context;
}

/** Ruído branco curto — base para impactos e para o zunido da flecha. */
function noiseBurst({ duration = 0.2, volume = 0.4, filterHz = 1200, type = 'lowpass' }) {
  const context = ready();
  if (!context) return;

  const frames = Math.floor(context.sampleRate * duration);
  const buffer = context.createBuffer(1, frames, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  }

  const source = context.createBufferSource();
  source.buffer = buffer;

  const filter = context.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = filterHz;

  const gain = context.createGain();
  gain.gain.setValueAtTime(volume, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);

  source.connect(filter).connect(gain).connect(master);
  source.start();
  source.stop(context.currentTime + duration);
}

function tone({ freq = 440, duration = 0.2, volume = 0.3, type = 'sine', sweepTo = null }) {
  const context = ready();
  if (!context) return;

  const osc = context.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, context.currentTime);
  if (sweepTo) {
    osc.frequency.exponentialRampToValueAtTime(sweepTo, context.currentTime + duration);
  }

  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(volume, context.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);

  osc.connect(gain).connect(master);
  osc.start();
  osc.stop(context.currentTime + duration);
}

export const sfx = {
  setEnabled(value) {
    enabled = value;
  },

  get enabled() {
    return enabled;
  },

  /** Corda sendo puxada — a altura sobe conforme a força. */
  draw(power) {
    tone({ freq: 90 + power * 80, duration: 0.08, volume: 0.08, type: 'triangle' });
  },

  /** Disparo: estalo da corda + zunido da flecha. */
  release(power) {
    noiseBurst({ duration: 0.12, volume: 0.35, filterHz: 900 + power * 1800 });
    tone({ freq: 220 + power * 160, sweepTo: 90, duration: 0.25, volume: 0.18, type: 'sawtooth' });
  },

  /** Flecha crava no alvo — quanto melhor o anel, mais agudo o "toc". */
  hit(ring) {
    noiseBurst({ duration: 0.18, volume: 0.4, filterHz: 500 + ring * 90 });
    tone({ freq: 160 + ring * 22, sweepTo: 70, duration: 0.14, volume: 0.2, type: 'square' });
  },

  /** Flecha no chão ou fora do alvo. */
  miss() {
    noiseBurst({ duration: 0.22, volume: 0.25, filterHz: 380 });
  },

  /** Acertou o X. */
  bullseye() {
    [880, 1320, 1760].forEach((freq, i) => {
      setTimeout(() => tone({ freq, duration: 0.22, volume: 0.16, type: 'sine' }), i * 70);
    });
  },

  /** Balão estourado. */
  pop() {
    noiseBurst({ duration: 0.09, volume: 0.45, filterHz: 2600, type: 'bandpass' });
  },

  /** Fim de nível com sucesso. */
  fanfare() {
    [523, 659, 784, 1047].forEach((freq, i) => {
      setTimeout(() => tone({ freq, duration: 0.3, volume: 0.15, type: 'triangle' }), i * 110);
    });
  },

  /** Explosão: estrondo grave, mais longo quanto maior o raio. */
  explosao(raio = 2.4) {
    const duracao = Math.min(0.85, 0.3 + raio * 0.12);
    noiseBurst({ duration: duracao, volume: 0.55, filterHz: 220 + raio * 40 });
    tone({ freq: 90 + raio * 8, sweepTo: 32, duration: duracao * 0.8, volume: 0.3, type: 'sawtooth' });
  },

  /** Foguete saindo do cano. */
  disparo() {
    noiseBurst({ duration: 0.3, volume: 0.3, filterHz: 1100, type: 'highpass' });
    tone({ freq: 140, sweepTo: 420, duration: 0.32, volume: 0.14, type: 'sawtooth' });
  },

  /** Granada batendo no chão. */
  quique() {
    tone({ freq: 300, sweepTo: 160, duration: 0.09, volume: 0.14, type: 'square' });
  },

  /** Alguém caiu na água. */
  respingo() {
    noiseBurst({ duration: 0.45, volume: 0.4, filterHz: 1500, type: 'bandpass' });
    tone({ freq: 620, sweepTo: 180, duration: 0.3, volume: 0.12, type: 'sine' });
  },

  /** Minhoca levou dano. */
  ai() {
    tone({ freq: 420, sweepTo: 240, duration: 0.14, volume: 0.14, type: 'triangle' });
  },

  /** Sirene da morte súbita. */
  sirene() {
    tone({ freq: 300, sweepTo: 700, duration: 0.6, volume: 0.16, type: 'sawtooth' });
    setTimeout(() => tone({ freq: 700, sweepTo: 300, duration: 0.6, volume: 0.16, type: 'sawtooth' }), 600);
  },

  /** Passa a vez. */
  vez() {
    tone({ freq: 440, duration: 0.1, volume: 0.1, type: 'sine' });
    setTimeout(() => tone({ freq: 660, duration: 0.14, volume: 0.1, type: 'sine' }), 90);
  },

  /** Corda ninja disparada — um estalo curto e seco. */
  corda() {
    noiseBurst({ duration: 0.08, volume: 0.25, filterHz: 2200, type: 'highpass' });
    tone({ freq: 500, sweepTo: 700, duration: 0.06, volume: 0.1, type: 'square' });
  },

  /** Teleporte — um "warp" subindo rápido. */
  teleporte() {
    tone({ freq: 220, sweepTo: 1400, duration: 0.22, volume: 0.16, type: 'sine' });
    noiseBurst({ duration: 0.2, volume: 0.15, filterHz: 3000, type: 'highpass' });
  },

  /** Clique de interface. */
  click() {
    tone({ freq: 520, duration: 0.06, volume: 0.12, type: 'square' });
  },
};
