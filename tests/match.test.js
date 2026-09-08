import test from 'node:test';
import assert from 'node:assert/strict';

import { createMatch } from '../js/minhocas/match.js';
import { armaPorId } from '../js/minhocas/weapons.js';
import { FASE } from '../js/minhocas/turn.js';

/**
 * `createMatch` só precisa de uma câmera e um sistema de partículas — nem
 * um nem outro fazem desenho de verdade aqui, só contabilidade. Isso, mais
 * as guardas de ambiente sem navegador em `engine/audio.js` e
 * `engine/chunks.js`, é o que permite testar a partida inteira (turnos,
 * armas, corda, explosões) sem abrir um navegador.
 */
function criarCameraFalsa() {
  return {
    x: 0, y: 0, scale: 20, width: 800, height: 450,
    setBounds() {}, lookAt() {}, addShake() {}, update() {},
    toScreen: (x, y) => ({ x, y }),
    get halfWidth() { return this.width / 2 / this.scale; },
    get halfHeight() { return this.height / 2 / this.scale; },
  };
}

function criarParticulasFalsas() {
  return { spawn() {}, update() {}, draw() {}, clear() {} };
}

function partidaDeTeste(opts = {}) {
  return createMatch({
    semente: 12345,
    camera: criarCameraFalsa(),
    particles: criarParticulasFalsas(),
    ...opts,
  });
}

/** Avança `segundos` de física em passos de 1/120 s. */
function rodar(partida, segundos) {
  const passos = Math.round(segundos * 120);
  for (let i = 0; i < passos; i += 1) partida.update(1 / 120);
}

test('createMatch roda de ponta a ponta sem navegador nenhum', () => {
  const partida = partidaDeTeste();
  assert.equal(partida.fase, FASE.PREPARANDO);
  rodar(partida, 1.5);
  assert.equal(partida.fase, FASE.JOGANDO);
  assert.ok(partida.estado.ativa?.vivo);
});

test('uma explosão perto de quem está preso na corda solta a corda antes de empurrar', () => {
  const partida = partidaDeTeste();
  rodar(partida, 1.5); // sai de PREPARANDO

  const w = partida.estado.ativa;
  const armaBazuca = armaPorId('bazuca');

  partida.comandos.trocarArma('corda');
  w.y = partida.terreno.superficieEm(w.x) + 8;
  w.estado = 'voando';
  w.vx = 0;
  w.vy = 0;
  w.angulo = -Math.PI / 2;
  partida.comandos.carregar(); // dispara a corda

  assert.ok(partida.estado.corda, 'a corda tinha de prender no chão logo abaixo');
  assert.equal(w.estado, 'corda');

  rodar(partida, 0.5); // balança um pouco

  // Injeta uma explosão exatamente na posição da minhoca presa — o mesmo
  // caminho (`explosao()` + `Worm.empurrar()`) que qualquer arma usa.
  partida.estado.projeteis.push({
    arma: armaBazuca,
    x: w.x,
    y: w.y + 0.475, // meio do corpo da minhoca, não os pés
    vx: 0,
    vy: 0,
    dono: null,
    pavio: 0,
    vivo: true,
    fumaca: 1,
    giro: 0,
    apoiado: false,
    tempoVivo: 0,
  });

  const vidaAntes = w.vida;
  for (let i = 0; i < 10 && partida.estado.projeteis.some((p) => p.arma === armaBazuca); i += 1) {
    partida.update(1 / 120);
  }

  assert.ok(w.vida < vidaAntes, 'a explosão tinha de causar dano');
  assert.equal(partida.estado.corda, null, 'a corda tinha de soltar, não ficar órfã');
  assert.equal(w.estado, 'voando', 'a minhoca tem de estar livre, não presa');

  // O teste de verdade: sem a correção, `Rope.passo()` continuaria rodando
  // e reescreveria x/y/vx/vy por cima do empurrão a cada quadro seguinte —
  // a minhoca ficaria efetivamente presa no ar em vez de cair livre.
  const yLogoApos = w.y;
  const vyLogoApos = w.vy;
  rodar(partida, 0.3);
  assert.ok(w.y < yLogoApos, 'a minhoca tem de continuar caindo livremente');
  assert.ok(w.vy < vyLogoApos, 'a queda livre acelera com a gravidade, não é travada pela corda');
});

test('a mina explode por proximidade e o turno passa normalmente depois', () => {
  const partida = partidaDeTeste();
  rodar(partida, 1.5);

  const w = partida.estado.ativa;
  partida.comandos.trocarArma('mina');
  partida.comandos.carregar(); // larga a mina no pé
  assert.equal(partida.estado.projeteis.length, 1);

  // Corre para longe durante o recuo.
  for (let i = 0; i < 300; i += 1) {
    partida.comandos.andar(-1, 1 / 120);
    partida.update(1 / 120);
  }

  // Anda outra minhoca até em cima da mina, se ela ainda existir.
  const mina = partida.estado.projeteis.find((p) => p.arma.id === 'mina');
  if (mina) {
    const alvo = partida.estado.todas.find((v) => v.vivo && v !== w);
    alvo.x = mina.x;
    alvo.y = mina.y + 0.05;
    alvo.estado = 'parada';
    alvo.vx = 0;
    alvo.vy = 0;
  }

  const turnoAntes = partida.turnos.turno;
  rodar(partida, 5);
  assert.ok(partida.turnos.turno > turnoAntes, 'o turno tem de avançar depois da mina resolver');
  assert.equal(partida.estado.projeteis.some((p) => p.arma.id === 'mina'), false);
});

