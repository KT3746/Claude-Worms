import test from 'node:test';
import assert from 'node:assert/strict';

import { danoEm, impulsoEm, explosao, danoDeQueda, LIMIAR_QUEDA } from '../js/minhocas/damage.js';

const BAZUCA = { raio: 2.4, dano: 45, impulso: 11 };

test('o dano é máximo no epicentro e zero na borda', () => {
  assert.equal(danoEm(BAZUCA, 0), 45);
  assert.equal(danoEm(BAZUCA, 2.4), 0);
  assert.equal(danoEm(BAZUCA, 10), 0, 'fora do raio não machuca');
});

test('o dano cai linearmente com a distância', () => {
  assert.ok(Math.abs(danoEm(BAZUCA, 1.2) - 22.5) < 1e-9, 'na metade do raio, metade do dano');
  const a = danoEm(BAZUCA, 0.6);
  const b = danoEm(BAZUCA, 1.2);
  const c = danoEm(BAZUCA, 1.8);
  assert.ok(Math.abs((a - b) - (b - c)) < 1e-9, 'os degraus têm de ser iguais');
});

test('o empurrão aponta do epicentro para fora', () => {
  const direita = impulsoEm(BAZUCA, 1, 0, 1);
  assert.ok(direita.x > 0, 'quem está à direita é jogado para a direita');

  const esquerda = impulsoEm(BAZUCA, -1, 0, 1);
  assert.ok(esquerda.x < 0);
});

test('o empurrão tem viés para cima: a minhoca voa, não desliza', () => {
  const lado = impulsoEm(BAZUCA, 1, 0, 1);
  assert.ok(lado.y > 0, 'mesmo uma explosão ao lado tem de levantar a minhoca');
});

test('explosão exatamente em cima empurra para cima, sem NaN', () => {
  const i = impulsoEm(BAZUCA, 0, 0, 0);
  assert.ok(Number.isFinite(i.x) && Number.isFinite(i.y));
  assert.equal(i.x, 0);
  assert.ok(i.y > 0);
});

test('o empurrão é mais forte perto do centro', () => {
  const perto = impulsoEm(BAZUCA, 0.5, 0, 0.5);
  const longe = impulsoEm(BAZUCA, 2, 0, 2);
  assert.ok(Math.hypot(perto.x, perto.y) > Math.hypot(longe.x, longe.y));
});

test('a explosão só atinge quem está dentro do raio', () => {
  const corpos = [
    { nome: 'perto', x: 0.5, y: 0 },
    { nome: 'borda', x: 2.3, y: 0 },
    { nome: 'longe', x: 9, y: 0 },
    { nome: 'morta', x: 0.2, y: 0, vivo: false },
  ];

  const efeitos = explosao(corpos, 0, 0, BAZUCA);
  const nomes = efeitos.map((e) => e.corpo.nome);

  assert.deepEqual(nomes, ['perto', 'borda'], 'ordem do mais próximo ao mais distante');
});

test('a explosão não modifica os corpos — só descreve o que aconteceria', () => {
  const corpo = { x: 1, y: 0, vida: 100 };
  explosao([corpo], 0, 0, BAZUCA);
  assert.deepEqual(corpo, { x: 1, y: 0, vida: 100 });
});

test('a ordem de resolução é determinística', () => {
  const corpos = [
    { nome: 'c', x: 2.0, y: 0 },
    { nome: 'a', x: 0.3, y: 0 },
    { nome: 'b', x: 1.1, y: 0 },
  ];
  assert.deepEqual(explosao(corpos, 0, 0, BAZUCA).map((e) => e.corpo.nome), ['a', 'b', 'c']);
});

test('cair de pouca altura não machuca', () => {
  assert.equal(danoDeQueda(-3), 0);
  assert.equal(danoDeQueda(-LIMIAR_QUEDA), 0);
});

test('cair de alto machuca, e mais quanto mais rápido', () => {
  const medio = danoDeQueda(-14);
  const forte = danoDeQueda(-22);
  assert.ok(medio > 0);
  assert.ok(forte > medio);
  assert.ok(forte <= 40, 'o dano de queda tem teto');
});

test('o sinal da velocidade não importa para o dano de queda', () => {
  assert.equal(danoDeQueda(-16), danoDeQueda(16));
});
