/**
 * Mira por ponteiro: `apontarPara`, o comando que o dedo (e o mouse) usam
 * arrastando pelo campo. `mirar()` anda de pouquinho em pouquinho porque a
 * tecla fica segurada; este diz o ângulo inteiro de uma vez.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createMatch } from '../js/minhocas/match.js';
import { ALTURA } from '../js/minhocas/worm.js';

function criarCameraFalsa() {
  return {
    x: 0, y: 0, scale: 20, width: 800, height: 450,
    setBounds() {}, lookAt() {}, addShake() {}, update() {},
    toScreen: (x, y) => ({ x, y }),
    get halfWidth() { return this.width / 2 / this.scale; },
    get halfHeight() { return this.height / 2 / this.scale; },
  };
}

/** Avança `segundos` de física em passos de 1/120 s. */
function rodar(partida, segundos) {
  const passos = Math.round(segundos * 120);
  for (let i = 0; i < passos; i += 1) partida.update(1 / 120);
}

/**
 * Uma partida já em JOGANDO: recém-criada ela está em PREPARANDO, e nenhum
 * comando obedece — o que faria estes testes passarem sem testar nada, já que
 * o ângulo inicial (π/4) é justamente um dos valores esperados.
 */
function partidaDeTeste() {
  const partida = createMatch({
    semente: 12345,
    camera: criarCameraFalsa(),
    particles: { spawn() {}, update() {}, draw() {}, clear() {} },
  });
  rodar(partida, 1.5);
  return partida;
}

/** O ponto de onde a mira parte: o mesmo pivô da boca da arma. */
function pivo(w) {
  return { x: w.x, y: w.y + ALTURA * 0.55 };
}

test('aponta para a direita e para cima', () => {
  const partida = partidaDeTeste();
  const w = partida.estado.ativa;
  const p = pivo(w);
  w.angulo = 0; // longe de 45°, para o teste não passar por acidente

  partida.comandos.apontarPara(p.x + 10, p.y + 10);

  assert.equal(w.direcao, 1, 'o alvo está à direita');
  assert.ok(Math.abs(w.angulo - Math.PI / 4) < 1e-6, `45° para cima, veio ${w.angulo}`);
});

test('aponta para trás e vira a minhoca em vez de dobrar o ângulo', () => {
  const partida = partidaDeTeste();
  const w = partida.estado.ativa;
  const p = pivo(w);
  w.direcao = 1;

  partida.comandos.apontarPara(p.x - 10, p.y + 10);

  assert.equal(w.direcao, -1, 'virou para o alvo');
  assert.ok(
    Math.abs(w.angulo - Math.PI / 4) < 1e-6,
    `o ângulo é medido a partir da frente, então continua 45°; veio ${w.angulo}`,
  );
});

test('aponta para baixo com ângulo negativo', () => {
  const partida = partidaDeTeste();
  const w = partida.estado.ativa;
  const p = pivo(w);

  partida.comandos.apontarPara(p.x + 10, p.y - 10);

  assert.equal(w.direcao, 1);
  assert.ok(Math.abs(w.angulo + Math.PI / 4) < 1e-6, `-45°, veio ${w.angulo}`);
});

// Medir contra `Math.abs(dx)` é o que mantém a mira dentro da mesma faixa que
// `mirar()` respeita — sem precisar de um clamp, que aqui nunca dispararia.
test('o ângulo nunca passa de ±90°, mesmo apontando na vertical', () => {
  const partida = partidaDeTeste();
  const w = partida.estado.ativa;
  const p = pivo(w);

  partida.comandos.apontarPara(p.x, p.y + 30);
  assert.ok(w.angulo <= Math.PI / 2 + 1e-9, `veio ${w.angulo}`);
  assert.ok(w.angulo > Math.PI / 2 - 0.01, 'praticamente na vertical para cima');

  partida.comandos.apontarPara(p.x, p.y - 30);
  assert.ok(w.angulo >= -Math.PI / 2 - 1e-9, `veio ${w.angulo}`);
});

test('apontar em cima da própria minhoca não mexe na mira', () => {
  const partida = partidaDeTeste();
  const w = partida.estado.ativa;
  const p = pivo(w);
  w.angulo = 0.5;
  w.direcao = -1;

  partida.comandos.apontarPara(p.x, p.y);

  assert.equal(w.angulo, 0.5, 'sem direção definida, mantém o que estava');
  assert.equal(w.direcao, -1);
});

test('presa na corda, arrastar não mexe na mira', () => {
  const partida = partidaDeTeste();
  const w = partida.estado.ativa;
  const p = pivo(w);
  w.angulo = 0.3;

  // Com a corda presa, ↑/↓ encolhem e alongam em vez de mirar; o arraste
  // precisa obedecer à mesma regra, senão a mira mudaria pelas costas.
  partida.estado.corda = { L: 5, limiteMin: 1, limiteMax: 20, pivos: [], sentidos: [] };
  partida.comandos.apontarPara(p.x + 10, p.y + 10);

  assert.equal(w.angulo, 0.3, 'a mira ficou onde estava');
});

test('minhoca morta não obedece ao arraste', () => {
  const partida = partidaDeTeste();
  const w = partida.estado.ativa;
  const p = pivo(w);
  w.angulo = 0.2;
  w.vivo = false;

  partida.comandos.apontarPara(p.x + 10, p.y + 10);

  assert.equal(w.angulo, 0.2);
});
