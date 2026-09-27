/**
 * Som sintetizado com WebAudio — nenhum arquivo de áudio no projeto.
 *
 * Mixagem: todo som passa por um barramento de efeitos com envio para um
 * reverb (resposta ao impulso gerada aqui mesmo, ruído com decaimento
 * exponencial em estéreo) e termina num compressor que "cola" as camadas e
 * segura os picos — é o que deixa uma explosão grande encorpada sem estourar
 * e sem abafar o resto. O ambiente (vento e mar) tem barramento próprio,
 * para poder ser silenciado na pausa sem afetar os efeitos.
 *
 * Cada efeito é montado em camadas curtas (transiente, corpo, cauda), todas
 * agendadas no relógio do próprio contexto de áudio — nada de `setTimeout`,
 * que atrasa quando a aba está ocupada.
 *
 * A variação (tom, tempo dos detritos) usa um gerador próprio, local: o som
 * nunca consome números do `rng` da partida, então ligar ou desligar o som
 * não muda nada do jogo.
 *
 * O contexto só é criado no primeiro gesto do usuário, como exigem os
 * navegadores modernos.
 */

let ctx = null;
let master = null;
let efeitos = null;
let reverbEnvio = null;
let ambienteBus = null;
let ruidoBranco = null;
let ruidoMarrom = null;
let enabled = true;

// Gerador local de variação (xorshift32) — ver nota no topo.
let semente = 0x9e3779b9;
function rnd() {
  semente ^= semente << 13;
  semente ^= semente >>> 17;
  semente ^= semente << 5;
  return ((semente >>> 0) % 1000000) / 1000000;
}
const entre = (a, b) => a + rnd() * (b - a);

function criarRuidos(context) {
  const n = context.sampleRate * 2;
  ruidoBranco = context.createBuffer(1, n, context.sampleRate);
  ruidoMarrom = context.createBuffer(1, n, context.sampleRate);
  const b = ruidoBranco.getChannelData(0);
  const m = ruidoMarrom.getChannelData(0);
  let ultimo = 0;
  for (let i = 0; i < n; i += 1) {
    const w = rnd() * 2 - 1;
    b[i] = w;
    // Ruído "marrom": integral do branco — grave e encorpado, base de
    // estrondo, vento e mar.
    ultimo = (ultimo + 0.02 * w) / 1.02;
    m[i] = ultimo * 3.5;
  }
}

function criarReverb(context) {
  const duracao = 2.2;
  const n = Math.floor(context.sampleRate * duracao);
  const ir = context.createBuffer(2, n, context.sampleRate);
  for (let c = 0; c < 2; c += 1) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < n; i += 1) {
      d[i] = (rnd() * 2 - 1) * Math.pow(1 - i / n, 3.2);
    }
  }
  const conv = context.createConvolver();
  conv.buffer = ir;
  const retorno = context.createGain();
  retorno.gain.value = 0.3;
  conv.connect(retorno).connect(master);
  return conv;
}

