/**
 * Blocos de desenho: o que importa aqui é a CONTABILIDADE de região suja e
 * o orçamento por quadro — nenhum pixel de verdade é pintado (o `paint` de
 * teste só anota o que foi pedido).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createChunks } from '../js/engine/chunks.js';

/** Cria blocos anotando cada área repintada, em coordenadas locais ao bloco. */
function comRegistro(opts = {}) {
  const pedidos = [];
  const chunks = createChunks({
    width: 1024,
    height: 512,
    size: 512,
    paint: (ctx, bloco, area) => pedidos.push({ col: bloco.col, row: bloco.row, ...area }),
    ...opts,
  });
  return { chunks, pedidos };
}

const area = (p) => (p.x1 - p.x0 + 1) * (p.y1 - p.y0 + 1);

test('todo bloco nasce sujo inteiro e o primeiro repaint sem limite pinta tudo', () => {
  const { chunks, pedidos } = comRegistro();
  assert.equal(chunks.dirtyCount, 2);
  chunks.repaint(Infinity);
  assert.equal(chunks.dirtyCount, 0);
  assert.equal(pedidos.length, 2);
  assert.equal(pedidos.reduce((s, p) => s + area(p), 0), 1024 * 512, 'a área toda, sem sobra');
});

test('o orçamento é por PIXEL: uma região grande é dividida em faixas entre quadros', () => {
  const { chunks, pedidos } = comRegistro();
  chunks.repaint(Infinity);
  pedidos.length = 0;

  chunks.markRect(0, 0, 511, 511); // um bloco inteiro sujo: 262 144 px
  const orcamento = 512 * 100;     // 100 linhas por quadro

  chunks.repaint(orcamento);
  assert.equal(pedidos.length, 1);
  assert.ok(area(pedidos[0]) <= orcamento, 'não pode estourar o orçamento do quadro');
  assert.equal(chunks.dirtyCount, 1, 'o resto continua sujo para o próximo quadro');

  let voltas = 1;
  while (chunks.dirtyCount > 0 && voltas < 20) {
    chunks.repaint(orcamento);
    voltas += 1;
  }
  assert.equal(chunks.dirtyCount, 0, 'e termina em poucos quadros');
  assert.equal(pedidos.reduce((s, p) => s + area(p), 0), 512 * 512, 'somando as faixas, a região inteira');

  // As faixas têm de se emendar sem buraco nem sobreposição.
  const ordenadas = pedidos.slice().sort((a, b) => a.y0 - b.y0);
  assert.equal(ordenadas[0].y0, 0);
  for (let i = 1; i < ordenadas.length; i += 1) {
    assert.equal(ordenadas[i].y0, ordenadas[i - 1].y1 + 1, 'faixa emendada na anterior');
  }
  assert.equal(ordenadas[ordenadas.length - 1].y1, 511);
});

test('uma cratera comum cabe num quadro só — o orçamento não atrasa o normal', () => {
  const { chunks, pedidos } = comRegistro();
  chunks.repaint(Infinity);
  pedidos.length = 0;

  chunks.markRect(100, 100, 228, 232); // ~128 × 132 px, uma cratera de 3 m
  chunks.repaint(60000);
  assert.equal(chunks.dirtyCount, 0, 'saiu inteira de uma vez');
  assert.equal(pedidos.length, 1);
});

test('um orçamento apertado demais ainda progride: pelo menos uma linha por bloco', () => {
  const { chunks } = comRegistro();
  chunks.repaint(Infinity);
  chunks.markRect(0, 0, 511, 511);

  let voltas = 0;
  while (chunks.dirtyCount > 0 && voltas < 2000) {
    chunks.repaint(1); // um pixel de orçamento: nunca trava
    voltas += 1;
  }
  assert.equal(chunks.dirtyCount, 0);
  assert.equal(voltas, 512, 'uma linha por volta');
});

test('markRect só suja os blocos que a região toca', () => {
  const { chunks } = comRegistro();
  chunks.repaint(Infinity);
  chunks.markRect(600, 10, 700, 20); // só o bloco da direita
  assert.equal(chunks.dirtyCount, 1);
});
