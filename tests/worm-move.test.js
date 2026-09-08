import test from 'node:test';
import assert from 'node:assert/strict';

import { createMask, setAt, solidAt, normalAt, AR, TERRA } from '../js/minhocas/mask.js';
import { createWorm, andar, pular, empurrar, atualizar, estaParada, apoiada, colide, VELOCIDADE } from '../js/minhocas/worm.js';
import { GRAVIDADE, ARRASTO } from '../js/minhocas/ballistics.js';

const PPM = 20;
const AMBIENTE = { gravidade: GRAVIDADE, arrasto: ARRASTO, vento: 0 };

/**
 * Terreno de teste: só o que a minhoca usa (`solidoEm` e `normalEm`), sobre
 * uma máscara montada à mão. Não precisa de canvas nem de geração de mapa.
 */
function terrenoDeTeste(largura, altura, pintar) {
  const mask = createMask(largura, altura, AR);
  pintar((x, y, m = TERRA) => setAt(mask, x, y, m));
  return {
    mask,
    solidoEm: (x, y) => solidAt(mask, x * PPM, altura - y * PPM),
    normalEm(x, y, r = 0.3) {
      const n = normalAt(mask, x * PPM, altura - y * PPM, Math.max(2, r * PPM));
      return { x: n.x, y: -n.y };
    },
    /** Altura do chão (em metros) numa coluna. */
    chao(x) {
      const px = Math.round(x * PPM);
      let py = 0;
      while (py < altura && !solidAt(mask, px, py)) py += 1;
      return (altura - py) / PPM;
    },
  };
}

/** Chão plano ocupando a metade de baixo. */
function terrenoPlano() {
  return terrenoDeTeste(600, 300, (set) => {
    for (let y = 200; y < 300; y += 1) {
      for (let x = 0; x < 600; x += 1) set(x, y);
    }
  });
}

/** Chão plano com uma rampa suave subindo para a direita. */
function terrenoComRampa() {
  return terrenoDeTeste(600, 300, (set) => {
    for (let x = 0; x < 600; x += 1) {
      const topo = x < 300 ? 200 : Math.max(140, 200 - Math.floor((x - 300) * 0.25));
      for (let y = topo; y < 300; y += 1) set(x, y);
    }
  });
}

/** Assenta a minhoca no chão antes do teste começar. */
function assentar(w, terreno, segundos = 2) {
  for (let i = 0; i < segundos * 120; i += 1) atualizar(w, terreno, 1 / 120, AMBIENTE);
}

test('a minhoca cai e assenta em cima do chão', () => {
  const t = terrenoPlano();
  const w = createWorm({ nome: 'Tico', equipe: 0, x: 10, y: 12 });

  assentar(w, t);

  assert.equal(w.estado !== 'voando', true, 'tem de parar de cair');
  assert.ok(apoiada(t, w.x, w.y), 'tem de estar apoiada no chão');
  assert.ok(!colide(t, w.x, w.y), 'não pode ficar enterrada no terreno');
  assert.ok(Math.abs(w.y - t.chao(w.x)) < 0.1, `assentou em y = ${w.y}, chão em ${t.chao(w.x)}`);
});

test('andar move a minhoca na velocidade certa, em qualquer passo de tempo', () => {
  // O passo de tempo não pode mudar a velocidade: um quadro pequeno pede
  // menos que um pixel, e a sobra tem de ser guardada, não arredondada.
  for (const passos of [30, 60, 120, 240]) {
    const t = terrenoPlano();
    const w = createWorm({ nome: 'Tico', equipe: 0, x: 10, y: 5.2 });
    assentar(w, t);
    const inicio = w.x;

    for (let i = 0; i < passos; i += 1) {
      andar(w, t, 1, 1 / passos);
      atualizar(w, t, 1 / passos, AMBIENTE);
    }

    const percorrido = w.x - inicio;
    assert.ok(
      Math.abs(percorrido - VELOCIDADE) < 0.15,
      `a ${passos} passos por segundo andou ${percorrido.toFixed(2)} m/s, esperado ${VELOCIDADE}`,
    );
  }
});

test('a minhoca sobe uma rampa andando, sem pular', () => {
  const t = terrenoComRampa();
  const w = createWorm({ nome: 'Tico', equipe: 0, x: 12, y: 6 });
  assentar(w, t);
  const alturaInicial = w.y;

  for (let i = 0; i < 180; i += 1) {
    andar(w, t, 1, 1 / 60);
    atualizar(w, t, 1 / 60, AMBIENTE);
  }

  assert.ok(w.y > alturaInicial + 0.5, `não subiu a rampa (de ${alturaInicial.toFixed(2)} para ${w.y.toFixed(2)})`);
  assert.ok(!colide(t, w.x, w.y), 'não pode terminar dentro do terreno');
});

test('a minhoca desce a rampa colada no chão, sem despencar', () => {
  const t = terrenoComRampa();
  const w = createWorm({ nome: 'Tico', equipe: 0, x: 25, y: 10 });
  assentar(w, t);

  for (let i = 0; i < 180; i += 1) {
    andar(w, t, -1, 1 / 60);
    atualizar(w, t, 1 / 60, AMBIENTE);
    assert.ok(w.y - t.chao(w.x) < 0.4, 'não pode flutuar acima do chão ao descer');
  }
  assert.ok(w.x < 24, 'tem de ter andado para a esquerda');
});

