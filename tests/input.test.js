/**
 * Entrada: o que o dedo e o mouse podem (e não podem) cancelar.
 *
 * `createInput` só toca em `addEventListener`, `getBoundingClientRect` e nos
 * campos do próprio evento, então dois objetos de mentira bastam — sem DOM
 * de verdade e sem dependência nova.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

function alvoFalso() {
  const ouvintes = new Map();
  return {
    addEventListener(tipo, fn) {
      if (!ouvintes.has(tipo)) ouvintes.set(tipo, []);
      ouvintes.get(tipo).push(fn);
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    emitir(tipo, evento) {
      for (const fn of ouvintes.get(tipo) ?? []) fn(evento);
    },
  };
}

function toque(x, y) {
  return {
    cancelable: true,
    cancelado: false,
    touches: [{ clientX: x, clientY: y }],
    changedTouches: [{ clientX: x, clientY: y }],
    preventDefault() {
      this.cancelado = true;
    },
  };
}

/** Monta o input com um `window` de mentira no lugar do global. */
async function montar() {
  const canvas = alvoFalso();
  const janela = alvoFalso();
  const anterior = globalThis.window;
  globalThis.window = janela;
  try {
    const { createInput } = await import('../js/engine/input.js');
    return { canvas, janela, input: createInput(canvas) };
  } finally {
    globalThis.window = anterior;
  }
}

test('toque que começa no canvas vira gesto do jogo e cancela o padrão', async () => {
  const { canvas, janela, input } = await montar();

  const inicio = toque(120, 90);
  canvas.emitir('touchstart', inicio);
  assert.equal(input.pointer.down, true);
  assert.equal(input.pointer.justPressed, true);
  assert.equal(inicio.cancelado, true, 'o toque no campo de batalha é do jogo');

  const fim = toque(120, 90);
  janela.emitir('touchend', fim);
  assert.equal(input.pointer.justReleased, true, 'soltar no canvas dispara');
  assert.equal(fim.cancelado, true);
});

test('toque que começa fora do canvas não é cancelado — senão o clique do botão morre', async () => {
  const { janela, input } = await montar();

  // Nada de `touchstart` no canvas: o dedo desceu num botão do menu, e só o
  // `touchend` da janela enxerga o gesto.
  const fim = toque(300, 40);
  janela.emitir('touchend', fim);

  assert.equal(
    fim.cancelado,
    false,
    'cancelar o touchend suprime o click sintetizado e o botão nunca responde',
  );
  assert.equal(input.pointer.justReleased, false, 'e o jogo não dispara por causa dele');
  assert.equal(input.pointer.down, false);
});

test('soltar o dedo fora do canvas ainda encerra um gesto começado nele', async () => {
  const { canvas, janela, input } = await montar();

  canvas.emitir('touchstart', toque(400, 300));
  const foraDaTela = toque(-40, 900);
  janela.emitir('touchend', foraDaTela);

  assert.equal(input.pointer.justReleased, true, 'o tiro sai mesmo se o dedo escapou do canvas');
  assert.equal(foraDaTela.cancelado, true);
});