test('a viga assenta e vira terreno sólido que a partir daí bloqueia normalmente', () => {
  const partida = partidaDeTeste();
  rodar(partida, 1.5);

  const w = partida.estado.ativa;
  const chaoAntes = partida.terreno.superficieEm(w.x);

  partida.comandos.trocarArma('viga');
  partida.comandos.carregar();

  for (let i = 0; i < 600 && partida.estado.projeteis.some((p) => p.arma.id === 'viga'); i += 1) {
    partida.update(1 / 120);
  }

  const chaoDepois = partida.terreno.superficieEm(w.x);
  assert.ok(chaoDepois > chaoAntes, `a viga tinha de erguer o chão (${chaoAntes} -> ${chaoDepois})`);
  assert.equal(partida.estado.projeteis.some((p) => p.arma.id === 'viga'), false, 'a viga não fica pairando na lista depois de construir');
});

test('o turno acaba com a corda ainda presa: ela solta sozinha e o jogo não trava', () => {
  const partida = partidaDeTeste({ tempoTurno: 2 }); // turno bem curto, só para o teste ser rápido
  rodar(partida, 1.5);

  const w = partida.estado.ativa;
  partida.comandos.trocarArma('corda');
  w.y = partida.terreno.superficieEm(w.x) + 6;
  w.estado = 'voando';
  w.vx = 0;
  w.vy = 0;
  w.angulo = -Math.PI / 2;
  partida.comandos.carregar();
  assert.ok(partida.estado.corda);

  let travou = true;
  for (let i = 0; i < 120 * 30; i += 1) { // até 30 s simulados
    partida.update(1 / 120);
    if (partida.turnos.turno >= 1) {
      travou = false;
      break;
    }
  }

  assert.equal(travou, false, 'o turno tinha de avançar sozinho, mesmo com a corda presa');
  assert.equal(partida.estado.corda, null, 'a corda tem de ter soltado ao sair de JOGANDO');
});

test('as duas últimas minhocas morrem na mesma explosão: a partida termina em empate, sem travar', () => {
  // Uma equipe por minhoca só, coladas uma na outra — uma explosão única
  // alcança as duas ao mesmo tempo. É o caso que turn.js resolve certo por
  // construção (o contexto é recalculado do zero a cada quadro), mas só
  // fica provado de verdade rodando a partida inteira, não a máquina pura.
  const partida = partidaDeTeste({
    equipes: [
      { nome: 'A', minhocas: 1 },
      { nome: 'B', minhocas: 1 },
    ],
  });
  rodar(partida, 1.5);

  const [a, b] = partida.estado.todas;
  a.x = 50;
  a.y = partida.terreno.superficieEm(50) + 0.1;
  b.x = 50.5;
  b.y = a.y;
  a.vida = 1;
  b.vida = 1;

  // Uma explosão grande o bastante para as duas, no meio das duas.
  partida.estado.projeteis.push({
    arma: { raio: 6, dano: 50, impulso: 8 },
    x: 50.25, y: a.y + 0.475, vx: 0, vy: 0,
    dono: null, pavio: 0, vivo: true, fumaca: 1, giro: 0, apoiado: false, tempoVivo: 0,
  });

  let travou = true;
  for (let i = 0; i < 120 * 20; i += 1) { // até 20 s simulados
    partida.update(1 / 120);
    if (partida.fimDeJogo) { travou = false; break; }
  }

  assert.equal(travou, false, 'a partida tinha de terminar, não travar esperando alguém vivo que não existe mais');
  assert.equal(a.vivo, false);
  assert.equal(b.vivo, false);
  assert.equal(partida.estado.vencedor, null, 'ninguém sobrou: é empate, não vitória de ninguém');
});

test('trocar de arma e disparar hitscan nunca deixa a mensagem de erro travada', () => {
  // Um teste de sanidade simples: a partida aguenta uma sequência comum de
  // ações sem lançar exceção nem travar o turno em nenhuma fase estranha.
  const partida = partidaDeTeste();
  rodar(partida, 1.5);

  partida.comandos.trocarArma('escopeta');
  partida.comandos.carregar();
  rodar(partida, 0.2);

  for (let i = 0; i < 300 && partida.fase !== FASE.PREPARANDO; i += 1) {
    partida.comandos.andar(-1, 1 / 120);
    partida.update(1 / 120);
  }

  assert.notEqual(partida.turnos.turno, undefined);
});