test('uma parede alta bloqueia a minhoca em vez de deixá-la atravessar', () => {
  const t = terrenoDeTeste(600, 300, (set) => {
    for (let y = 200; y < 300; y += 1) for (let x = 0; x < 600; x += 1) set(x, y);
    // Paredão de 3 m a partir de x = 15 m.
    for (let y = 140; y < 200; y += 1) for (let x = 300; x < 320; x += 1) set(x, y);
  });

  const w = createWorm({ nome: 'Tico', equipe: 0, x: 10, y: 6 });
  assentar(w, t);

  for (let i = 0; i < 300; i += 1) {
    andar(w, t, 1, 1 / 60);
    atualizar(w, t, 1 / 60, AMBIENTE);
  }

  assert.ok(w.x < 15, `a minhoca atravessou a parede (x = ${w.x.toFixed(2)})`);
  assert.ok(!colide(t, w.x, w.y), 'e não pode ficar presa dentro dela');
});

test('a minhoca não gruda numa quina: ou sobe o degrau, ou para limpa', () => {
  const t = terrenoDeTeste(600, 300, (set) => {
    for (let y = 200; y < 300; y += 1) for (let x = 0; x < 600; x += 1) set(x, y);
    // Degrau de 5 px — dentro do que ela sobe andando.
    for (let y = 195; y < 200; y += 1) for (let x = 300; x < 600; x += 1) set(x, y);
  });

  const w = createWorm({ nome: 'Tico', equipe: 0, x: 12, y: 6 });
  assentar(w, t);

  for (let i = 0; i < 240; i += 1) {
    andar(w, t, 1, 1 / 60);
    atualizar(w, t, 1 / 60, AMBIENTE);
  }

  assert.ok(w.x > 16, 'o degrau baixo tem de ser vencido andando');
  assert.ok(!colide(t, w.x, w.y));
});

test('pular só funciona com os pés no chão', () => {
  const t = terrenoPlano();
  const w = createWorm({ nome: 'Tico', equipe: 0, x: 10, y: 12 });

  assert.equal(pular(w, t, 'frente'), false, 'no ar não dá para pular');

  assentar(w, t);
  assert.equal(pular(w, t, 'frente'), true);
  assert.equal(w.estado, 'voando');
  assert.ok(w.vy > 0, 'o pulo tem de dar velocidade para cima');
});

test('a cambalhota para trás vai mais alto e para o outro lado', () => {
  const t = terrenoPlano();
  const w = createWorm({ nome: 'Tico', equipe: 0, x: 10, y: 5.2 });
  assentar(w, t);
  w.direcao = 1;

  pular(w, t, 'costas');
  assert.ok(w.vx < 0, 'a cambalhota joga para trás');
  assert.ok(w.vy > 8, 'e mais alto que o pulo normal');
});

test('a minhoca cai quando o chão some debaixo dela', () => {
  const t = terrenoDeTeste(600, 300, (set) => {
    for (let y = 200; y < 300; y += 1) for (let x = 0; x < 600; x += 1) set(x, y);
  });

  const w = createWorm({ nome: 'Tico', equipe: 0, x: 10, y: 5.2 });
  assentar(w, t);
  assert.notEqual(w.estado, 'voando');

  // Uma explosão apaga o chão inteiro sob ela.
  for (let y = 200; y < 300; y += 1) {
    for (let x = 180; x < 220; x += 1) setAt(t.mask, x, y, AR);
  }

  atualizar(w, t, 1 / 120, AMBIENTE);
  assert.equal(w.estado, 'voando', 'sem chão, a minhoca tem de despencar');
});

test('cair de muito alto machuca; de pouco, não', () => {
  const t = terrenoPlano();

  const curta = createWorm({ nome: 'A', equipe: 0, x: 10, y: 5.6 });
  let danoCurto = 0;
  for (let i = 0; i < 400; i += 1) {
    const r = atualizar(curta, t, 1 / 120, AMBIENTE);
    if (r) danoCurto += r.dano;
  }

  const longa = createWorm({ nome: 'B', equipe: 0, x: 20, y: 26 });
  let danoLongo = 0;
  for (let i = 0; i < 600; i += 1) {
    const r = atualizar(longa, t, 1 / 120, AMBIENTE);
    if (r) danoLongo += r.dano;
  }

  assert.equal(danoCurto, 0, 'uma queda de 30 cm não pode machucar');
  assert.ok(danoLongo > 0, 'uma queda de 20 m tem de machucar');
});

test('o empurrão da explosão joga a minhoca no ar', () => {
  const t = terrenoPlano();
  const w = createWorm({ nome: 'Tico', equipe: 0, x: 10, y: 5.2 });
  assentar(w, t);
  assert.equal(estaParada(w), true);

  empurrar(w, 6, 7);
  assert.equal(w.estado, 'voando');
  assert.equal(estaParada(w), false, 'quem está voando segura o turno');

  assentar(w, t, 6);
  assert.equal(estaParada(w), true, 'e depois assenta de novo');
});

test('minhoca morta não se mexe mais', () => {
  const t = terrenoPlano();
  const w = createWorm({ nome: 'Tico', equipe: 0, x: 10, y: 12 });
  w.vivo = false;
  const antes = { x: w.x, y: w.y };

  assentar(w, t);
  andar(w, t, 1, 1);
  pular(w, t, 'frente');

  assert.deepEqual({ x: w.x, y: w.y }, antes);
  assert.equal(estaParada(w), true, 'uma minhoca morta nunca segura o turno');
});
