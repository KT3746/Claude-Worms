import test from 'node:test';
import assert from 'node:assert/strict';

import * as Caixa from '../js/minhocas/crate.js';
import { createMatch } from '../js/minhocas/match.js';

/** Terreno de mentira: chão reto em y = 10, mapa de 100 × 40 m. */
function chaoReto(alturaChao = 10) {
  return {
    largura: 100,
    altura: 40,
    solidoEm: (x, y) => y <= alturaChao,
    superficieEm: () => alturaChao,
  };
}

const ENV = { gravidade: 20, vento: 0, largura: 100 };

test('caixa desce devagar de paraquedas e pousa no chão sem atravessar', () => {
  const t = chaoReto();
  const c = Caixa.createCrate({ x: 50, y: 30 });
  for (let i = 0; i < 120; i += 1) Caixa.atualizarCaixa(c, t, 1 / 60, ENV);
  assert.ok(c.y > 25, 'em 2 s de paraquedas não pode ter caído mais que ~5 m');
  for (let i = 0; i < 60 * 15; i += 1) Caixa.atualizarCaixa(c, t, 1 / 60, ENV);
  assert.ok(c.apoiada);
  assert.equal(c.paraquedas, false);
  assert.ok(c.y > 10 && c.y < 10.1, `pousou em ${c.y}`);
});

test('sem chão embaixo a caixa pousada volta a cair, agora em queda livre', () => {
  let chao = 10;
  const t = { ...chaoReto(), solidoEm: (x, y) => y <= chao };
  const c = Caixa.createCrate({ x: 50, y: 10.01 });
  Caixa.atualizarCaixa(c, t, 1 / 60, ENV);
  assert.ok(c.apoiada);
  chao = 2;
  for (let i = 0; i < 60; i += 1) Caixa.atualizarCaixa(c, t, 1 / 60, ENV);
  assert.ok(c.apoiada && c.y < 2.1, `caiu até ${c.y}`);
});

test('vento empurra o paraquedas, mas nunca para fora do mapa', () => {
  const c = Caixa.createCrate({ x: 99, y: 30 });
  for (let i = 0; i < 600; i += 1) Caixa.atualizarCaixa(c, chaoReto(), 1 / 60, { ...ENV, vento: 9 });
  assert.ok(c.x <= 99);
});

test('toque e explosão usam a caixa inteira', () => {
  const c = Caixa.createCrate({ x: 10, y: 5 });
  assert.ok(Caixa.tocaCaixa(c, { x: 10.5, y: 5 }, 0.55, 0.95));
  assert.ok(!Caixa.tocaCaixa(c, { x: 12, y: 5 }, 0.55, 0.95));
  assert.ok(!Caixa.tocaCaixa(c, { x: 10, y: 8 }, 0.55, 0.95));
  assert.ok(Caixa.explosaoPega(c, 11.5, 5.3, 1.5));
  assert.ok(!Caixa.explosaoPega(c, 14, 5.3, 1.5));
});

test('pouso sorteado nunca cai sobre a água', () => {
  const t = { ...chaoReto(), superficieEm: (x) => (x < 50 ? 3 : 12) };
  const rng = { range: (a, b) => a + (b - a) * 0.3 }; // sempre a coluna x = 32,8 (água)
  assert.equal(Caixa.sortearPouso(t, 5, rng), null);
  let n = 0;
  const alterna = { range: (a, b) => a + (b - a) * (n++ % 2 ? 0.8 : 0.1) };
  const p = Caixa.sortearPouso(t, 5, alterna);
  assert.ok(p && p.x > 50);
});

test('na partida, caixas caem, curam quem encosta e podem ser desligadas', () => {
  const camera = {
    x: 0, y: 0, scale: 20, width: 800, height: 450,
    setBounds() {}, lookAt() {}, addShake() {}, update() {},
    toScreen: (x, y) => ({ x, y }),
  };
  const particles = { spawn() {}, update() {}, draw() {}, clear() {} };

  let caiu = false;
  for (let s = 1; s <= 30 && !caiu; s += 1) {
    const m = createMatch({ semente: s, camera, particles });
    // Passa vários turnos sem atirar (relógio corre até o fim).
    for (let i = 0; i < 120 * 60 * 3 && !caiu; i += 1) {
      m.update(1 / 120);
      if (m.estado.caixas.length > 0) caiu = true;
    }
    if (caiu) {
      const c = m.estado.caixas[0];
      const w = m.estado.ativa;
      const antes = w.vida;
      c.x = w.x;
      c.y = w.y;
      c.paraquedas = false;
      m.update(1 / 120);
      assert.equal(m.estado.caixas.length, 0);
      assert.equal(w.vida, antes + Caixa.VIDA_DA_CAIXA);
    }
  }
  assert.ok(caiu, 'nenhuma caixa caiu em 30 sementes');

  const sem = createMatch({ semente: 1, camera, particles, caixas: false });
  for (let i = 0; i < 120 * 60 * 3; i += 1) sem.update(1 / 120);
  assert.equal(sem.estado.caixas.length, 0);
});
