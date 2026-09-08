import test from 'node:test';
import assert from 'node:assert/strict';

import { createMatch } from '../js/minhocas/match.js';
import { createRng } from '../js/engine/rng.js';
import { ARMAS } from '../js/minhocas/weapons.js';

/**
 * Estresse determinístico: joga partidas inteiras sozinho, escolhendo ações
 * quase ao acaso (mas com semente fixa — se achar algo, é reproduzível),
 * e verifica invariantes que nenhum cenário dirigido pensou em escrever.
 *
 * Não é sobre jogar bem — é sobre nunca travar, nunca gerar `NaN`, e nunca
 * deixar o estado interno inconsistente, não importa a sequência de ações.
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

/** Confere que nada no mundo virou NaN/Infinity ou saiu do mapa por absurdo. */
function conferirSanidade(partida, contexto) {
  const { terreno, estado } = partida;
  const margem = 50; // metros de folga além do mapa — corda/jetpack podem passar um pouco

  for (const w of estado.todas) {
    for (const campo of ['x', 'y', 'vx', 'vy']) {
      assert.ok(Number.isFinite(w[campo]), `${contexto}: ${w.nome}.${campo} não é finito (${w[campo]})`);
    }
    assert.ok(
      w.x > -margem && w.x < terreno.largura + margem,
      `${contexto}: ${w.nome}.x = ${w.x} muito fora do mapa (largura ${terreno.largura})`,
    );
    assert.ok(
      w.y > -margem && w.y < terreno.altura + margem * 2,
      `${contexto}: ${w.nome}.y = ${w.y} muito fora do mapa (altura ${terreno.altura})`,
    );
  }

  for (const p of estado.projeteis) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `${contexto}: projétil com posição não finita`);
  }
  for (const c of estado.criaturas) {
    assert.ok(Number.isFinite(c.x) && Number.isFinite(c.y), `${contexto}: criatura com posição não finita`);
  }

  // Se alguém está preso na corda, é sempre a minhoca ativa, e ela está viva
  // e no estado certo — nunca uma referência órfã apontando para o nada.
  if (estado.corda) {
    assert.ok(estado.ativa, `${contexto}: corda presa sem minhoca ativa`);
    assert.equal(estado.ativa.vivo, true, `${contexto}: corda presa a uma minhoca morta`);
    assert.equal(estado.ativa.estado, 'corda', `${contexto}: corda presa mas o estado da minhoca não é 'corda'`);
  }

  // Nenhuma lista cresce sem limite — sinal de vazamento (mina duplicada,
  // cacho de fragmentação se realimentando etc.).
  assert.ok(estado.projeteis.length < 200, `${contexto}: ${estado.projeteis.length} projéteis ao mesmo tempo — parece vazamento`);
  assert.ok(estado.criaturas.length < 50, `${contexto}: ${estado.criaturas.length} criaturas ao mesmo tempo — parece vazamento`);
}

const ACOES = ['andar-', 'andar+', 'mirar-', 'mirar+', 'pular', 'cambalhota', 'arma-', 'arma+', 'carregar', 'pavio'];

function jogarPartidaAoAcaso(semente, { turnosMax = 25, passosPorTurnoMax = 120 * 90 } = {}) {
  const rng = createRng(semente);
  const partida = createMatch({
    semente: semente * 7919,
    camera: criarCameraFalsa(),
    particles: criarParticulasFalsas(),
    equipes: [
      { nome: 'A', minhocas: 2 },
      { nome: 'B', minhocas: 2 },
    ],
    tempoTurno: 20, // turno curto: mais turnos testados no mesmo orçamento de passos
  });

  let travouEsperandoAssentar = 0;
  let ultimoTurno = -1;
  let ultimaFase = null;

  for (let turno = 0; turno < turnosMax && !partida.fimDeJogo; turno += 1) {
    let passosNesseTurno = 0;

    while (partida.turnos.turno === turno && !partida.fimDeJogo) {
      // Escolhe uma ação a cada ~10 passos de física — não a cada quadro,
      // para dar tempo de cada uma surtir efeito antes da próxima.
      if (passosNesseTurno % 10 === 0) {
        const acao = ACOES[rng.int(0, ACOES.length)];
        aplicarAcao(partida, acao, rng);
      }

      partida.update(1 / 120);
      passosNesseTurno += 1;

      conferirSanidade(partida, `semente ${semente}, turno ${turno}, passo ${passosNesseTurno}`);

      if (partida.turnos.turno !== ultimoTurno) {
        ultimoTurno = partida.turnos.turno;
        travouEsperandoAssentar = 0;
      }
      if (partida.fase === ultimaFase) travouEsperandoAssentar += 1;
      else { travouEsperandoAssentar = 0; ultimaFase = partida.fase; }

      assert.ok(
        passosNesseTurno < passosPorTurnoMax,
        `semente ${semente}: turno ${turno} não avançou em ${passosPorTurnoMax} passos (fase presa em '${partida.fase}')`,
      );
    }
  }

  return partida;
}

