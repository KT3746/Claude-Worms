/**
 * Ponto de entrada: liga canvas, entrada, loop, partida e telas.
 */

import { createLoop } from '../engine/loop.js';
import { createInput } from '../engine/input.js';
import { createCamera } from '../engine/camera.js';
import { createParticles } from '../engine/particles.js';
import { save } from '../engine/storage.js';
import { sfx } from '../engine/audio.js';
import { hashSeed, randomSeed } from '../engine/rng.js';

import { createMatch } from './match.js';
import { createAiController } from './ai.js';
import { DT_FISICA } from './ballistics.js';
import { FASE } from './turn.js';
import { desenharHud, desenharDica } from './ui/hud.js';
import { createScreens } from './ui/screens.js';
import { createTouchControls } from './ui/controls.js';
import { NOMES_EQUIPE } from './worm.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });
const ui = document.getElementById('ui');
const touch = document.getElementById('touch');
const pauseButton = document.getElementById('pause-button');

const camera = createCamera();
const particles = createParticles();
const input = createInput(canvas);
/** Um controlador por partida — recriado a cada `iniciarPartida`. */
let ia = null;

const estado = {
  modo: 'menu', // 'menu' | 'jogando' | 'pausado' | 'fim'
  partida: null,
  ultimaConfig: null,
  motion: true,
  /** 'dedo' liga os botões da tela; 'mouse' os esconde. Ver `definirEntrada`. */
  entrada: 'mouse',
};

save.load();
sfx.setEnabled(save.settings.sound);
estado.motion = save.settings.motion !== false;
camera.shakeEnabled = estado.motion;

const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
if (reducedMotion?.matches) definirMotion(false);

const screens = createScreens(ui, {
  jogar: (config) => iniciarPartida(config),
  repetir: () => iniciarPartida(estado.ultimaConfig),
  resume: () => retomar(),
  toMenu: () => aoMenu(),
  setMotion: definirMotion,
  usandoToque: () => estado.entrada === 'dedo',
});

function definirMotion(ligado) {
  estado.motion = ligado;
  camera.shakeEnabled = ligado;
}

// ------------------------------------------------------ dedo ou mouse

const controles = createTouchControls(touch, {
  input,
  acoes: {
    trocarArma: (id) => estado.partida?.comandos.trocarArma(id),
    ajustarPavio: (n) => estado.partida?.comandos.ajustarPavio(n),
  },
});

/**
 * Quem manda é o último ponteiro usado, não o aparelho.
 *
 * `(pointer: coarse)` só serve de palpite inicial, para os botões já estarem
 * lá no primeiro toque. Depois disso cada `pointerdown` decide: num notebook
 * com tela sensível os botões aparecem quando o dedo encosta e somem quando a
 * mão volta para o mouse, sem ninguém precisar configurar nada.
 */
function definirEntrada(tipo) {
  if (tipo !== 'dedo' && tipo !== 'mouse') return;
  if (estado.entrada === tipo) return;
  estado.entrada = tipo;
  sincronizarControles();
}

if (window.matchMedia?.('(pointer: coarse)').matches) estado.entrada = 'dedo';

window.addEventListener('pointerdown', (event) => {
  definirEntrada(event.pointerType === 'mouse' ? 'mouse' : 'dedo');
}, { capture: true });

/** É a vez de um time de IA jogar — ninguém deveria estar tocando em nada. */
function vezDaIA() {
  const partida = estado.partida;
  return partida?.times[partida.estado.equipeDaVez]?.ia === true;
}

/**
 * Os botões da tela só existem durante o jogo, para quem joga no dedo — e
 * somem na vez de um time de IA, senão o polegar aparece livre pra atirar
 * pela minhoca que não é sua.
 */
function sincronizarControles() {
  const querido = estado.entrada === 'dedo' && estado.modo === 'jogando' && !vezDaIA();
  if (querido === controles.visivel) return;
  if (querido) controles.mostrar();
  else controles.esconder();
}

// ------------------------------------------------------------------ tamanho

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  camera.resize(width, height);
}

window.addEventListener('resize', resize);
resize();

// ------------------------------------------------------------ fluxo de jogo

function iniciarPartida(config) {
  const semente = config.semente ? hashSeed(config.semente) : randomSeed();
  estado.ultimaConfig = { ...config };

  // A geração do mapa leva algumas centenas de milissegundos: mostra a tela
  // de espera e só então trava a thread, senão o clique parece não responder.
  screens.carregando();
  pauseButton.hidden = true;
  estado.modo = 'menu';
  sincronizarControles();

  requestAnimationFrame(() => setTimeout(() => {
    const equipes = NOMES_EQUIPE.slice(0, config.equipes).map((nome, i) => ({
      nome,
      minhocas: config.minhocas,
      ia: config.controladores[i] === 'ia',
    }));

    particles.clear();
    estado.partida = createMatch({
      semente,
      equipes,
      camera,
      particles,
      motionEnabled: estado.motion,
      tempoTurno: config.tempoTurno,
    });
    ia = createAiController(estado.partida);
    estado.modo = 'jogando';
    screens.hide();
    pauseButton.hidden = false;
    sincronizarControles();
  }, 0));
}