function ensure() {
  if (ctx) return ctx;
  // Fora do navegador (testes em Node, por exemplo) `window` nem existe —
  // sem esta guarda, qualquer efeito sonoro derrubava quem chamasse.
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? window.webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 12;
  comp.ratio.value = 5;
  comp.attack.value = 0.003;
  comp.release.value = 0.22;
  comp.connect(ctx.destination);

  master = ctx.createGain();
  master.gain.value = 0.7;
  master.connect(comp);

  efeitos = ctx.createGain();
  efeitos.connect(master);

  ambienteBus = ctx.createGain();
  ambienteBus.gain.value = 1;
  ambienteBus.connect(master);

  criarRuidos(ctx);
  reverbEnvio = criarReverb(ctx);
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
 * Ponto de entrada de uma camada: panorâmica (se houver posição no mundo)
 * e envio para o reverb. `pan` é -1 (esquerda) a 1 (direita); `null` pula o
 * painner para sons sem lugar no mundo (menu, fanfarra, sirene).
 */
function saida(context, pan, rev) {
  const entrada = context.createGain();
  let destino = entrada;
  if (pan != null && typeof context.createStereoPanner === 'function') {
    const panner = context.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    entrada.connect(panner);
    destino = panner;
  }
  destino.connect(efeitos);
  if (rev > 0) {
    const envio = context.createGain();
    envio.gain.value = rev;
    destino.connect(envio).connect(reverbEnvio);
  }
  return entrada;
}

/** Envelope: ataque linear curto até `pico`, depois queda exponencial. */
function envelope(param, t, ataque, duracao, pico) {
  param.setValueAtTime(0.0001, t);
  param.linearRampToValueAtTime(pico, t + ataque);
  param.exponentialRampToValueAtTime(0.0001, t + Math.max(ataque + 0.01, duracao));
}

/** Uma camada de ruído filtrado, com o filtro podendo varrer de f0 a f1. */
function ruido({
  em = 0, dur = 0.2, vol = 0.3, tipo = 'lowpass', f0 = 1200, f1 = null, q = 0.8,
  pan = null, rev = 0.1, marrom = false, ataque = 0.004,
}) {
  const context = ready();
  if (!context) return;
  const t = context.currentTime + em;

  const src = context.createBufferSource();
  src.buffer = marrom ? ruidoMarrom : ruidoBranco;
  src.loop = true;

  const filtro = context.createBiquadFilter();
  filtro.type = tipo;
  filtro.Q.value = q;
  filtro.frequency.setValueAtTime(f0, t);
  if (f1) filtro.frequency.exponentialRampToValueAtTime(f1, t + dur);

  const g = context.createGain();
  envelope(g.gain, t, ataque, dur, vol);

  src.connect(filtro).connect(g).connect(saida(context, pan, rev));
  src.start(t, entre(0, 1.5));
  src.stop(t + dur + 0.05);
}

/** Uma camada tonal, com varredura de altura opcional e filtro passa-baixa. */
function tom({
  em = 0, dur = 0.2, vol = 0.2, tipo = 'sine', f0 = 440, f1 = null, pan = null,
  rev = 0.1, ataque = 0.005, corte = null, detune = 0,
}) {
  const context = ready();
  if (!context) return;
  const t = context.currentTime + em;

  const osc = context.createOscillator();
  osc.type = tipo;
  osc.detune.value = detune;
  osc.frequency.setValueAtTime(f0, t);
  if (f1) osc.frequency.exponentialRampToValueAtTime(f1, t + dur);

  const g = context.createGain();
  envelope(g.gain, t, ataque, dur, vol);

  let no = osc;
  if (corte) {
    const f = context.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = corte;
    osc.connect(f);
    no = f;
  }
  no.connect(g).connect(saida(context, pan, rev));
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

/**
 * Voz de desenho animado: dente de serra passando por dois formantes
 * (filtros passa-banda), com a altura caindo — um "ai!" ou "uou" sem
 * precisar de amostra gravada.
 */
function voz({ em = 0, dur = 0.25, f0 = 440, f1 = 260, formantes = [800, 1800], vol = 0.16, pan = null, rev = 0.12 }) {
  const context = ready();
  if (!context) return;
  const t = context.currentTime + em;

  const osc = context.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(f1, t + dur);

  // Vibrato leve — voz reta demais soa como sirene.
  const lfo = context.createOscillator();
  const lfoGanho = context.createGain();
  lfo.frequency.value = 9;
  lfoGanho.gain.value = f0 * 0.03;
  lfo.connect(lfoGanho).connect(osc.frequency);

  const g = context.createGain();
  envelope(g.gain, t, 0.02, dur, vol);
  const destino = saida(context, pan, rev);

  for (const [i, f] of formantes.entries()) {
    const bp = context.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f;
    bp.Q.value = 6;
    const peso = context.createGain();
    peso.gain.value = i === 0 ? 4.5 : 2.2;
    osc.connect(bp).connect(peso).connect(g);
  }
  g.connect(destino);

  osc.start(t);
  lfo.start(t);
  osc.stop(t + dur + 0.05);
  lfo.stop(t + dur + 0.05);
}

// ------------------------------------------------------------ ambiente

let ambiente = null; // nós do vento e do mar enquanto tocam
// A partida quer ambiente? Guardado à parte para religar se o som for
// ligado no meio da partida (com o som desligado o ambiente nem começa).
let ambienteDesejado = false;
let ultimoVento = 0;

function pararAmbienteAgora() {
  if (!ambiente) return;
  const t = ctx.currentTime;
  for (const n of ambiente.fontes) {
    try { n.stop(t + 0.6); } catch { /* já parado */ }
  }
  ambiente.saida.gain.setTargetAtTime(0, t, 0.15);
  ambiente = null;
}

// ---------------------------------------------------------------- carga

let carga = null; // { osc, sub, filtro, ganho }

export const sfx = {
  setEnabled(value) {
    enabled = value;
    if (!ctx) return;
    // Silencia (ou devolve) o que fica tocando sozinho: ambiente e carga.
    const t = ctx.currentTime;
    master.gain.setTargetAtTime(value ? 0.7 : 0, t, 0.05);
    if (value && ambienteDesejado && !ambiente) {
      sfx.ambienteIniciar();
      sfx.ambienteVento(ultimoVento);
    }
  },

  get enabled() {
    return enabled;
  },

  // -------------------------------------------------------- ambiente

  /** Liga o vento e o mar de fundo. Idempotente. */
  ambienteIniciar() {
    ambienteDesejado = true;
    const context = ready();
    if (!context || ambiente) return;
    const t = context.currentTime;

    const saidaAmb = context.createGain();
    saidaAmb.gain.setValueAtTime(0, t);
    saidaAmb.gain.linearRampToValueAtTime(1, t + 1.5);
    saidaAmb.connect(ambienteBus);

    // Vento: ruído branco num passa-banda, com rajadas lentas (LFO no volume).
    const ventoSrc = context.createBufferSource();
    ventoSrc.buffer = ruidoBranco;
    ventoSrc.loop = true;
    const ventoFiltro = context.createBiquadFilter();
    ventoFiltro.type = 'bandpass';
    ventoFiltro.frequency.value = 500;
    ventoFiltro.Q.value = 0.9;
    const ventoGanho = context.createGain();
    ventoGanho.gain.value = 0.02;
    const ventoPan = typeof context.createStereoPanner === 'function' ? context.createStereoPanner() : context.createGain();
    const rajada = context.createOscillator();
    rajada.frequency.value = 0.17;
    const rajadaGanho = context.createGain();
    rajadaGanho.gain.value = 0.01;
    rajada.connect(rajadaGanho).connect(ventoGanho.gain);
    ventoSrc.connect(ventoFiltro).connect(ventoGanho).connect(ventoPan).connect(saidaAmb);

    // Mar: ruído marrom num passa-baixa, "respirando" bem devagar.
    const marSrc = context.createBufferSource();
    marSrc.buffer = ruidoMarrom;
    marSrc.loop = true;
    const marFiltro = context.createBiquadFilter();
    marFiltro.type = 'lowpass';
    marFiltro.frequency.value = 380;
    const marGanho = context.createGain();
    marGanho.gain.value = 0.05;
    const onda = context.createOscillator();
    onda.frequency.value = 0.09;
    const ondaGanho = context.createGain();
    ondaGanho.gain.value = 0.03;
    onda.connect(ondaGanho).connect(marGanho.gain);
    marSrc.connect(marFiltro).connect(marGanho).connect(saidaAmb);

    for (const n of [ventoSrc, rajada, marSrc, onda]) n.start(t);
    ambiente = {
      saida: saidaAmb,
      fontes: [ventoSrc, rajada, marSrc, onda],
      ventoFiltro, ventoGanho, ventoPan, rajadaGanho,
    };
  },

  /** O vento do turno muda o som: mais forte = mais alto, mais agudo e mais de lado. */
  ambienteVento(vento) {
    ultimoVento = vento;
    if (!ambiente || !ctx) return;
    const t = ctx.currentTime;
    const f = Math.min(1, Math.abs(vento) / 9);
    ambiente.ventoGanho.gain.setTargetAtTime(0.012 + f * 0.05, t, 0.8);
    ambiente.rajadaGanho.gain.setTargetAtTime(0.006 + f * 0.03, t, 0.8);
    ambiente.ventoFiltro.frequency.setTargetAtTime(380 + f * 700, t, 0.8);
    if (ambiente.ventoPan.pan) ambiente.ventoPan.pan.setTargetAtTime(Math.sign(vento) * f * 0.5, t, 0.8);
  },

  /** Abaixa o ambiente (pausa) ou devolve. */
  ambienteAbafar(abafar) {
    if (!ctx || !ambienteBus) return;
    ambienteBus.gain.setTargetAtTime(abafar ? 0.15 : 1, ctx.currentTime, 0.2);
  },

  ambienteParar() {
    ambienteDesejado = false;
    if (ctx) pararAmbienteAgora();
    sfx.cargaParar();
  },

  // ----------------------------------------------------------- carga

  /** Zumbido que sobe enquanto a força do tiro carrega. */
  cargaIniciar() {
    const context = ready();
    if (!context || carga) return;
    const t = context.currentTime;
    const osc = context.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 140;
    const sub = context.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = 70;
    const filtro = context.createBiquadFilter();
    filtro.type = 'lowpass';
    filtro.frequency.value = 400;
    filtro.Q.value = 4;
    const ganho = context.createGain();
    ganho.gain.setValueAtTime(0.0001, t);
    ganho.gain.linearRampToValueAtTime(0.07, t + 0.05);
    osc.connect(filtro);
    sub.connect(filtro);
    filtro.connect(ganho).connect(saida(context, null, 0.05));
    osc.start(t);
    sub.start(t);
    carga = { osc, sub, filtro, ganho };
  },

  cargaNivel(nivel) {
    if (!carga || !ctx) return;
    const t = ctx.currentTime;
    carga.osc.frequency.setTargetAtTime(140 + nivel * 420, t, 0.03);
    carga.sub.frequency.setTargetAtTime(70 + nivel * 210, t, 0.03);
    carga.filtro.frequency.setTargetAtTime(400 + nivel * 2600, t, 0.03);
  },

  cargaParar() {
    if (!carga || !ctx) return;
    const t = ctx.currentTime;
    carga.ganho.gain.setTargetAtTime(0.0001, t, 0.02);
    carga.osc.stop(t + 0.15);
    carga.sub.stop(t + 0.15);
    carga = null;
  },

  // ---------------------------------------------------------- música

  /** Fim de partida com um time em pé: metais sintéticos, arpejo e acorde. */
  fanfare() {
    const notas = [523.25, 659.25, 783.99];
    notas.forEach((f, i) => {
      tom({ em: i * 0.13, dur: 0.22, vol: 0.12, tipo: 'sawtooth', f0: f, corte: 2200, rev: 0.35 });
      tom({ em: i * 0.13, dur: 0.22, vol: 0.08, tipo: 'sawtooth', f0: f, corte: 2200, rev: 0.35, detune: 9 });
    });
    for (const f of [523.25, 659.25, 783.99, 1046.5]) {
      tom({ em: 0.42, dur: 1.4, vol: 0.07, tipo: 'sawtooth', f0: f, corte: 1800, rev: 0.5, ataque: 0.04 });
      tom({ em: 0.42, dur: 1.4, vol: 0.05, tipo: 'sawtooth', f0: f, corte: 1800, rev: 0.5, ataque: 0.04, detune: -8 });
    }
    tom({ em: 0.42, dur: 1.6, vol: 0.14, tipo: 'sine', f0: 130.8, rev: 0.3, ataque: 0.03 });
    ruido({ em: 0.42, dur: 1.2, vol: 0.05, tipo: 'highpass', f0: 7000, rev: 0.6, ataque: 0.01 });
  },

  /** Fim de partida sem ninguém em pé — acorde menor descendo, sem festa. */
  empate() {
    [440, 369.99, 293.66].forEach((f, i) => {
      tom({ em: i * 0.2, dur: 0.5, vol: 0.1, tipo: 'triangle', f0: f, rev: 0.45 });
    });
    for (const f of [293.66, 349.23, 440]) {
      tom({ em: 0.65, dur: 1.5, vol: 0.06, tipo: 'sawtooth', f0: f, corte: 900, rev: 0.5, ataque: 0.08 });
    }
  },

  // -------------------------------------------------------- impactos

  /**
   * Explosão em cinco camadas: estalo (transiente), dois golpes graves
   * (sub), corpo de ruído marrom com o filtro fechando, cauda de ronco com
   * muito reverb e uma chuva de detritos caindo depois. Tudo escala com o
   * raio. `pan` é a posição horizontal na tela (ver `panDe` em match.js).
   */
  explosao(raio = 2.4, pan = null) {
    const r = Math.max(0.4, Math.min(2.2, raio / 2.4));
    ruido({ dur: 0.07, vol: 0.55, tipo: 'highpass', f0: 1600, pan, rev: 0.2, ataque: 0.001 });
    tom({ dur: 0.45 + r * 0.3, vol: 0.75, tipo: 'sine', f0: 105, f1: 30, pan, rev: 0.1, ataque: 0.002 });
    tom({ dur: 0.25, vol: 0.4, tipo: 'triangle', f0: 70, f1: 28, pan, rev: 0.05, ataque: 0.002 });
    ruido({ dur: 0.6 + r * 0.45, vol: 0.9, marrom: true, tipo: 'lowpass', f0: 3200, f1: 140, q: 0.6, pan, rev: 0.35, ataque: 0.003 });
    ruido({ em: 0.05, dur: 1.3 + r * 0.9, vol: 0.32 * r, marrom: true, tipo: 'lowpass', f0: 260, q: 0.5, pan, rev: 0.6, ataque: 0.08 });
    const detritos = Math.round(5 + r * 6);
    for (let i = 0; i < detritos; i += 1) {
      const p = pan == null ? null : Math.max(-1, Math.min(1, pan + entre(-0.35, 0.35)));
      ruido({
        em: entre(0.18, 0.5 + r * 0.7), dur: entre(0.02, 0.06), vol: entre(0.04, 0.12),
        tipo: 'bandpass', f0: entre(1500, 5200), q: 2, pan: p, rev: 0.15, ataque: 0.001,
      });
    }
  },

  /** Disparo da bazuca/morteiro: baque grave e o chiado do foguete saindo. */
  disparo(pan = null) {
    tom({ dur: 0.2, vol: 0.45, tipo: 'sine', f0: 160, f1: 48, pan, rev: 0.1, ataque: 0.002 });
    ruido({ dur: 0.06, vol: 0.3, tipo: 'highpass', f0: 2000, pan, rev: 0.15, ataque: 0.001 });
    ruido({ dur: 0.45, vol: 0.28, tipo: 'bandpass', f0: 700, f1: 2600, q: 1.4, pan, rev: 0.25, ataque: 0.02 });
  },

  /** Escopeta: estalo, estrondo curto e o "trec-trec" da bomba recarregando. */
  escopeta(pan = null) {
    ruido({ dur: 0.05, vol: 0.6, tipo: 'highpass', f0: 1800, pan, rev: 0.3, ataque: 0.001 });
    tom({ dur: 0.3, vol: 0.55, tipo: 'sine', f0: 130, f1: 40, pan, rev: 0.2, ataque: 0.002 });
    ruido({ dur: 0.28, vol: 0.5, marrom: true, tipo: 'lowpass', f0: 2600, f1: 380, pan, rev: 0.45 });
    ruido({ em: 0.42, dur: 0.035, vol: 0.18, tipo: 'bandpass', f0: 2800, q: 3, pan, rev: 0.05, ataque: 0.001 });
    ruido({ em: 0.55, dur: 0.045, vol: 0.2, tipo: 'bandpass', f0: 1700, q: 3, pan, rev: 0.05, ataque: 0.001 });
  },

  /** Sniper: estalo seco e agudo com um eco longo rolando pelo mapa. */
  sniper(pan = null) {
    ruido({ dur: 0.03, vol: 0.75, tipo: 'highpass', f0: 3200, pan, rev: 0.6, ataque: 0.0005 });
    ruido({ dur: 0.16, vol: 0.45, tipo: 'lowpass', f0: 4500, f1: 600, pan, rev: 0.7 });
    tom({ dur: 0.22, vol: 0.4, tipo: 'sine', f0: 190, f1: 50, pan, rev: 0.3, ataque: 0.001 });
    ruido({ em: 0.25, dur: 0.9, vol: 0.08, marrom: true, tipo: 'lowpass', f0: 500, pan, rev: 0.8, ataque: 0.05 });
  },

  /** Granada quicando: batida metálica curta, com partes inarmônicas. */
  quique(pan = null) {
    const f = entre(420, 620);
    tom({ dur: 0.12, vol: 0.3, tipo: 'triangle', f0: f, pan, rev: 0.12, ataque: 0.001 });
    tom({ dur: 0.08, vol: 0.15, tipo: 'sine', f0: f * 2.76, pan, rev: 0.12, ataque: 0.001 });
    ruido({ dur: 0.03, vol: 0.12, tipo: 'bandpass', f0: 1400, q: 1.5, pan, rev: 0.05, ataque: 0.001 });
  },

  /** Algo caiu na água: o tapa na superfície e bolhas subindo. */
  respingo(pan = null) {
    ruido({ dur: 0.08, vol: 0.4, tipo: 'highpass', f0: 1500, pan, rev: 0.2, ataque: 0.001 });
    ruido({ dur: 0.55, vol: 0.45, tipo: 'bandpass', f0: 1600, f1: 350, q: 1, pan, rev: 0.3 });
    for (let i = 0; i < 6; i += 1) {
      const f = entre(350, 800);
      tom({ em: entre(0.1, 0.7), dur: 0.06, vol: 0.06, tipo: 'sine', f0: f, f1: f * 2.2, pan, rev: 0.2, ataque: 0.003 });
    }
  },

  /** Minhoca levou dano: um "ai!" de desenho animado, com altura variando. */
  ai(pan = null) {
    const f = entre(360, 540);
    voz({ dur: entre(0.18, 0.26), f0: f, f1: f * 0.62, formantes: [entre(700, 950), 2100], vol: 0.4, pan });
    ruido({ dur: 0.05, vol: 0.12, tipo: 'lowpass', f0: 900, pan, rev: 0.05 });
  },

  /** A minhoca chegou a zero: um "uou-uou" descendo, antes da explosão. */
  morte(pan = null) {
    voz({ dur: 0.28, f0: 480, f1: 360, formantes: [650, 1100], vol: 0.15, pan, rev: 0.25 });
    voz({ em: 0.3, dur: 0.5, f0: 360, f1: 150, formantes: [600, 1000], vol: 0.15, pan, rev: 0.3 });
  },

  /** Sirene da morte súbita: sobe e desce duas vezes, com eco. */
  sirene() {
    for (let i = 0; i < 2; i += 1) {
      tom({ em: i * 1.1, dur: 0.55, vol: 0.1, tipo: 'sawtooth', f0: 320, f1: 760, corte: 1800, rev: 0.4, ataque: 0.03 });
      tom({ em: i * 1.1 + 0.55, dur: 0.55, vol: 0.1, tipo: 'sawtooth', f0: 760, f1: 320, corte: 1800, rev: 0.4, ataque: 0.01 });
    }
  },

  /** Passa a vez: duas notas de marimba (fundamental + parcial agudo que some rápido). */
  vez() {
    for (const [i, f] of [659.25, 987.77].entries()) {
      tom({ em: i * 0.1, dur: 0.45, vol: 0.14, tipo: 'sine', f0: f, rev: 0.3, ataque: 0.002 });
      tom({ em: i * 0.1, dur: 0.08, vol: 0.05, tipo: 'sine', f0: f * 3.9, rev: 0.2, ataque: 0.001 });
    }
  },

  /** Tique dos últimos segundos do relógio — mais agudo no final. */
  relogio(segundos = 5) {
    const f = segundos <= 3 ? 1500 : 1100;
    tom({ dur: 0.05, vol: segundos <= 3 ? 0.3 : 0.2, tipo: 'sine', f0: f, rev: 0.1, ataque: 0.001 });
    ruido({ dur: 0.02, vol: 0.05, tipo: 'bandpass', f0: 3000, q: 2, rev: 0, ataque: 0.001 });
  },

  /** Corda ninja: "fiu" do gancho voando e o estalo de quando prende. */
  corda(pan = null) {
    ruido({ dur: 0.12, vol: 0.22, tipo: 'bandpass', f0: 4000, f1: 1200, q: 2, pan, rev: 0.1 });
    tom({ em: 0.06, dur: 0.3, vol: 0.1, tipo: 'triangle', f0: 330, f1: 290, pan, rev: 0.15, ataque: 0.001 });
    ruido({ em: 0.06, dur: 0.03, vol: 0.2, tipo: 'highpass', f0: 2500, pan, rev: 0.1, ataque: 0.001 });
  },

  /** Ataque aéreo chamado: motor de hélice passando, com efeito Doppler. */
  aviao(pan = null) {
    tom({ dur: 2.4, vol: 0.12, tipo: 'sawtooth', f0: 125, f1: 92, corte: 900, pan, rev: 0.3, ataque: 0.6 });
    tom({ dur: 2.4, vol: 0.1, tipo: 'sawtooth', f0: 128, f1: 94, corte: 900, pan, rev: 0.3, ataque: 0.6 });
    ruido({ dur: 2.4, vol: 0.12, marrom: true, tipo: 'lowpass', f0: 700, f1: 300, pan, rev: 0.3, ataque: 0.6 });
  },

  /** Teleporte: arpejo brilhante subindo por cima de uma varredura. */
  teleporte(pan = null) {
    tom({ dur: 0.3, vol: 0.12, tipo: 'sine', f0: 260, f1: 2200, pan, rev: 0.4 });
    [880, 1108.7, 1318.5, 1760].forEach((f, i) => {
      tom({ em: i * 0.045, dur: 0.18, vol: 0.06, tipo: 'triangle', f0: f, pan, rev: 0.5, ataque: 0.002 });
    });
    ruido({ dur: 0.3, vol: 0.08, tipo: 'highpass', f0: 5000, pan, rev: 0.4 });
  },

  /** Passo: terra sendo pisada, bem baixinho e com altura variando. */
  passo(pan = null) {
    ruido({ dur: 0.07, vol: 0.5, tipo: 'lowpass', f0: entre(380, 620), pan, rev: 0.02 });
  },

  /** Troca de arma: dois cliques mecânicos, tipo um tambor girando. */
  trocarArma() {
    ruido({ dur: 0.025, vol: 0.35, tipo: 'bandpass', f0: 2600, q: 3, rev: 0.05, ataque: 0.001 });
    tom({ dur: 0.04, vol: 0.06, tipo: 'square', f0: 320, corte: 1500, rev: 0.05, ataque: 0.001 });
    ruido({ em: 0.06, dur: 0.03, vol: 0.3, tipo: 'bandpass', f0: 1800, q: 3, rev: 0.05, ataque: 0.001 });
  },

  /** Jetpack: ronco de chama em rajadas curtas. */
  jetpack(pan = null) {
    ruido({ dur: 0.17, vol: 0.5, marrom: true, tipo: 'lowpass', f0: 1100, pan, rev: 0.1, ataque: 0.01 });
    ruido({ dur: 0.12, vol: 0.06, tipo: 'bandpass', f0: 2400, q: 1, pan, rev: 0.05, ataque: 0.01 });
  },

  /** A mina armou: bipe eletrônico duplo. */
  minaArma(pan = null) {
    tom({ dur: 0.07, vol: 0.1, tipo: 'square', f0: 1250, corte: 3000, pan, rev: 0.15, ataque: 0.001 });
    tom({ em: 0.1, dur: 0.07, vol: 0.1, tipo: 'square', f0: 1650, corte: 3000, pan, rev: 0.15, ataque: 0.001 });
  },

  /** Tique do pavio, mais agudo conforme `segundosRestantes` encolhe. */
  pavio(segundosRestantes = 3, pan = null) {
    const f = 700 + Math.max(0, 4 - segundosRestantes) * 180;
    tom({ dur: 0.05, vol: 0.25, tipo: 'triangle', f0: f, pan, rev: 0.08, ataque: 0.001 });
    ruido({ dur: 0.04, vol: 0.05, tipo: 'highpass', f0: 6000, pan, rev: 0, ataque: 0.001 });
  },

  /** Pegou uma caixa de vida: arpejo brilhante e um brilho por cima. */
  caixa(pan = null) {
    [1046.5, 1318.5, 1568, 2093].forEach((f, i) => {
      tom({ em: i * 0.06, dur: 0.25, vol: 0.09, tipo: 'triangle', f0: f, pan, rev: 0.4, ataque: 0.002 });
    });
    ruido({ dur: 0.4, vol: 0.05, tipo: 'highpass', f0: 7000, pan, rev: 0.5, ataque: 0.02 });
  },

  /** Paraquedas abrindo: pano batendo, três "flaps" rápidos. */
  paraquedas(pan = null) {
    for (let i = 0; i < 3; i += 1) {
      ruido({ em: i * 0.07, dur: 0.06, vol: 0.45 - i * 0.1, tipo: 'bandpass', f0: 650, q: 1.2, pan, rev: 0.2, ataque: 0.004 });
    }
  },

  /** Clique de interface. */
  click() {
    tom({ dur: 0.05, vol: 0.18, tipo: 'sine', f0: 880, rev: 0.03, ataque: 0.001 });
    ruido({ dur: 0.015, vol: 0.05, tipo: 'bandpass', f0: 4000, q: 2, rev: 0, ataque: 0.001 });
  },
};
