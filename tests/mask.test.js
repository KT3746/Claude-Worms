import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createMask, at, solidAt, setAt, carveCircle, fillCircle, fillRect, regrowGrass,
  circleHits, raycast, normalAt,
  AR, TERRA, GRAMA, ROCHA, GRAMA_ESPESSURA,
} from '../js/minhocas/mask.js';

/** Um mapa de teste: metade de baixo sólida. */
function mapaComChao(largura = 40, altura = 30, linhaDoChao = 15) {
  const mask = createMask(largura, altura, AR);
  for (let y = linhaDoChao; y < altura; y += 1) {
    for (let x = 0; x < largura; x += 1) setAt(mask, x, y, TERRA);
  }
  return mask;
}

test('fora do mapa: o céu é ar, os lados e o fundo são rocha', () => {
  const mask = mapaComChao();
  assert.equal(at(mask, 5, -3), AR, 'acima do topo tem de ser céu');
  assert.equal(at(mask, -1, 5), ROCHA);
  assert.equal(at(mask, 40, 5), ROCHA);
  assert.equal(at(mask, 5, 30), ROCHA);
});

test('a cratera abre um buraco e não toca na rocha', () => {
  const mask = mapaComChao();
  for (let x = 18; x < 22; x += 1) setAt(mask, x, 16, ROCHA);

  assert.ok(solidAt(mask, 20, 16));
  carveCircle(mask, 20, 17, 6);

  assert.equal(at(mask, 20, 20), AR, 'o miolo da cratera tem de sumir');
  assert.equal(at(mask, 20, 16), ROCHA, 'rocha é indestrutível');
  assert.ok(solidAt(mask, 20, 29), 'longe do centro continua sólido');
});

test('a cratera devolve a região alterada, com a faixa da grama abaixo', () => {
  const mask = mapaComChao();
  const rect = carveCircle(mask, 20, 18, 4);

  assert.ok(rect, 'abrir cratera em terreno sólido tem de devolver a região');
  assert.ok(rect.x0 <= 16 && rect.x1 >= 24);
  assert.equal(rect.y1, Math.ceil(18 + 4) + GRAMA_ESPESSURA);
});

test('cavar no vazio não altera nada e devolve null', () => {
  const mask = mapaComChao();
  assert.equal(carveCircle(mask, 20, 3, 2), null);
});

test('a cratera é recortada na borda do mapa sem estourar o array', () => {
  const mask = mapaComChao();
  assert.doesNotThrow(() => carveCircle(mask, 0, 29, 12));
  assert.doesNotThrow(() => carveCircle(mask, 39, 16, 20));
  assert.equal(mask.data.length, 40 * 30);
});

test('a grama nasce só na casca da superfície', () => {
  const mask = mapaComChao();
  regrowGrass(mask, { x0: 0, y0: 0, x1: 39, y1: 29 });

  assert.equal(at(mask, 10, 15), GRAMA, 'o topo do chão é grama');
  assert.equal(at(mask, 10, 15 + GRAMA_ESPESSURA - 1), GRAMA);
  assert.equal(at(mask, 10, 15 + GRAMA_ESPESSURA), TERRA, 'abaixo da casca é terra');
});

test('a grama se refaz na borda de uma cratera nova', () => {
  const mask = mapaComChao();
  regrowGrass(mask, { x0: 0, y0: 0, x1: 39, y1: 29 });
  assert.equal(at(mask, 20, 22), TERRA, 'antes da explosão, isto é terra funda');

  carveCircle(mask, 20, 18, 4);

  // O primeiro pixel sólido abaixo do buraco tem de ter virado grama.
  let y = 18;
  while (y < 30 && at(mask, 20, y) === AR) y += 1;
  assert.equal(at(mask, 20, y), GRAMA, 'a cratera tem de ganhar casca verde');
});

