/**
 * O adversário de IA (`js/minhocas/ai.js`): escolha de alvo, validade de um
 * tiro hitscan (linha de visão), a busca de arco que mira bazuca/morteiro/
 * granada/fragmentação, e o controlador que costura tudo por quadro.
 *
 * As três primeiras são funções puras testadas com um terreno de mentira
 * (chão plano + um obstáculo opcional) — não precisam de `createMatch` nem
 * do gerador de mapa de verdade. O controlador precisa de uma partida real
 * (ele fala com ela pelos mesmos `comandos` que um jogador usaria), então
 * os dois últimos testes rodam `createMatch` de ponta a ponta.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  escolherAlvo,
  tiroHitscanValido,
  buscarTiroArco,
  planejarTurno,
  createAiController,
} from '../js/minhocas/ai.js';
import { createMatch } from '../js/minhocas/match.js';
import { armaPorId } from '../js/minhocas/weapons.js';
import { GRAVIDADE, ARRASTO, DT_FISICA } from '../js/minhocas/ballistics.js';
import { FASE } from '../js/minhocas/turn.js';
import { createRng } from '../js/engine/rng.js';

/** Chão plano em y=0, com um obstáculo retangular opcional entre x0 e x1. */
function terrenoDeTeste({ obstaculo } = {}) {
  function solidoEm(x, y) {
    if (y < 0) return true;
    if (obstaculo && x > obstaculo.x0 && x < obstaculo.x1 && y < obstaculo.altura) return true;
    return false;
  }
  return {
    solidoEm,
    // Um raycast por amostragem — mais simples que o de verdade
    // (`terrain.js` usa uma máscara de bits), mas com a mesma forma:
    // primeiro ponto sólido do segmento, com `t` em [0,1].
    raio(x0, y0, x1, y1) {
      const passos = 400;
      for (let i = 1; i <= passos; i += 1) {
        const t = i / passos;
        const x = x0 + (x1 - x0) * t;
        const y = y0 + (y1 - y0) * t;
        if (solidoEm(x, y)) return { x, y, t };
      }
      return null;
    },
  };
}

function worm(x, y, { equipe = 1, vida = 100, vivo = true, nome = 'W' } = {}) {
  return { x, y, equipe, vida, vivo, nome };
}

// --------------------------------------------------------------- escolherAlvo

test('escolherAlvo ignora aliados e minhocas mortas', () => {
  const atacante = worm(0, 1, { equipe: 0 });
  const aliado = worm(1, 1, { equipe: 0, nome: 'Aliado' });
  const inimigoMorto = worm(2, 1, { equipe: 1, vivo: false, nome: 'Morto' });
  const inimigo = worm(10, 1, { equipe: 1, nome: 'Inimigo' });

  const alvo = escolherAlvo([atacante, aliado, inimigoMorto, inimigo], atacante);
  assert.equal(alvo.nome, 'Inimigo');
});

test('escolherAlvo prefere o inimigo mais perto', () => {
  const atacante = worm(0, 1, { equipe: 0 });
  const perto = worm(5, 1, { equipe: 1, nome: 'Perto' });
  const longe = worm(50, 1, { equipe: 1, nome: 'Longe' });

  assert.equal(escolherAlvo([atacante, perto, longe], atacante).nome, 'Perto');
});

test('entre dois igualmente perto, escolherAlvo prefere quem já está mais machucado', () => {
  const atacante = worm(0, 1, { equipe: 0 });
  const saudavel = worm(10, 1, { equipe: 1, vida: 100, nome: 'Saudável' });
  const machucado = worm(-10, 1, { equipe: 1, vida: 20, nome: 'Machucado' });

  assert.equal(escolherAlvo([atacante, saudavel, machucado], atacante).nome, 'Machucado');
});

test('sem nenhum inimigo vivo, escolherAlvo devolve null', () => {
  const atacante = worm(0, 1, { equipe: 0 });
  const aliado = worm(5, 1, { equipe: 0, nome: 'Aliado' });
  assert.equal(escolherAlvo([atacante, aliado], atacante), null);
});

// ----------------------------------------------------------- tiroHitscanValido

test('tiroHitscanValido acerta com linha de visão livre', () => {
  const terreno = terrenoDeTeste();
  const atacante = worm(0, 1, { equipe: 0 });
  const alvo = worm(20, 1, { equipe: 1 });
  const sniper = armaPorId('sniper');

  const tiro = tiroHitscanValido(sniper, { x: 0, y: 1 }, alvo, terreno, [atacante, alvo], atacante);

  assert.ok(tiro, 'linha livre, dentro do alcance: deveria achar o tiro');
  assert.equal(tiro.direcao, 1);
  assert.ok(Math.abs(tiro.angulo) < 0.05, `quase reto, veio ${tiro.angulo}`);
});

