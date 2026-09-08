import test from 'node:test';
import assert from 'node:assert/strict';

import { createTurnMachine, FASE } from '../js/minhocas/turn.js';

const PARADO = { tudoParado: true, projeteisAtivos: 0, equipesVivas: 2 };
const EM_VOO = { tudoParado: false, projeteisAtivos: 1, equipesVivas: 2 };

/** Avança a máquina `segundos` em passos de 1/60, com o mesmo contexto. */
function rodar(m, segundos, ctx = PARADO) {
  const passos = Math.round(segundos * 60);
  for (let i = 0; i < passos; i += 1) m.update(1 / 60, ctx);
}

test('a partida começa preparando e vira jogada sozinha', () => {
  const m = createTurnMachine({ tempoPreparo: 1 });
  assert.equal(m.fase, FASE.PREPARANDO);
  assert.equal(m.podeAtirar, false, 'não dá para atirar antes da vez começar');

  rodar(m, 1.1);
  assert.equal(m.fase, FASE.JOGANDO);
  assert.equal(m.podeAtirar, true);
});

test('o relógio do turno conta para baixo e a vez passa quando ele zera', () => {
  const m = createTurnMachine({ tempoPreparo: 0, tempoTurno: 5, tempoRecuo: 0 });
  rodar(m, 0.05);
  assert.equal(m.fase, FASE.JOGANDO);

  rodar(m, 3);
  assert.ok(m.relogio > 1.8 && m.relogio < 2.2, `relógio em ${m.relogio}`);
  assert.equal(m.turno, 0, 'a vez ainda é a mesma');

  rodar(m, 2.3);
  assert.equal(m.turno, 1, 'tempo esgotado passa a vez');
  assert.ok(m.relogio > 4.5, 'a vez nova começa com o relógio cheio');
});

test('o relógio congela enquanto o tiro está no ar', () => {
  const m = createTurnMachine({ tempoPreparo: 0, tempoTurno: 30 });
  rodar(m, 0.05);
  rodar(m, 2);

  const antes = m.relogio;
  m.disparou({ tipo: 'projetil' });
  assert.equal(m.fase, FASE.ARMA_ATIVA);

  rodar(m, 3, EM_VOO);
  assert.equal(m.relogio, antes, 'o relógio não pode andar durante o tiro');
});

test('depois do tiro resolver vem o tempo de recuo', () => {
  const m = createTurnMachine({ tempoPreparo: 0, tempoRecuo: 3 });
  rodar(m, 0.05);
  m.disparou({ tipo: 'projetil' });

  rodar(m, 1, EM_VOO);
  assert.equal(m.fase, FASE.ARMA_ATIVA);

  m.update(1 / 60, PARADO); // projétil sumiu
  assert.equal(m.fase, FASE.RECUANDO);
  assert.equal(m.podeControlar, true, 'durante o recuo ainda se controla a minhoca');
  assert.equal(m.podeAtirar, false, 'mas não se atira de novo');
});

test('arma que se larga no chão dá recuo na hora', () => {
  const m = createTurnMachine({ tempoPreparo: 0 });
  rodar(m, 0.05);
  m.disparou({ tipo: 'soltavel' });
  assert.equal(m.fase, FASE.RECUANDO, 'com dinamite o recuo começa imediatamente');
});

test('a vez só passa quando TUDO parou', () => {
  // Uma minhoca ainda caindo: parou de haver projétil, mas o mundo se mexe.
  const AGITADO = { tudoParado: false, projeteisAtivos: 0, equipesVivas: 2 };

  const m = createTurnMachine({ tempoPreparo: 0, tempoRecuo: 0.5 });
  rodar(m, 0.05);
  m.disparou({ tipo: 'projetil' });
  m.update(1 / 60, PARADO);
  assert.equal(m.fase, FASE.RECUANDO);

  rodar(m, 0.6, AGITADO);
  assert.equal(m.fase, FASE.ASSENTANDO);

  rodar(m, 5, AGITADO);
  assert.equal(m.fase, FASE.ASSENTANDO, 'não pode passar a vez com corpo em movimento');
  assert.equal(m.turno, 0);

  rodar(m, 0.1, PARADO);
  assert.equal(m.turno, 1, 'com tudo parado, a vez passa');
});

test('uma morte em cadeia volta a esperar tudo assentar', () => {
  let restantes = 2;
  const m = createTurnMachine({
    tempoPreparo: 0,
    tempoRecuo: 0,
    hooks: {
      aoResolver() {
        // Simula duas rodadas de mortes encadeadas.
        if (restantes > 0) { restantes -= 1; return true; }
        return false;
      },
    },
  });

  rodar(m, 0.05);
  m.forcarFimDeTurno();
  assert.equal(m.fase, FASE.ASSENTANDO);

  m.update(1 / 60, PARADO); // assentou: vai resolver
  m.update(1 / 60, PARADO); // resolveu uma morte: volta a assentar
  assert.equal(m.fase, FASE.ASSENTANDO, 'a primeira morte joga de volta para assentar');
  assert.equal(restantes, 1, 'uma morte de cada vez');

  rodar(m, 0.2, PARADO);
  assert.equal(restantes, 0, 'todas as mortes encadeadas foram resolvidas');
  assert.equal(m.turno, 1);
});