test('circleHits encontra terreno tanto no centro quanto na borda', () => {
  const mask = mapaComChao();
  assert.equal(circleHits(mask, 20, 20, 2), true, 'centro dentro da terra');
  assert.equal(circleHits(mask, 20, 13, 3), true, 'borda do círculo alcança o chão');
  assert.equal(circleHits(mask, 20, 5, 2), false, 'bem no alto não encosta em nada');
});

test('raycast devolve o primeiro ponto sólido do segmento', () => {
  const mask = mapaComChao();
  const hit = raycast(mask, 20, 0, 20, 29);

  assert.ok(hit);
  assert.equal(Math.round(hit.y), 15);
  assert.equal(hit.material, TERRA);
  assert.ok(hit.t > 0.4 && hit.t < 0.6);
});

test('raycast no céu não acha nada', () => {
  const mask = mapaComChao();
  assert.equal(raycast(mask, 2, 2, 38, 2), null);
});

test('a normal de um chão plano aponta para cima', () => {
  const mask = mapaComChao();
  const n = normalAt(mask, 20, 15, 5);
  assert.ok(n.y < -0.7, `a normal deveria apontar para cima (y = ${n.y.toFixed(2)})`);
  assert.ok(Math.abs(n.x) < 0.2, 'chão plano não puxa para o lado');
  assert.ok(Math.abs(Math.hypot(n.x, n.y) - 1) < 1e-6, 'a normal é unitária');
});

test('a normal de uma parede vertical aponta para o lado', () => {
  const mask = createMask(40, 30, AR);
  for (let y = 0; y < 30; y += 1) {
    for (let x = 20; x < 40; x += 1) setAt(mask, x, y, TERRA);
  }
  const n = normalAt(mask, 20, 15, 5);
  assert.ok(n.x < -0.7, `a normal deveria apontar para a esquerda (x = ${n.x.toFixed(2)})`);
});

test('no meio da terra, a normal não trava nem devolve NaN', () => {
  const mask = mapaComChao();
  const n = normalAt(mask, 20, 25, 4);
  assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y));
});

test('fillCircle escreve o material pedido', () => {
  const mask = createMask(40, 30, AR);
  fillCircle(mask, 20, 15, 5, ROCHA);
  assert.equal(at(mask, 20, 15), ROCHA);
  assert.equal(at(mask, 20, 25), AR);
});

test('fillRect preenche o retângulo pedido, e só ele', () => {
  const mask = createMask(40, 30, AR);
  const rect = fillRect(mask, 10, 10, 20, 15, TERRA);

  assert.deepEqual(rect, { x0: 10, y0: 10, x1: 20, y1: 15 });
  assert.equal(at(mask, 15, 12), TERRA, 'dentro do retângulo');
  assert.equal(at(mask, 9, 12), AR, 'fora, à esquerda');
  assert.equal(at(mask, 21, 12), AR, 'fora, à direita');
  assert.equal(at(mask, 15, 9), AR, 'fora, acima');
  assert.equal(at(mask, 15, 16), AR, 'fora, abaixo');
});

test('fillRect aceita cantos em qualquer ordem', () => {
  const mask = createMask(40, 30, AR);
  fillRect(mask, 20, 15, 10, 10, TERRA); // x1 < x0
  assert.equal(at(mask, 15, 12), TERRA);
});

test('fillRect não sobrescreve rocha', () => {
  const mask = createMask(40, 30, AR);
  setAt(mask, 15, 12, ROCHA);
  fillRect(mask, 10, 10, 20, 15, TERRA);
  assert.equal(at(mask, 15, 12), ROCHA, 'rocha é indestrutível mesmo para construção');
});

test('fillRect é recortado na borda do mapa sem estourar o array', () => {
  const mask = createMask(40, 30, AR);
  assert.doesNotThrow(() => fillRect(mask, -10, -10, 5, 5, TERRA));
  assert.doesNotThrow(() => fillRect(mask, 35, 25, 60, 60, TERRA));
  assert.equal(mask.data.length, 40 * 30);
});