test('tiroHitscanValido não atravessa terreno no meio do caminho', () => {
  const terreno = terrenoDeTeste({ obstaculo: { x0: 8, x1: 9, altura: 5 } });
  const atacante = worm(0, 1, { equipe: 0 });
  const alvo = worm(20, 1, { equipe: 1 });
  const sniper = armaPorId('sniper');

  assert.equal(
    tiroHitscanValido(sniper, { x: 0, y: 1 }, alvo, terreno, [atacante, alvo], atacante),
    null,
  );
});

test('tiroHitscanValido não atira através de um aliado no caminho', () => {
  const terreno = terrenoDeTeste();
  const atacante = worm(0, 1, { equipe: 0 });
  const aliado = worm(10, 1, { equipe: 0, nome: 'Aliado' }); // entre o atacante e o alvo
  const alvo = worm(20, 1, { equipe: 1 });
  const sniper = armaPorId('sniper');

  assert.equal(
    tiroHitscanValido(sniper, { x: 0, y: 1 }, alvo, terreno, [atacante, aliado, alvo], atacante),
    null,
  );
});

test('tiroHitscanValido recusa alvo fora do alcance da arma', () => {
  const terreno = terrenoDeTeste();
  const atacante = worm(0, 1, { equipe: 0 });
  const alvo = worm(200, 1, { equipe: 1 }); // muito além dos 70 m do sniper
  const sniper = armaPorId('sniper');

  assert.equal(
    tiroHitscanValido(sniper, { x: 0, y: 1 }, alvo, terreno, [atacante, alvo], atacante),
    null,
  );
});

// ------------------------------------------------------------- buscarTiroArco

test('buscarTiroArco acha uma trajetória que cai perto do alvo', () => {
  const terreno = terrenoDeTeste();
  const atacante = worm(0, 1, { equipe: 0 });
  const alvo = worm(20, 1, { equipe: 1 });
  const bazuca = armaPorId('bazuca');
  const ambiente = { gravidade: GRAVIDADE, arrasto: ARRASTO, vento: 0 };

  const tiro = buscarTiroArco({
    atacante, arma: bazuca, alvoPos: { x: alvo.x, y: alvo.y },
    ambiente, terreno, todas: [atacante, alvo],
  });

  assert.ok(tiro.impacto, 'deveria ter encontrado onde o tiro cai');
  const erro = Math.hypot(tiro.impacto.x - alvo.x, tiro.impacto.y - alvo.y);
  // O raio de explosão da bazuca é 2,4 m — bem mais que a folga da busca.
  assert.ok(erro < 1.5, `caiu a ${erro.toFixed(2)} m do alvo, esperava bem menos que o raio da explosão`);
  assert.equal(tiro.direcao, 1);
});

test('buscarTiroArco pontua pior quando o melhor impacto cairia perto de um aliado', () => {
  const terreno = terrenoDeTeste();
  const atacante = worm(0, 1, { equipe: 0 });
  const alvo = worm(20, 1, { equipe: 1 });
  const aliadoNoAlvo = worm(20, 1, { equipe: 0, nome: 'Aliado' }); // bem em cima do ponto ideal
  const bazuca = armaPorId('bazuca');
  const ambiente = { gravidade: GRAVIDADE, arrasto: ARRASTO, vento: 0 };
  const args = { atacante, arma: bazuca, alvoPos: { x: alvo.x, y: alvo.y }, ambiente, terreno };

  const semAliado = buscarTiroArco({ ...args, todas: [atacante, alvo] });
  const comAliado = buscarTiroArco({ ...args, todas: [atacante, alvo, aliadoNoAlvo] });

  assert.ok(
    comAliado.pontuacao > semAliado.pontuacao,
    `fogo amigo devia piorar a pontuação (sem: ${semAliado.pontuacao.toFixed(2)}, com: ${comAliado.pontuacao.toFixed(2)})`,
  );
});

// --------------------------------------------------------------- planejarTurno

function partidaFalsa({ atacante, alvo, terreno, vento = 0 }) {
  return {
    estado: { ativa: atacante, vento },
    terreno,
    todas: [atacante, alvo],
    rng: createRng(1),
  };
}

test('planejarTurno prefere um hitscan certeiro a um arco impreciso, com linha livre', () => {
  const terreno = terrenoDeTeste();
  const atacante = worm(0, 1, { equipe: 0 });
  const alvo = worm(20, 1, { equipe: 1 });

  const plano = planejarTurno(partidaFalsa({ atacante, alvo, terreno }));

  assert.ok(plano);
  assert.equal(plano.instantaneo, true);
  assert.ok(['escopeta', 'sniper'].includes(plano.armaId), `esperava hitscan, veio ${plano.armaId}`);
});