function pausar() {
  if (estado.modo !== 'jogando') return;
  estado.modo = 'pausado';
  pauseButton.hidden = true;
  sincronizarControles();
  screens.pause();
}

function retomar() {
  if (estado.modo !== 'pausado') return;
  estado.modo = 'jogando';
  pauseButton.hidden = false;
  screens.hide();
  sincronizarControles();
}

function aoMenu() {
  estado.modo = 'menu';
  estado.partida = null;
  sincronizarControles();
  particles.clear();
  camera.setBounds(null);
  pauseButton.hidden = true;
  screens.menu();
}

function terminar() {
  const partida = estado.partida;
  estado.modo = 'fim';
  pauseButton.hidden = true;
  sincronizarControles();
  sfx.fanfare();
  screens.fim({
    vencedor: partida.estado.vencedor,
    semente: partida.estado.semente,
    times: partida.times,
    turnos: partida.turnos.turno,
  });
}

pauseButton.addEventListener('click', () => {
  sfx.click();
  pausar();
});

// --------------------------------------------------------------- entrada

/**
 * Segurar M (ou o botão do mapa, no toque) afasta a câmera até caber o mapa
 * inteiro na tela — só pra olhar, sem mirar nem andar.
 *
 * Precisa vencer `seguirCamera()` (em match.js), que todo quadro volta a
 * mirar a câmera na minhoca ativa. Por isso usa `camera.snap()` — direto,
 * sem suavização — depois que `partida.update()` já rodou: qualquer
 * `lookAt()` daria na mesma, sobrescrito no próximo quadro antes de valer.
 * Soltar a tecla não faz nada por aqui; a própria `seguirCamera()` já traz a
 * câmera de volta, suavemente, no quadro seguinte.
 */
function aplicarVisaoDoMapa() {
  const partida = estado.partida;
  if (!partida || partida.fase !== FASE.JOGANDO) return;
  if (!input.isDown('KeyM')) return;

  const { largura, altura } = partida.terreno;
  const escala = Math.min(camera.width / largura, camera.height / altura) * 0.92;
  camera.snap(largura / 2, altura / 2, escala);
}

function comandosContinuos(dt) {
  const partida = estado.partida;
  if (!partida || vezDaIA()) return;
  const { comandos } = partida;

  if (input.isDown('ArrowLeft') || input.isDown('KeyA')) comandos.andar(-1, dt);
  if (input.isDown('ArrowRight') || input.isDown('KeyD')) comandos.andar(1, dt);

  const fino = input.isDown('ShiftLeft') || input.isDown('ShiftRight') ? 0.25 : 1;
  if (input.isDown('ArrowUp') || input.isDown('KeyW')) comandos.mirar(1.5 * dt * fino);
  if (input.isDown('ArrowDown') || input.isDown('KeyS')) comandos.mirar(-1.5 * dt * fino);

  // O jetpack empurra enquanto Espaço fica segurado — diferente de carregar
  // força, que só acontece ao soltar.
  if (partida.estado.arma.acao === 'jetpack' && input.isDown('Space')) {
    comandos.impulsoJetpack(dt);
  }
}

function comandosDiscretos() {
  if (estado.modo === 'jogando' && input.wasPressed('KeyP')) return pausar();
  if (estado.modo === 'pausado' && input.wasPressed('KeyP')) return retomar();
  if (estado.modo !== 'jogando' || !estado.partida) return;
  // Pausar continua seu, mas mexer na minhoca que está jogando não — é a vez da IA.
  if (vezDaIA()) return;

  const { comandos, estado: jogo } = estado.partida;

  if (input.wasPressed('Enter')) comandos.pular('frente');
  if (input.wasPressed('Backspace')) comandos.pular('costas');

  // `[` `]` percorrem o arsenal inteiro; os dígitos, com uma arma de pavio
  // ajustável na mão (granada, fragmentação), mudam quantos segundos faltam.
  if (input.wasPressed('BracketLeft')) comandos.trocarArmaRelativa(-1);
  if (input.wasPressed('BracketRight')) comandos.trocarArmaRelativa(1);
  if (jogo.arma.ajustavel) {
    for (let n = 1; n <= 5; n += 1) {
      if (input.wasPressed(`Digit${n}`)) comandos.ajustarPavio(n);
    }
  }

  // Espaço (tecla de verdade ou botão FOGO) carrega a força; soltar dispara.
  if (input.wasPressed('Space')) comandos.carregar();
  if (!input.isDown('Space') && jogo.carregando) comandos.disparar();

  // Arrastar pelo campo mira, e só. Atirar continua sendo Espaço ou FOGO.
  //
  // Antes o ponteiro carregava e disparava sozinho: como um clique humano
  // dura uns 80 ms, a carga não saía do piso de 12% e o tiro explodia no pé
  // da própria minhoca, gastando o turno. Mirar é o que o ponteiro faz bem —
  // ele diz um ângulo inteiro de uma vez, coisa que a tecla leva segundos
  // para alcançar —, e ninguém mais perde a vez por um toque errado.
  //
  // As bordas entram junto com o estado contínuo porque um toque rápido pode
  // começar e acabar dentro do mesmo quadro: só olhar para `down` perderia o
  // toque inteiro, e mirar tocando onde se quer acertar é o gesto mais óbvio
  // que existe no dedo.
  const { pointer } = input;
  if (pointer.down || pointer.justPressed || pointer.justReleased) {
    const alvo = camera.toWorld(pointer.x, pointer.y);
    comandos.apontarPara(alvo.x, alvo.y);
  }
}

