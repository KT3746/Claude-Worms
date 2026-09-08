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
import { DT_FISICA } from './ballistics.js';
import { desenharHud, desenharDica } from './ui/hud.js';
import { createScreens } from './ui/screens.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });
const ui = document.getElementById('ui');
const pauseButton = document.getElementById('pause-button');

const camera = createCamera();
const particles = createParticles();
const input = createInput(canvas);

const estado = {
  modo: 'menu', // 'menu' | 'jogando' | 'pausado' | 'fim'
  partida: null,
  ultimaConfig: null,
  motion: true,
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
});

function definirMotion(ligado) {
  estado.motion = ligado;
  camera.shakeEnabled = ligado;
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

  requestAnimationFrame(() => setTimeout(() => {
    const equipes = NOMES_DE_EQUIPE.slice(0, config.equipes).map((nome) => ({
      nome,
      minhocas: config.minhocas,
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
    estado.modo = 'jogando';
    screens.hide();
    pauseButton.hidden = false;
  }, 0));
}

const NOMES_DE_EQUIPE = ['Vermelhos', 'Azuis', 'Verdes', 'Roxos'];

function pausar() {
  if (estado.modo !== 'jogando') return;
  estado.modo = 'pausado';
  pauseButton.hidden = true;
  screens.pause();
}

function retomar() {
  if (estado.modo !== 'pausado') return;
  estado.modo = 'jogando';
  pauseButton.hidden = false;
  screens.hide();
}

function aoMenu() {
  estado.modo = 'menu';
  estado.partida = null;
  particles.clear();
  camera.setBounds(null);
  pauseButton.hidden = true;
  screens.menu();
}

function terminar() {
  const partida = estado.partida;
  estado.modo = 'fim';
  pauseButton.hidden = true;
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

function comandosContinuos(dt) {
  const partida = estado.partida;
  if (!partida) return;
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

  // Espaço e toque carregam a força; soltar dispara.
  if (input.wasPressed('Space')) comandos.carregar();
  if (!input.isDown('Space') && jogo.carregando) comandos.disparar();

  if (input.pointer.justPressed) comandos.carregar();
  if (input.pointer.justReleased) comandos.disparar();
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
    estado.partida.update(dt);
    if (estado.partida.fimDeJogo) terminar();
  },

  render() {
    if (estado.partida) {
      estado.partida.desenhar(ctx);
      if (estado.modo === 'jogando' || estado.modo === 'pausado') {
        desenharHud(ctx, estado.partida, camera);
        if (estado.modo === 'jogando') desenharDica(ctx, estado.partida, camera);
      }
    } else {
      desenharFundoDoMenu();
    }
  },

  endFrame() {
    input.endFrame();
  },
});

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
