/**
 * A máquina de estados da partida — pura, sem canvas e sem terreno.
 *
 * Ela não conhece minhoca nem explosão: recebe a cada passo um contexto com
 * "tudo parado?", "quantos projéteis no ar?" e "quantas equipes vivas?", e
 * avisa o resto do jogo por ganchos. Isso é o que a torna testável de ponta a
 * ponta sem montar um mundo.
 *
 *   PREPARANDO → JOGANDO → ARMA_ATIVA → RECUANDO → ASSENTANDO → RESOLVENDO ─┐
 *        ↑                                                                  │
 *        └──────────────────────────────────────────────────────────────────┘
 *
 * RESOLVENDO pode voltar para ASSENTANDO: uma minhoca que chegou a zero
 * explode, e a explosão dela pode derrubar outra. É a corrente de mortes que
 * o jogo original tem.
 */

export const FASE = {
  PREPARANDO: 'preparando',
  JOGANDO: 'jogando',
  ARMA_ATIVA: 'arma_ativa',
  RECUANDO: 'recuando',
  ASSENTANDO: 'assentando',
  RESOLVENDO: 'resolvendo',
  FIM: 'fim',
};

const SEM_GANCHO = () => {};

export function createTurnMachine({
  tempoTurno = 45,
  tempoRecuo = 3,
  tempoPreparo = 1.1,
  equipes = 2,
  rodadasParaMorteSubita = 10,
  hooks = {},
} = {}) {
  const ao = {
    aoPreparar: SEM_GANCHO,
    aoJogar: SEM_GANCHO,
    aoDisparar: SEM_GANCHO,
    aoRecuar: SEM_GANCHO,
    aoResolver: () => false,
    aoMorteSubita: SEM_GANCHO,
    aoSubirAgua: SEM_GANCHO,
    aoFim: SEM_GANCHO,
    ...hooks,
  };

  const m = {
    fase: FASE.PREPARANDO,
    tempo: tempoPreparo,   // conta regressiva da fase atual
    relogio: tempoTurno,   // o relógio do turno, que congela no tiro
    turno: 0,
    rodada: 0,
    morteSubita: false,
    vencedor: null,
    armaEmVoo: null,

    get podeControlar() {
      return m.fase === FASE.JOGANDO || m.fase === FASE.RECUANDO;
    },

    get podeAtirar() {
      return m.fase === FASE.JOGANDO;
    },

    /** Chamado pelo jogo quando a arma é efetivamente disparada. */
    disparou(arma) {
      if (m.fase !== FASE.JOGANDO) return false;
      m.armaEmVoo = arma;
      ao.aoDisparar(arma);
      if (arma?.recuoImediato || arma?.tipo === 'soltavel') {
        entrar(FASE.RECUANDO, tempoRecuo);
        ao.aoRecuar();
      } else {
        entrar(FASE.ARMA_ATIVA, 0);
      }
      return true;
    },

    /** Encerra a jogada sem tiro (tempo esgotado, minhoca morreu). */
    forcarFimDeTurno() {
      if (m.fase === FASE.FIM) return;
      entrar(FASE.ASSENTANDO, 0);
    },

    encerrar(vencedor) {
      m.vencedor = vencedor;
      m.fase = FASE.FIM;
      ao.aoFim(vencedor);
    },

    /**
     * @param {number} dt
     * @param {{tudoParado:boolean, projeteisAtivos:number, equipesVivas:number}} ctx
     */
    update(dt, ctx) {
      if (m.fase === FASE.FIM) return;
      m.tempo -= dt;

      switch (m.fase) {
        case FASE.PREPARANDO:
          if (m.tempo <= 0) {
            m.relogio = tempoTurno;
            entrar(FASE.JOGANDO, tempoTurno);
            ao.aoJogar();
          }
          break;

        case FASE.JOGANDO:
          m.relogio = Math.max(0, m.relogio - dt);
          if (m.relogio <= 0) entrar(FASE.ASSENTANDO, 0);
          break;

        case FASE.ARMA_ATIVA:
          // O relógio do turno fica congelado enquanto o tiro resolve.
          if (ctx.projeteisAtivos === 0) {
            entrar(FASE.RECUANDO, tempoRecuo);
            ao.aoRecuar();
          }
          break;

        case FASE.RECUANDO:
          if (m.tempo <= 0) entrar(FASE.ASSENTANDO, 0);
          break;

        case FASE.ASSENTANDO:
          // Só passa a vez quando TODO corpo parou. Sem isso, o turno
          // seguinte começaria com uma minhoca ainda caindo.
          if (ctx.tudoParado && ctx.projeteisAtivos === 0) {
            entrar(FASE.RESOLVENDO, 0);
          }
          break;

        case FASE.RESOLVENDO: {
          // O gancho devolve true quando algo aconteceu (morte, explosão em
          // cadeia): nesse caso volta a esperar tudo assentar.
          const houveMais = ao.aoResolver();
          if (houveMais) {
            entrar(FASE.ASSENTANDO, 0);
            break;
          }
          if (ctx.equipesVivas <= 1) {
            m.encerrar(ctx.equipesVivas === 1 ? ctx.equipeVencedora ?? null : null);
            break;
          }
          proximoTurno();
          break;
        }

        default:
          break;
      }
    },
  };

  function entrar(fase, tempo) {
    m.fase = fase;
    m.tempo = tempo;
  }

  function proximoTurno() {
    m.turno += 1;
    m.armaEmVoo = null;

    const rodada = Math.floor(m.turno / Math.max(1, equipes));
    if (rodada !== m.rodada) {
      m.rodada = rodada;
      if (!m.morteSubita && m.rodada >= rodadasParaMorteSubita) {
        m.morteSubita = true;
        ao.aoMorteSubita();
      }
    }
    if (m.morteSubita) ao.aoSubirAgua();

    entrar(FASE.PREPARANDO, tempoPreparo);
    ao.aoPreparar(m.turno);
  }

  ao.aoPreparar(0);
  return m;
}
