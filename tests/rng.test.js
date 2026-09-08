import test from 'node:test';
import assert from 'node:assert/strict';

import { createRng, hashSeed } from '../js/engine/rng.js';

test('a mesma semente produz exatamente a mesma sequência', () => {
  const a = createRng(12345);
  const b = createRng(12345);
  const primeira = Array.from({ length: 200 }, () => a.next());
  const segunda = Array.from({ length: 200 }, () => b.next());
  assert.deepEqual(primeira, segunda);
});

test('sementes diferentes divergem já no primeiro valor', () => {
  assert.notEqual(createRng(1).next(), createRng(2).next());
});

test('os valores ficam em [0, 1) e cobrem a faixa toda', () => {
  const rng = createRng('minhocas');
  const baldes = new Array(10).fill(0);

  for (let i = 0; i < 20000; i += 1) {
    const v = rng.next();
    assert.ok(v >= 0 && v < 1, `valor fora da faixa: ${v}`);
    baldes[Math.floor(v * 10)] += 1;
  }

  // Nenhum décimo deve ficar vazio nem levar mais que o dobro do esperado.
  for (const [i, n] of baldes.entries()) {
    assert.ok(n > 1200 && n < 3200, `balde ${i} com ${n} amostras`);
  }
});

test('hashSeed é estável e sensível ao texto', () => {
  assert.equal(hashSeed('trincheira'), hashSeed('trincheira'));
  assert.notEqual(hashSeed('trincheira'), hashSeed('trincheirA'));
});

test('int e range respeitam os limites', () => {
  const rng = createRng(7);
  for (let i = 0; i < 500; i += 1) {
    const n = rng.int(3, 9);
    assert.ok(Number.isInteger(n) && n >= 3 && n < 9);
    const f = rng.range(-2, 2);
    assert.ok(f >= -2 && f < 2);
  }
});

test('shuffle preserva todos os itens e é determinístico', () => {
  const original = [1, 2, 3, 4, 5, 6, 7, 8];
  const a = createRng(99).shuffle([...original]);
  const b = createRng(99).shuffle([...original]);
  assert.deepEqual(a, b);
  assert.deepEqual([...a].sort((x, y) => x - y), original);
});

test('o estado pode ser salvo e retomado no meio da sequência', () => {
  const rng = createRng(2024);
  for (let i = 0; i < 10; i += 1) rng.next();

  const marca = rng.state;
  const esperado = [rng.next(), rng.next(), rng.next()];

  rng.state = marca;
  assert.deepEqual([rng.next(), rng.next(), rng.next()], esperado);
});