test('a morte súbita entra depois do número de rodadas configurado', () => {
  const eventos = [];
  const m = createTurnMachine({
    tempoPreparo: 0,
    tempoTurno: 0.2,
    tempoRecuo: 0,
    equipes: 2,
    rodadasParaMorteSubita: 2,
    hooks: {
      aoMorteSubita: () => eventos.push('morte-subita'),
      aoSubirAgua: () => eventos.push('agua'),
    },
  });

  // Quatro turnos = duas rodadas com duas equipes.
  for (let i = 0; i < 6; i += 1) rodar(m, 0.3, PARADO);

  assert.equal(m.morteSubita, true);
  assert.equal(eventos.filter((e) => e === 'morte-subita').length, 1, 'anuncia uma vez só');
  assert.ok(eventos.includes('agua'), 'a partir dali a água sobe a cada turno');
});

test('sobrando uma equipe, a partida acaba com vencedor', () => {
  const vencedora = { nome: 'Azuis' };
  let fim = null;
  const m = createTurnMachine({
    tempoPreparo: 0,
    tempoRecuo: 0,
    hooks: { aoFim: (v) => { fim = v; } },
  });

  rodar(m, 0.05);
  m.forcarFimDeTurno();
  rodar(m, 0.2, { tudoParado: true, projeteisAtivos: 0, equipesVivas: 1, equipeVencedora: vencedora });

  assert.equal(m.fase, FASE.FIM);
  assert.equal(fim, vencedora);
});

test('sem ninguém vivo, a partida acaba empatada', () => {
  const m = createTurnMachine({ tempoPreparo: 0, tempoRecuo: 0 });
  rodar(m, 0.05);
  m.forcarFimDeTurno();
  rodar(m, 0.2, { tudoParado: true, projeteisAtivos: 0, equipesVivas: 0 });

  assert.equal(m.fase, FASE.FIM);
  assert.equal(m.vencedor, null);
});

test('a máquina parada no fim ignora updates', () => {
  const m = createTurnMachine({ tempoPreparo: 0 });
  m.encerrar(null);
  const turnoAntes = m.turno;
  rodar(m, 10, PARADO);
  assert.equal(m.turno, turnoAntes);
});

test('não dá para atirar duas vezes no mesmo turno', () => {
  const m = createTurnMachine({ tempoPreparo: 0 });
  rodar(m, 0.05);
  assert.equal(m.disparou({ tipo: 'projetil' }), true);
  assert.equal(m.disparou({ tipo: 'projetil' }), false, 'o segundo tiro tem de ser recusado');
});

test('as duas últimas equipes se eliminam no mesmo instante: o vencedor é decidido só depois que a resolução para de encontrar mortes', () => {
  // Simula uma corrente: a primeira chamada de aoResolver "mata" as duas
  // últimas equipes de uma vez e devolve true (ainda não é definitivo); só
  // na chamada seguinte, sem mais nada para resolver, é que o contexto
  // fresco (equipesVivas já refletindo as mortes) pode decidir o fim.
  let resolvidoUmaVez = false;

  const m = createTurnMachine({
    tempoPreparo: 0,
    tempoRecuo: 0,
    hooks: {
      aoResolver: () => {
        if (!resolvidoUmaVez) {
          resolvidoUmaVez = true;
          return true;
        }
        return false;
      },
    },
  });

  rodar(m, 0.05);
  m.forcarFimDeTurno(); // -> ASSENTANDO

  // Cada `update` processa exatamente UMA transição, com o contexto que
  // recebeu naquela chamada — é assim que match.js usa a máquina de verdade
  // (chama `contexto()` de novo a cada quadro). Por isso o teste avança
  // passo a passo, não com `rodar`, que reusa o mesmo contexto várias vezes.
  m.update(1 / 60, PARADO); // ASSENTANDO -> RESOLVENDO
  assert.equal(m.fase, FASE.RESOLVENDO);

  m.update(1 / 60, PARADO); // aoResolver() mata as duas equipes, devolve true -> ASSENTANDO
  assert.equal(m.fase, FASE.ASSENTANDO, 'depois de uma morte, volta a esperar tudo assentar');
  assert.equal(resolvidoUmaVez, true);

  m.update(1 / 60, PARADO); // ASSENTANDO -> RESOLVENDO de novo
  assert.equal(m.fase, FASE.RESOLVENDO);

  // Só agora chega o contexto fresco, já refletindo o pós-morte.
  m.update(1 / 60, { tudoParado: true, projeteisAtivos: 0, equipesVivas: 0 });

  assert.equal(m.fase, FASE.FIM, 'com ninguém vivo, a partida tem de terminar');
  assert.equal(m.vencedor, null, 'nenhuma equipe sobrou: empate, não vitória de ninguém');
});

test('uma equipe sobrevive por pouco: o vencedor é o que o contexto fresco diz depois da última morte', () => {
  const vencedora = { nome: 'Sobreviventes' };
  let resolvidoUmaVez = false;

  const m = createTurnMachine({
    tempoPreparo: 0,
    tempoRecuo: 0,
    hooks: {
      aoResolver: () => {
        if (!resolvidoUmaVez) {
          resolvidoUmaVez = true;
          return true;
        }
        return false;
      },
    },
  });

  rodar(m, 0.05);
  m.forcarFimDeTurno();
  m.update(1 / 60, PARADO); // ASSENTANDO -> RESOLVENDO
  m.update(1 / 60, PARADO); // primeira morte -> ASSENTANDO
  m.update(1 / 60, PARADO); // ASSENTANDO -> RESOLVENDO de novo

  m.update(1 / 60, { tudoParado: true, projeteisAtivos: 0, equipesVivas: 1, equipeVencedora: vencedora });

  assert.equal(m.fase, FASE.FIM);
  assert.equal(m.vencedor, vencedora);
});