test('planejarTurno cai para uma arma de arco quando a linha reta está bloqueada', () => {
  const terreno = terrenoDeTeste({ obstaculo: { x0: 8, x1: 9, altura: 5 } });
  const atacante = worm(0, 1, { equipe: 0 });
  const alvo = worm(20, 1, { equipe: 1 });

  const plano = planejarTurno(partidaFalsa({ atacante, alvo, terreno }));

  assert.ok(plano);
  assert.equal(plano.instantaneo, false);
  assert.ok(['bazuca', 'morteiro', 'granada', 'fragmentacao'].includes(plano.armaId));
  assert.ok(Number.isFinite(plano.angulo) && Number.isFinite(plano.poder));
  assert.ok(plano.poder >= 0.1 && plano.poder <= 1);
});

test('planejarTurno devolve null sem nenhum inimigo vivo', () => {
  const terreno = terrenoDeTeste();
  const atacante = worm(0, 1, { equipe: 0 });
  const aliado = worm(5, 1, { equipe: 0, nome: 'Aliado' });
  const plano = planejarTurno({
    estado: { ativa: atacante, vento: 0 },
    terreno,
    todas: [atacante, aliado],
    rng: createRng(1),
  });
  assert.equal(plano, null);
});

// ------------------------------------------------------- createAiController

function criarCameraFalsa() {
  return {
    x: 0, y: 0, scale: 20, width: 800, height: 450,
    setBounds() {}, lookAt() {}, addShake() {}, update() {},
    toScreen: (x, y) => ({ x, y }),
    get halfWidth() { return this.width / 2 / this.scale; },
    get halfHeight() { return this.height / 2 / this.scale; },
  };
}

function partidaIA(overrides = {}) {
  return createMatch({
    semente: 3,
    equipes: [
      { nome: 'Vermelhos', minhocas: 1, ia: true },
      { nome: 'Azuis', minhocas: 1, ia: true },
    ],
    camera: criarCameraFalsa(),
    particles: { spawn() {}, update() {}, draw() {}, clear() {} },
    tempoTurno: 45,
    ...overrides,
  });
}

test('createAiController joga uma partida inteira sozinho, sem travar', () => {
  const partida = partidaIA();
  const ai = createAiController(partida);

  let passos = 0;
  const MAX_PASSOS = 120 * 300; // ~300 s simulados — folga sobre o observado (~170 s, semente 3)
  while (partida.fase !== FASE.FIM && passos < MAX_PASSOS) {
    ai.update(DT_FISICA);
    partida.update(DT_FISICA);
    passos += 1;
  }

  assert.equal(partida.fase, FASE.FIM, `não terminou em ${passos} passos`);
  assert.ok(partida.estado.vencedor, 'deveria ter um time vencedor');
});

/**
 * A regressão que importa de verdade: duas minhocas nascem a ~100 m uma da
 * outra neste mapa/semente — bem além do alcance de qualquer arma do
 * arsenal (o sniper, o mais longo, chega a 70 m). Antes de `createAiController`
 * saber andar para se aproximar, as duas simplesmente erravam para sempre e
 * a partida nunca chegava a FIM — descoberto rodando este exato cenário por
 * várias centenas de turnos sem que a fase saísse do lugar.
 */
test('createAiController anda para se aproximar quando o alvo está fora de alcance', () => {
  const partida = partidaIA({ semente: 1 });
  const [a, b] = partida.todas;
  const distanciaInicial = Math.hypot(a.x - b.x, a.y - b.y);
  assert.ok(distanciaInicial > 70, `pré-condição do teste: esperava >70 m, veio ${distanciaInicial.toFixed(1)}`);

  const ai = createAiController(partida);
  let passos = 0;
  const MAX_PASSOS = 120 * 900; // ~900 s — a partida real levou ~220 s neste cenário
  while (partida.fase !== FASE.FIM && passos < MAX_PASSOS) {
    ai.update(DT_FISICA);
    partida.update(DT_FISICA);
    passos += 1;
  }

  assert.equal(partida.fase, FASE.FIM, `não terminou em ${passos} passos — a IA travou sem se aproximar?`);
});

test('createAiController nunca mexe na minhoca de um time humano', () => {
  const partida = partidaIA({
    semente: 3,
    equipes: [
      { nome: 'Vermelhos', minhocas: 1, ia: false },
      { nome: 'Azuis', minhocas: 1, ia: true },
    ],
  });
  const ai = createAiController(partida);

  // Corre alguns segundos com o time humano na vez (turno 0) sem que nada
  // pareça um jogador jogando por ele.
  for (let i = 0; i < 120 * 3; i += 1) {
    ai.update(DT_FISICA);
    partida.update(DT_FISICA);
    if (partida.estado.equipeDaVez !== 0) break; // já passou para o time de IA
  }

  const humano = partida.times[0].minhocas[0];
  assert.equal(humano.angulo, Math.PI / 4, 'ninguém deveria ter tocado na mira do time humano');
  assert.equal(partida.estado.projeteis.length, 0, 'e nada deveria ter sido disparado por ele');
});
