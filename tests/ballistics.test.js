import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GRAVIDADE, lancar, passo, avancar, refletir, simular, interseccaoSegmentoCirculo,
} from '../js/minhocas/ballistics.js';

const SEM_ARRASTO = { gravidade: GRAVIDADE, arrasto: 0, vento: 0 };
const VAZIO = () => false;

test('sem arrasto, o alcance bate com a fórmula balística', () => {
  const velocidade = 26;
  const angulo = Math.PI / 4;
  const esperado = (velocidade * velocidade * Math.sin(2 * angulo)) / GRAVIDADE;

  const chao = (x, y) => y <= 0;
  const { estado } = simular(lancar(0, 0.001, angulo, velocidade), SEM_ARRASTO, chao, { dt: 1 / 2000 });

  assert.ok(
    Math.abs(estado.x - esperado) < 0.2,
    `alcance ${estado.x.toFixed(2)} m deveria ser ~${esperado.toFixed(2)} m`,
  );
});

test('o vento empurra o projétil e o vento contra o encurta', () => {
  const chao = (x, y) => y <= 0;
  const inicial = lancar(0, 0.001, Math.PI / 4, 24);
  const opts = { dt: 1 / 480 };

  const parado = simular(inicial, { vento: 0 }, chao, opts).estado.x;
  const aFavor = simular(inicial, { vento: 8 }, chao, opts).estado.x;
  const contra = simular(inicial, { vento: -8 }, chao, opts).estado.x;

  assert.ok(aFavor > parado, 'vento de cauda tem de levar mais longe');
  assert.ok(contra < parado, 'vento de frente tem de encurtar');
});

test('o arrasto tira alcance', () => {
  const chao = (x, y) => y <= 0;
  const inicial = lancar(0, 0.001, Math.PI / 4, 30);
  const semArrasto = simular(inicial, SEM_ARRASTO, chao, { dt: 1 / 480 }).estado.x;
  const comArrasto = simular(inicial, { arrasto: 0.01 }, chao, { dt: 1 / 480 }).estado.x;
  assert.ok(comArrasto < semArrasto);
});

test('um projétil rápido NÃO atravessa uma parede fina entre dois quadros', () => {
  // A 200 m/s, um passo de 1/60 s cobre 3,33 m. A parede tem 4 cm e fica em
  // x = 2: quem testasse só a posição final (x = 3,33, no vazio) passaria
  // direto por ela. É o bug clássico que a colisão varrida existe para evitar.
  const parede = (x) => x >= 2 && x <= 2.04;
  const estado = { x: 0, y: 5, vx: 200, vy: 0 };

  assert.equal(parede(200 / 60), false, 'a posição final do passo está no vazio');

  const r = avancar(estado, 1 / 60, SEM_ARRASTO, (x) => parede(x));

  assert.ok(r.impacto, 'a parede tem de ser detectada');
  assert.ok(Math.abs(r.impacto.x - 2) < 0.05, `impacto em x = ${r.impacto.x}`);
  assert.ok(r.impacto.livreX < 2, 'o último ponto livre fica antes da parede');
});

test('sem obstáculo, avancar não inventa impacto', () => {
  const r = avancar({ x: 0, y: 5, vx: 10, vy: 0 }, 1 / 60, SEM_ARRASTO, VAZIO);
  assert.equal(r.impacto, null);
  assert.ok(r.estado.x > 0);
});

test('avancar não modifica o estado recebido', () => {
  const estado = { x: 1, y: 2, vx: 3, vy: 4 };
  avancar(estado, 1 / 60, SEM_ARRASTO, VAZIO);
  assert.deepEqual(estado, { x: 1, y: 2, vx: 3, vy: 4 });
});

test('o ricochete inverte a componente normal e perde energia', () => {
  const estado = { vx: 0, vy: -10 };
  const chao = { x: 0, y: 1 };
  const v = refletir(estado, chao, 0.5, 0);

  assert.ok(v.vy > 0, 'depois de bater no chão a granada tem de subir');
  assert.ok(Math.abs(v.vy - 5) < 1e-6, 'com restituição 0,5 sobe com metade da velocidade');
});

test('o atrito do ricochete freia a componente tangencial', () => {
  const v = refletir({ vx: 10, vy: -10 }, { x: 0, y: 1 }, 0.5, 0.4);
  assert.ok(Math.abs(v.vx - 6) < 1e-6, `vx deveria ser 6, foi ${v.vx}`);
});

test('quicar nunca ganha energia', () => {
  const antes = Math.hypot(12, -9);
  const v = refletir({ vx: 12, vy: -9 }, { x: 0.3, y: 0.95 }, 0.42, 0.3);
  assert.ok(Math.hypot(v.vx, v.vy) < antes);
});

test('a gravidade puxa para baixo mesmo sem velocidade inicial', () => {
  const depois = passo({ x: 0, y: 10, vx: 0, vy: 0 }, 0.1, SEM_ARRASTO);
  assert.ok(depois.vy < 0 && depois.y < 10);
});

test('simular para no primeiro impacto e registra onde', () => {
  const chao = (x, y) => y <= 0;
  const r = simular(lancar(0, 5, 0, 10), SEM_ARRASTO, chao, { dt: 1 / 240 });
  assert.ok(r.impacto, 'a trajetória tem de terminar no chão');
  assert.ok(r.impacto.y <= 0.05);
  assert.ok(r.pontos.length > 2);
});

test('interseccaoSegmentoCirculo acha o ponto mais próximo do disparo', () => {
  const centro = { x: 5, y: 0 };
  const t = interseccaoSegmentoCirculo({ x: 0, y: 0 }, { x: 10, y: 0 }, centro, 1);
  assert.ok(t !== null);
  assert.ok(Math.abs(t - 0.4) < 1e-9, `deveria bater na borda do círculo em t=0,4, deu ${t}`);
});

test('interseccaoSegmentoCirculo não acerta quem está fora da linha de tiro', () => {
  const centro = { x: 5, y: 3 };
  assert.equal(interseccaoSegmentoCirculo({ x: 0, y: 0 }, { x: 10, y: 0 }, centro, 1), null);
});

test('interseccaoSegmentoCirculo não acerta um alvo atrás do atirador', () => {
  const centro = { x: -5, y: 0 };
  assert.equal(interseccaoSegmentoCirculo({ x: 0, y: 0 }, { x: 10, y: 0 }, centro, 1), null);
});

test('interseccaoSegmentoCirculo não acerta um alvo além do alcance do tiro', () => {
  const centro = { x: 50, y: 0 };
  assert.equal(interseccaoSegmentoCirculo({ x: 0, y: 0 }, { x: 10, y: 0 }, centro, 1), null);
});

test('um atirador dentro do próprio círculo-alvo acerta em t=0', () => {
  const centro = { x: 0.3, y: 0 };
  const t = interseccaoSegmentoCirculo({ x: 0, y: 0 }, { x: 10, y: 0 }, centro, 1);
  assert.equal(t, 0);
});