// ------------------------------------------------------------------- loop

const loop = createLoop({
  dt: DT_FISICA,

  beginFrame() {
    comandosDiscretos();
  },

  step(dt) {
    if (estado.modo !== 'jogando' || !estado.partida) {
      camera.update(dt);
      return;
    }
    comandosContinuos(dt);
    ia.update(dt);
    // A vez muda no meio de uma partida em andamento (não só ao trocar de
    // tela), então é aqui, não só nas transições de modo, que os botões de
    // toque precisam reagir a "agora é a IA que joga".
    sincronizarControles();
    estado.partida.update(dt);
    aplicarVisaoDoMapa();
    if (estado.partida.fimDeJogo) terminar();
  },

  render() {
    if (estado.partida) {
      estado.partida.desenhar(ctx);
      if (estado.modo === 'jogando' || estado.modo === 'pausado') {
        // Com os botões na tela o rodapé do HUD passaria por baixo deles.
        // O texto da dica descreve como VOCÊ jogaria, então segue
        // `estado.entrada` — não `controles.visivel`, que também é `false`
        // na vez da IA mesmo para quem está no dedo (e aí a dica de teclado
        // não faria sentido nenhum). O layout, por outro lado, só precisa
        // desviar do que está ocupando a tela agora.
        const opcoes = { toque: estado.entrada === 'dedo', ...reservaDosControles() };
        desenharHud(ctx, estado.partida, camera, opcoes);
        if (estado.modo === 'jogando') desenharDica(ctx, estado.partida, camera, opcoes);
      }
      controles.atualizar(estado.partida);
    } else {
      desenharFundoDoMenu();
    }
  },

  endFrame() {
    input.endFrame();
  },
});

/**
 * Quanto de tela os botões de toque ocupam, para o HUD desviar deles.
 *
 * Sai do tamanho de verdade dos elementos, e não de constantes repetidas
 * aqui: os botões encolhem com a tela (`--tc` em `vmin`), e uma cópia do
 * número ficaria errada em metade dos aparelhos.
 */
function reservaDosControles() {
  if (!controles.visivel) return { reservaInferior: 0, reservaLateral: 0 };
  const cruz = touch.querySelector('.tc-cruz')?.getBoundingClientRect();
  const direita = touch.querySelector('.tc-direita')?.getBoundingClientRect();
  if (!cruz || !direita) return { reservaInferior: 0, reservaLateral: 0 };
  return {
    reservaInferior: Math.max(cruz.height, direita.height) + 18,
    reservaLateral: Math.max(cruz.width, direita.width) + 18,
  };
}

/** Fundo tranquilo por trás do menu: um morro e o mar. */
let tempoFundo = 0;
function desenharFundoDoMenu() {
  tempoFundo += 1 / 60;
  const g = ctx.createLinearGradient(0, 0, 0, camera.height);
  g.addColorStop(0, '#1d3c63');
  g.addColorStop(0.55, '#4d7ea8');
  g.addColorStop(1, '#9dbfc9');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, camera.width, camera.height);

  const base = camera.height * 0.78;
  ctx.fillStyle = '#3c6b3a';
  ctx.beginPath();
  ctx.moveTo(0, camera.height);
  ctx.lineTo(0, base);
  for (let x = 0; x <= camera.width; x += 10) {
    const y = base
      - Math.sin(x * 0.006 + 1.2) * camera.height * 0.07
      - Math.sin(x * 0.017) * camera.height * 0.03;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(camera.width, camera.height);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = 'rgba(64, 150, 196, 0.5)';
  ctx.beginPath();
  ctx.moveTo(0, camera.height);
  const mar = camera.height * 0.9;
  for (let x = 0; x <= camera.width; x += 8) {
    ctx.lineTo(x, mar + Math.sin(x * 0.02 + tempoFundo * 1.5) * 4);
  }
  ctx.lineTo(camera.width, camera.height);
  ctx.closePath();
  ctx.fill();
}

// Gancho de depuração: dirigir o jogo pelo console sem tocar na arquitetura.
window.__jogo = { estado, camera, iniciarPartida, aoMenu, pausar, retomar };

loop.start();
aoMenu();

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    loop.stop();
    if (estado.modo === 'jogando') pausar();
  } else {
    loop.start();
  }
});