function aplicarAcao(partida, acao, rng) {
  const { comandos, estado } = partida;
  const dt = 1 / 60;

  switch (acao) {
    case 'andar-': comandos.andar(-1, dt); break;
    case 'andar+': comandos.andar(1, dt); break;
    case 'mirar-': comandos.mirar(-0.05); break;
    case 'mirar+': comandos.mirar(0.05); break;
    case 'pular': comandos.pular('frente'); break;
    case 'cambalhota': comandos.pular('costas'); break;
    case 'arma-': comandos.trocarArmaRelativa(-1); break;
    case 'arma+': comandos.trocarArmaRelativa(1); break;
    case 'pavio': comandos.ajustarPavio(rng.int(1, 6)); break;
    case 'carregar':
      comandos.carregar();
      if (estado.arma.acao === 'jetpack') comandos.impulsoJetpack(dt);
      // Para arma que precisa de carga (bazuca etc.), solta logo em seguida
      // com força parcial — senão a IA-de-mentira nunca dispara nada.
      if (estado.carregando) {
        estado.carga = rng.range(0.3, 1);
        comandos.disparar();
      }
      break;
    default: break;
  }
}

test('fuzz: várias sementes, ações quase ao acaso, nunca NaN e nunca travado', () => {
  for (const semente of [1, 2, 3, 4, 5]) {
    const partida = jogarPartidaAoAcaso(semente);
    // Não importa se ninguém "venceu" dentro do orçamento de turnos — o que
    // importa é ter chegado até aqui sem violar nenhuma invariante.
    assert.ok(partida.turnos.turno >= 0);
  }
});

test('fuzz: todas as armas do arsenal são alcançadas pelo carrossel sem travar', () => {
  // Um teste mais focado: escolhe cada arma do arsenal por vez, disparando
  // cada uma pelo menos uma vez, confirmando que nenhuma arma (nem as
  // recém-chegadas do M5) deixa o jogo num estado inconsistente.
  //
  // Por que não usar `trocarArmaRelativa` como o jogador faria com `[`/`]`:
  // `aoPreparar()` reseta `estado.arma` para a bazuca (`ARMAS[0]`) no início
  // de CADA turno — então percorrer o carrossel com um único passo relativo
  // por turno nunca sai da segunda arma (a bazuca reseta antes do próximo
  // passo relativo ter efeito). Selecionar por id direto evita a suposição
  // errada e testa o arsenal inteiro de fato.
  const partida = createMatch({
    semente: 42,
    camera: criarCameraFalsa(),
    particles: criarParticulasFalsas(),
    tempoTurno: 30,
  });

  for (let i = 0; i < 200; i += 1) partida.update(1 / 120); // sai de PREPARANDO

  const armasVistas = new Set();
  const armasParaTestar = ARMAS.filter((a) => !a.oculta);
  for (const arma of armasParaTestar) {
    if (partida.fimDeJogo) break;

    partida.comandos.trocarArma(arma.id);
    assert.equal(partida.estado.arma.id, arma.id, `trocarArma('${arma.id}') não selecionou a arma pedida`);
    armasVistas.add(partida.estado.arma.id);

    partida.comandos.carregar();
    if (partida.estado.arma.acao === 'jetpack') {
      for (let i = 0; i < 60; i += 1) partida.comandos.impulsoJetpack(1 / 120);
    }
    if (partida.estado.carregando) {
      partida.estado.carga = 0.5;
      partida.comandos.disparar();
    }

    for (let i = 0; i < 120 * 60 && partida.turnos.podeControlar === false && !partida.fimDeJogo; i += 1) {
      partida.update(1 / 120);
      conferirSanidade(partida, `arsenal, arma ${arma.id}, passo ${i}`);
    }

    // A corda não passa a vez sozinha (`encerraTurno: false`) — sem soltar
    // explicitamente ela continua presa, e enquanto presa `trocarArma`
    // ignora qualquer pedido (é a mesma trava que impede trocar de arma
    // pendurado no meio de um balanço), travando o teste na própria corda
    // para sempre.
    if (partida.estado.corda) partida.comandos.carregar();

    // Volta a ficar em condição de agir antes da próxima arma testada
    // (senão a próxima `trocarArma` seria ignorada, presa em ARMA_ATIVA/RECUANDO).
    for (let i = 0; i < 120 * 60 && !partida.turnos.podeAtirar && !partida.fimDeJogo; i += 1) {
      partida.update(1 / 120);
    }
  }

  assert.equal(armasVistas.size, armasParaTestar.length, `só passou por ${armasVistas.size} de ${armasParaTestar.length} armas`);
});
