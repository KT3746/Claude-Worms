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

/**
 * Liga `node` na saída master — direto, ou passando por um painner estéreo
 * quando `pan` vem preenchido. `pan` é -1 (esquerda) a 1 (direita); `null`
 * (o padrão de quem não passa nada) pula o painner, pros sons sem posição
 * no mundo (menu, fanfarra, sirene) não pagarem o nó extra à toa.
 */
function conectarSaida(node, context, pan) {
  if (pan == null || typeof context.createStereoPanner !== 'function') {
    node.connect(master);
    return;
  }
  const panner = context.createStereoPanner();
  panner.pan.value = Math.max(-1, Math.min(1, pan));
  node.connect(panner).connect(master);
}

/** Ruído branco curto — base para impactos, passos e o zunido do disparo. */
function noiseBurst({ duration = 0.2, volume = 0.4, filterHz = 1200, type = 'lowpass', pan = null }) {
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

  source.connect(filter).connect(gain);
  conectarSaida(gain, context, pan);
  source.start();
  source.stop(context.currentTime + duration);
}

function tone({ freq = 440, duration = 0.2, volume = 0.3, type = 'sine', sweepTo = null, pan = null }) {
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

  osc.connect(gain);
  conectarSaida(gain, context, pan);
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

  /** Fim de partida com um time em pé. */
  fanfare() {
    [523, 659, 784, 1047].forEach((freq, i) => {
      setTimeout(() => tone({ freq, duration: 0.3, volume: 0.15, type: 'triangle' }), i * 110);
    });
  },

  /** Fim de partida sem ninguém em pé — o mesmo formato da fanfarra, mas
   * descendo em vez de subir: não é hora de comemorar, mas também acabou. */
  empate() {
    [440, 370, 294].forEach((freq, i) => {
      setTimeout(() => tone({ freq, duration: 0.35, volume: 0.14, type: 'sine' }), i * 160);
    });
  },

  /**
   * Explosão: estrondo grave, mais longo quanto maior o raio, e um estalo
   * seco de detritos por cima — só o grave abafa tudo e some rápido na
   * memória; o estalo é o que faz a explosão parecer perto de verdade.
   * `pan` é a posição horizontal de quem está ouvindo (ver `panDe`, em
   * match.js): uma explosão longe na tela some um pouco pro lado certo.
   */
  explosao(raio = 2.4, pan = null) {
    const duracao = Math.min(0.85, 0.3 + raio * 0.12);
    noiseBurst({ duration: duracao, volume: 0.55, filterHz: 220 + raio * 40, pan });
    tone({ freq: 90 + raio * 8, sweepTo: 32, duration: duracao * 0.8, volume: 0.3, type: 'sawtooth', pan });
    noiseBurst({ duration: 0.12, volume: 0.22, filterHz: 2600, type: 'bandpass', pan });
  },

  /** Foguete saindo do cano (bazuca, morteiro, granadas em geral). */
  disparo(pan = null) {
    noiseBurst({ duration: 0.3, volume: 0.3, filterHz: 1100, type: 'highpass', pan });
    tone({ freq: 140, sweepTo: 420, duration: 0.32, volume: 0.14, type: 'sawtooth', pan });
  },

  /** Escopeta: dois estampidos secos e curtos — sem cauda, porque acaba na hora. */
  escopeta(pan = null) {
    noiseBurst({ duration: 0.16, volume: 0.42, filterHz: 1500, type: 'highpass', pan });
    tone({ freq: 180, sweepTo: 70, duration: 0.12, volume: 0.22, type: 'square', pan });
  },

  /** Sniper: estalo agudo e seco, com uma cauda grave longa — o "crack" do
   * tiro de longa distância, bem diferente do estampido curto da escopeta. */
  sniper(pan = null) {
    noiseBurst({ duration: 0.07, volume: 0.5, filterHz: 3200, type: 'highpass', pan });
    tone({ freq: 900, sweepTo: 110, duration: 0.35, volume: 0.16, type: 'sawtooth', pan });
  },

  /** Granada (ou soltável com pavio) batendo no chão. */
  quique(pan = null) {
    tone({ freq: 300, sweepTo: 160, duration: 0.09, volume: 0.14, type: 'square', pan });
  },

  /** Alguém (ou algo) caiu na água. */
  respingo(pan = null) {
    noiseBurst({ duration: 0.45, volume: 0.4, filterHz: 1500, type: 'bandpass', pan });
    tone({ freq: 620, sweepTo: 180, duration: 0.3, volume: 0.12, type: 'sine', pan });
  },

  /** Minhoca levou dano — queda, explosão ou tiro certeiro. */
  ai(pan = null) {
    tone({ freq: 420, sweepTo: 240, duration: 0.14, volume: 0.14, type: 'triangle', pan });
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
  corda(pan = null) {
    noiseBurst({ duration: 0.08, volume: 0.25, filterHz: 2200, type: 'highpass', pan });
    tone({ freq: 500, sweepTo: 700, duration: 0.06, volume: 0.1, type: 'square', pan });
  },

  /** Teleporte — um "warp" subindo rápido. */
  teleporte(pan = null) {
    tone({ freq: 220, sweepTo: 1400, duration: 0.22, volume: 0.16, type: 'sine', pan });
    noiseBurst({ duration: 0.2, volume: 0.15, filterHz: 3000, type: 'highpass', pan });
  },

  /** Passo ao andar — grave e bem baixo, quase subliminar: com uma minhoca
   * andando o turno inteiro, qualquer coisa mais alta cansaria depressa. */
  passo(pan = null) {
    noiseBurst({ duration: 0.06, volume: 0.1, filterHz: 300, type: 'lowpass', pan });
  },

  /** Troca de arma na folha do arsenal — dois cliques mecânicos, tipo um
   * tambor girando, bem diferente do clique fino de botão de menu. */
  trocarArma() {
    tone({ freq: 380, duration: 0.05, volume: 0.1, type: 'square' });
    setTimeout(() => tone({ freq: 560, duration: 0.05, volume: 0.08, type: 'square' }), 40);
  },

  /** Sopro do jetpack — chamado em rajadas curtas enquanto o botão fica
   * segurado (ver `impulsoJetpack`, em match.js), nunca contínuo. */
  jetpack(pan = null) {
    noiseBurst({ duration: 0.14, volume: 0.16, filterHz: 800, type: 'lowpass', pan });
    tone({ freq: 140, sweepTo: 100, duration: 0.14, volume: 0.08, type: 'sawtooth', pan });
  },

  /** A mina passou a valer: um bipe eletrônico simples, único, no instante
   * exato em que ela arma (ver `atualizarProjeteis`, em match.js). */
  minaArma(pan = null) {
    tone({ freq: 900, duration: 0.08, volume: 0.13, type: 'sine', pan });
  },

  /**
   * Tique do pavio, um por segundo inteiro que passa — fica mais agudo
   * conforme `segundosRestantes` encolhe, no mesmo espírito do pisca-pisca
   * visual que já acelera perto do fim (ver `desenharProjetil`).
   */
  pavio(segundosRestantes = 3, pan = null) {
    const freq = 480 + Math.max(0, 4 - segundosRestantes) * 130;
    tone({ freq, duration: 0.06, volume: 0.11, type: 'square', pan });
  },

  /** Clique de interface. */
  click() {
    tone({ freq: 520, duration: 0.06, volume: 0.12, type: 'square' });
  },
};
