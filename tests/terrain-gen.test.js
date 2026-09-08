import test from 'node:test';
import assert from 'node:assert/strict';

import { createRng } from '../js/engine/rng.js';
import { gerarTerreno } from '../js/minhocas/terrain-gen.js';
import { at, AR, ROCHA } from '../js/minhocas/mask.js';

/** Mapa pequeno: o suficiente para as invariantes, rápido para o CI. */
const PEQUENO = { largura: 640, altura: 320, ppm: 20 };

function gerar(semente, opts = {}) {
  return gerarTerreno({ ...PEQUENO, ...opts, rng: createRng(semente) });
}

test('a mesma semente gera exatamente o mesmo mapa', () => {
  const a = gerar(12345);
  const b = gerar(12345);
  assert.deepEqual(Array.from(a.mask.data), Array.from(b.mask.data));
  assert.deepEqual(a.nascimentos, b.nascimentos);
});

test('sementes diferentes geram mapas diferentes', () => {
  const a = gerar(1);
  const b = gerar(2);
  assert.notDeepEqual(Array.from(a.mask.data), Array.from(b.mask.data));
});

test('o mapa tem terra e tem céu — não é sólido nem vazio', () => {
  const { mask } = gerar(777);
  let solidos = 0;
  for (const v of mask.data) if (v !== AR) solidos += 1;
  const fracao = solidos / mask.data.length;
  assert.ok(fracao > 0.2 && fracao < 0.8, `preenchimento estranho: ${(fracao * 100).toFixed(1)}%`);
});

test('o leito e as laterais são rocha indestrutível', () => {
  const { mask } = gerar(42);
  assert.equal(at(mask, 300, mask.height - 1), ROCHA, 'o fundo tem de ser rocha');
  assert.equal(at(mask, 300, mask.height - 6), ROCHA);

  // Nas laterais, onde há matéria, ela é rocha.
  for (let y = 0; y < mask.height; y += 7) {
    const esquerda = at(mask, 0, y);
    const direita = at(mask, mask.width - 1, y);
    assert.ok(esquerda === AR || esquerda === ROCHA, `lateral esquerda em y=${y}`);
    assert.ok(direita === AR || direita === ROCHA, `lateral direita em y=${y}`);
  }
});

test('a limpeza não deixa pixel solto no meio do nada', () => {
  const { mask } = gerar(2024);
  let soltos = 0;

  for (let y = 1; y < mask.height - 1; y += 1) {
    for (let x = 1; x < mask.width - 1; x += 1) {
      if (at(mask, x, y) === AR) continue;
      let vizinhos = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          if (at(mask, x + dx, y + dy) !== AR) vizinhos += 1;
        }
      }
      if (vizinhos <= 1) soltos += 1;
    }
  }

  assert.equal(soltos, 0, `${soltos} pixels sólidos praticamente isolados`);
});

test('existem pontos de nascimento, e todos são utilizáveis', () => {
  const { mask, nascimentos, nivelAgua } = gerar(31337);
  assert.ok(nascimentos.length >= 8, `só ${nascimentos.length} pontos de nascimento`);

  for (const p of nascimentos) {
    assert.ok(p.x > 0 && p.x < mask.width, 'dentro do mapa');
    assert.ok(p.y < nivelAgua, 'nenhum nascimento debaixo d\'água');
    assert.notEqual(at(mask, p.x, p.y), AR, 'o ponto é o chão em si');
    assert.equal(at(mask, p.x, p.y - 1), AR, 'com ar logo acima');

    // Teto livre para caber uma minhoca em pé.
    for (let k = 1; k <= 20; k += 1) {
      assert.equal(at(mask, p.x, p.y - k), AR, `teto obstruído a ${k} px acima`);
    }
  }
});

test('os nascimentos não ficam todos amontoados', () => {
  const { nascimentos, mask } = gerar(555);
  const xs = nascimentos.map((p) => p.x);
  const espalhamento = Math.max(...xs) - Math.min(...xs);
  assert.ok(espalhamento > mask.width * 0.4, 'os pontos precisam cobrir o mapa');
});

test('a linha d\'água fica no terço de baixo', () => {
  const { nivelAgua, mask } = gerar(99);
  assert.ok(nivelAgua > mask.height * 0.75 && nivelAgua < mask.height);
});
