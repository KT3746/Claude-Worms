import test from 'node:test';
import assert from 'node:assert/strict';

import { lancar, passo, ajustarComprimento, soltar, pivoAtivo } from '../js/minhocas/rope.js';

const SEM_PAREDE = () => null;

/** Uma parede vertical em x = px, entre y0 e y1. */
function paredeVertical(px, y0, y1) {
  return (x0, y0s, x1, y1s) => {
    if (x0 === x1) return null; // segmento vertical: sem uso nos testes
    const t = (px - x0) / (x1 - x0);
    if (t < 0 || t > 1) return null;
    const y = y0s + (y1s - y0s) * t;
    if (y < Math.min(y0, y1) || y > Math.max(y0, y1)) return null;
    return { x: px, y, t };
  };
}

test('lancar não prende em nada se o raio não acha parede', () => {
  const origem = { x: 0, y: 0, vx: 1, vy: 0 };
  assert.equal(lancar(origem, 10, 0, SEM_PAREDE), null);
});

test('lancar prende no primeiro ponto sólido e calcula o comprimento inicial', () => {
  const origem = { x: 0, y: 0, vx: 2, vy: -1 };
  const raio = (x0, y0, x1, y1) => ({ x: 5, y: 5, t: 0.5 });
  const estado = lancar(origem, 10, 10, raio);

  assert.deepEqual(pivoAtivo(estado), { x: 5, y: 5 });
  assert.ok(Math.abs(estado.L - Math.hypot(5, 5)) < 1e-9);
  assert.equal(estado.x, 0);
  assert.equal(estado.y, 0);
  assert.equal(estado.vx, 2);
  assert.equal(estado.vy, -1);
});

test('sem gravidade, a distância ao pivô nunca passa de L', () => {
  let estado = lancar({ x: 5, y: 0, vx: 0, vy: 6 }, 0, 0, () => ({ x: 0, y: 0, t: 0.5 }));
  const L = estado.L;

  for (let i = 0; i < 600; i += 1) {
    estado = passo(estado, 1 / 120, { gravidade: 0, raio: SEM_PAREDE });
    const d = Math.hypot(estado.x - 0, estado.y - 0);
    assert.ok(d <= L + 1e-6, `passo ${i}: distância ${d} > L ${L}`);
  }
});

test('com gravidade, a corda balança como um pêndulo sem esticar', () => {
  let estado = lancar({ x: 6, y: 0, vx: 0, vy: 0 }, 0, 5, () => ({ x: 0, y: 5, t: 1 }));
  const L = estado.L;
  let maiorDistancia = 0;

  for (let i = 0; i < 1200; i += 1) {
    estado = passo(estado, 1 / 120, { raio: SEM_PAREDE });
    const p = pivoAtivo(estado);
    const d = Math.hypot(estado.x - p.x, estado.y - p.y);
    maiorDistancia = Math.max(maiorDistancia, d);
  }

  assert.ok(maiorDistancia <= L + 1e-6, `a corda esticou: ${maiorDistancia} > ${L}`);
});

test('o balanço é o que dá velocidade: soltar no ponto baixo é mais rápido que o lançamento', () => {
  // Solta de lado, sem velocidade inicial — a gravidade faz o resto.
  let estado = lancar({ x: 6, y: 0, vx: 0, vy: 0 }, 0, 0, () => ({ x: 0, y: 0, t: 1 }));
  let maiorVelocidade = 0;

  for (let i = 0; i < 300; i += 1) {
    estado = passo(estado, 1 / 120, { raio: SEM_PAREDE });
    maiorVelocidade = Math.max(maiorVelocidade, Math.hypot(estado.vx, estado.vy));
  }

  assert.ok(maiorVelocidade > 3, `o balanço mal ganhou velocidade: ${maiorVelocidade.toFixed(2)} m/s`);
});

test('a corda empilha um novo pivô ao esbarrar numa quina', () => {
  // Pivô em (0, 10). Uma parede vertical em x = 3 intercepta o caminho
  // entre o pivô e a minhoca quando ela balança para o outro lado.
  let estado = lancar({ x: -6, y: 0, vx: 4, vy: 0 }, 0, 10, () => ({ x: 0, y: 10, t: 1 }));
  const raioComParede = paredeVertical(3, -100, 100);

  let empilhou = false;
  for (let i = 0; i < 600 && !empilhou; i += 1) {
    estado = passo(estado, 1 / 120, { raio: raioComParede });
    if (estado.pivos.length > 1) empilhou = true;
  }

  assert.ok(empilhou, 'esperava um pivô novo ao cruzar a parede em x = 3');
  assert.equal(estado.pivos.length, 2);
  assert.ok(Math.abs(estado.pivos[1].x - 3) < 0.5, 'o novo pivô devia estar perto de x = 3');
});

test('desempilha quando o ângulo reabre para o lado de onde a corda veio', () => {
  const pai = { x: 0, y: 10 };
  const corner = { x: 3, y: 6 };

  // Sentido registrado ao empilhar: com a minhoca em (5, 4), do lado em que
  // o produto vetorial corner→pai × corner→minhoca dá negativo.
  let estado = {
    x: 5, y: 4, vx: 0, vy: 0,
    pivos: [pai, corner],
    sentidos: [0, -1],
    L: Math.hypot(5 - corner.x, 4 - corner.y),
  };

  // Move a minhoca para o lado OPOSTO do corner (reabrindo o ângulo) e dá um passo.
  estado.x = -5;
  estado.y = 4;
  estado.vx = 0;
  estado.vy = 0;

  const depois = passo(estado, 1 / 500, { gravidade: 0, raio: SEM_PAREDE });
  assert.equal(depois.pivos.length, 1, 'devia ter desempilhado o corner');
  assert.deepEqual(depois.pivos[0], pai);
});

test('ajustarComprimento encolhe e alonga dentro dos limites', () => {
  const base = { L: 10 };
  assert.equal(ajustarComprimento(base, -3).L, 7);
  assert.equal(ajustarComprimento(base, 3).L, 13);
  assert.equal(ajustarComprimento(base, -100, { comprimentoMin: 2 }).L, 2);
  assert.equal(ajustarComprimento(base, 100, { comprimentoMax: 20 }).L, 20);
});

test('soltar devolve o corpo livre, sem pivô nenhum', () => {
  const estado = { x: 1, y: 2, vx: 3, vy: 4, pivos: [{ x: 0, y: 0 }], sentidos: [0], L: 5 };
  assert.deepEqual(soltar(estado), { x: 1, y: 2, vx: 3, vy: 4 });
});

test('pivoAtivo é sempre o topo da pilha', () => {
  const estado = { pivos: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }] };
  assert.deepEqual(pivoAtivo(estado), { x: 2, y: 2 });
});
