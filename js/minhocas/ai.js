/**
 * Adversário de IA: mira, escolhe arma e atira sozinho quando é a vez de um
 * time marcado `ia: true` (ver `criarTime` em `match.js` e a tela de
 * configuração em `ui/screens.js`).
 *
 * O princípio é o mesmo dos controles de tela (`ui/controls.js`): a IA fala
 * com a partida pelos mesmos `comandos` que um jogador usaria — `virar`,
 * `mirar`, `carregar`, `disparar`, `ajustarPavio` — nunca mexendo direto no
 * estado da minhoca. Ela não tem um caminho especial para "trapacear"; só
 * decide antes o que um jogador decidiria na hora.
 *
 * ARSENAL: só o que dá para mirar com uma trajetória calculável — bazuca,
 * morteiro, granada, fragmentação, escopeta, sniper. Corda, jetpack,
 * teleporte, ovelha, míssil guiado, minas, dinamite e viga ficam de fora:
 * cada um tem uma estratégia própria grande o bastante para ser sua própria
 * entrega (mirar uma saliência para prender a corda, decidir quando pousar a
 * ovelha, quando vale a pena se expor para plantar uma mina...). A IA nunca
 * troca para essas armas, então elas continuam existindo só para quem joga
 * de verdade.
 *
 * MOVIMENTO: a IA só anda pra fugir de um alvo fora de alcance — nunca pula,
 * nunca busca cobertura, nunca recua depois de atirar. Quando o melhor tiro
 * achado erra feio E o alvo está longe, ela anda alguns segundos na direção
 * dele antes de mirar (uma vez por turno) e tenta de novo a partir daí; se
 * ainda estiver ruim, atira mesmo assim. Ela pode andar para dentro d'água
 * ou de um buraco no caminho — não olha o terreno antes de decidir andar,
 * só depois de já estar andando (as mesmas regras de colisão de um jogador).
 */

import { simular, GRAVIDADE, ARRASTO, interseccaoSegmentoCirculo } from './ballistics.js';
import { armaPorId } from './weapons.js';
import { FASE } from './turn.js';
import * as Worm from './worm.js';

/** O arsenal que a IA sabe usar — todo o resto (utilitário, dirigível, soltável) fica de fora. */
export const ARMAS_IA = ['bazuca', 'morteiro', 'granada', 'fragmentacao'];

/** Passo de tempo e teto de voo da *busca* — mais grosso que o jogo de
 * verdade (`DT_FISICA` = 1/120): aqui só precisamos do ponto de impacto, não
 * de um desenho fiel da trajetória, e um passo mais largo faz uma centena de
 * simulações por turno custar microssegundos, não milissegundos. */
const PASSO_BUSCA = 1 / 30;
const TEMPO_MAX_BUSCA = 5;

/** Erro de mira das armas de arco — um pouco de imperfeição humana. Os
 * hitscans (escopeta, sniper) não usam isto: no alcance do sniper, uma
 * fração de grau de erro já vira um tiro perdido, e "sniper impreciso" não
 * é um adversário mais justo, só um pior. */
const ERRO_ANGULO = 0.035; // rad, ~2°
const ERRO_POTENCIA = 0.035; // fração da força máxima

/** Quanto a mira gira por segundo enquanto a IA ajusta a pontaria. */
const VELOCIDADE_MIRA = 2.4; // rad/s

/**
 * Acima desta pontuação (metros de erro do melhor tiro achado, já contando
 * a penalidade de fogo amigo), vale mais andar um pouco do que atirar de
 * onde está. Abaixo disto, o erro pode ser só a imprecisão normal da busca
 * em grade — andar não ajudaria o bastante pra valer o tempo do turno.
 */
const LIMITE_PONTUACAO_PARA_ANDAR = 8; // m
const TEMPO_MAX_ANDANDO = 3; // s
const RESERVA_PARA_ATIRAR = 3; // s de relógio que a caminhada nunca consome

/**
 * Quem atirar: o inimigo vivo mais perto, com uma pequena preferência por
 * quem já está machucado — não uma regra rígida de "sempre finalizar", só o
 * bastante para a IA não ignorar um alvo quase morto do lado.
 */
export function escolherAlvo(todas, atacante) {
  let melhor = null;
  let melhorPontuacao = Infinity;
  for (const w of todas) {
    if (!w.vivo || w.equipe === atacante.equipe) continue;
    const distancia = Math.hypot(w.x - atacante.x, w.y - atacante.y);
    const pontuacao = distancia - (100 - w.vida) * 0.08;
    if (pontuacao < melhorPontuacao) {
      melhorPontuacao = pontuacao;
      melhor = w;
    }
  }
  return melhor;
}

/**
 * Escopeta e sniper não têm arco: ou a linha reta até o alvo está livre, ou
 * não têm o que fazer com a arma. Reproduz a mesma checagem de
 * `disparoHitscan()` em match.js (terreno + minhocas no caminho), só que
 * mirando direto no alvo escolhido em vez de sortear o desvio de espalhamento.
 */
export function tiroHitscanValido(arma, origem, alvo, terreno, todas, atacante) {
  const alcance = arma.alcanceMax ?? 40;
  const alvoPos = { x: alvo.x, y: alvo.y + Worm.ALTURA * 0.5 };
  const dx = alvoPos.x - origem.x;
  const dy = alvoPos.y - origem.y;
  const distancia = Math.hypot(dx, dy);
  if (distancia > alcance) return null;

  const destino = { x: origem.x + dx, y: origem.y + dy };
  const impactoTerreno = terreno.raio(origem.x, origem.y, destino.x, destino.y);
  let melhorT = impactoTerreno ? impactoTerreno.t : 1;
  let atingeAlvo = false;

  for (const outra of todas) {
    if (!outra.vivo || outra === atacante) continue;
    const centro = { x: outra.x, y: outra.y + Worm.ALTURA * 0.5 };
    const t = interseccaoSegmentoCirculo(origem, destino, centro, Worm.LARGURA * 0.65);
    if (t !== null && t < melhorT) {
      melhorT = t;
      atingeAlvo = outra === alvo;
    }
  }
  if (!atingeAlvo) return null;

  return {
    angulo: Math.atan2(dy, Math.abs(dx)),
    direcao: dx >= 0 ? 1 : -1,
    poder: 1,
    tempo: 0,
  };
}

/** Onde um tiro de arco (ângulo, direção, potência) cairia, partindo da boca da arma. */
function simularTiro(atacante, arma, angulo, direcao, poder, ambiente, terreno) {
  const boca = Worm.bocaDaArma({ x: atacante.x, y: atacante.y, angulo, direcao });
  const velocidade = arma.velocidadeMax * poder;
  const estado = {
    x: boca.x,
    y: boca.y,
    vx: Math.cos(angulo) * direcao * velocidade,
    vy: Math.sin(angulo) * velocidade,
  };
  return simular(estado, ambiente, (x, y) => terreno.solidoEm(x, y), {
    dt: PASSO_BUSCA,
    tempoMax: TEMPO_MAX_BUSCA,
    passoRegistro: 1e9, // não precisamos dos pontos da trajetória aqui, só do impacto
  });
}

/** Quão bom é um impacto: perto do alvo é bom; perto de um aliado é péssimo. */
function pontuarImpacto(impacto, alvoPos, arma, atacante, todas) {
  if (!impacto) return Infinity;
  const distancia = Math.hypot(impacto.x - alvoPos.x, impacto.y - alvoPos.y);

  let penalidade = 0;
  const limite = arma.raio * 1.3;
  for (const w of todas) {
    if (!w.vivo || w.equipe !== atacante.equipe) continue; // só se preocupa com fogo amigo
    const d = Math.hypot(impacto.x - w.x, impacto.y - w.y);
    if (d < limite) penalidade += 20 + (limite - d) * 6;
  }
  return distancia + penalidade;
}

/**
 * Busca em grade grosseira + refino local em torno do melhor achado. Simples
 * e caro (algumas centenas de trajetórias simuladas), mas roda uma vez por
 * turno, não por quadro — no orçamento de uma decisão, sobra tempo de sobra.
 */
export function buscarTiroArco({ atacante, arma, alvoPos, ambiente, terreno, todas }) {
  const direcao = alvoPos.x >= atacante.x ? 1 : -1;
  let melhor = null;

  function testar(anguloGraus, poder) {
    const angulo = (anguloGraus * Math.PI) / 180;
    const p = Math.max(0.12, Math.min(1, poder));
    const r = simularTiro(atacante, arma, angulo, direcao, p, ambiente, terreno);
    const pontuacao = pontuarImpacto(r.impacto, alvoPos, arma, atacante, todas);
    if (!melhor || pontuacao < melhor.pontuacao) {
      melhor = { angulo, poder: p, pontuacao, impacto: r.impacto, tempo: r.tempo };
    }
  }

  for (let g = -70; g <= 85; g += 7) {
    for (let poder = 0.14; poder <= 1; poder += 0.11) testar(g, poder);
  }

  // Refino: mesma busca, mais fina, só ao redor do melhor achado acima.
  const base = melhor;
  const anguloBaseGraus = (base.angulo * 180) / Math.PI;
  for (let dg = -6; dg <= 6; dg += 1) {
    for (let dp = -0.1; dp <= 0.1; dp += 0.02) testar(anguloBaseGraus + dg, base.poder + dp);
  }

  return { ...melhor, direcao };
}

/**
 * Monta o plano do turno: escolhe alvo, testa o arsenal inteiro (hitscan com
 * linha de visão, arco com a busca acima) e fica com a melhor pontuação.
 * `null` só quando não há ninguém para mirar — não deveria acontecer com a
 * partida em andamento, mas fica seguro em vez de estourar.
 */
export function planejarTurno(partida) {
  const { estado, terreno, todas, rng } = partida;
  const atacante = estado.ativa;
  const alvo = escolherAlvo(todas, atacante);
  if (!alvo) return null;

  const alvoPos = { x: alvo.x, y: alvo.y + Worm.ALTURA * 0.5 };
  const origemAprox = { x: atacante.x, y: atacante.y + Worm.ALTURA * 0.55 };

  const candidatos = [];

  for (const id of ['escopeta', 'sniper']) {
    const arma = armaPorId(id);
    // `origemAprox` (o centro da minhoca) é bom o bastante pra decidir SE a
    // linha está livre, mas o jogo de verdade atira da boca da arma
    // (`disparoHitscan` usa `Worm.bocaDaArma(w, 0.4)`), uns 40 cm à frente —
    // a essa distância o sniper (70 m de alcance) já erraria por uma
    // fração de grau. Acha o ângulo aproximado primeiro, depois refina
    // partindo da boca de verdade nesse ângulo.
    const aproximado = tiroHitscanValido(arma, origemAprox, alvo, terreno, todas, atacante);
    if (!aproximado) continue;
    const boca = Worm.bocaDaArma(
      { x: atacante.x, y: atacante.y, angulo: aproximado.angulo, direcao: aproximado.direcao },
      0.4,
    );
    const tiro = tiroHitscanValido(arma, boca, alvo, terreno, todas, atacante) ?? aproximado;
    // Pontuação baixa e fixa: um hitscan que bate é sempre melhor que um
    // arco que só chega perto, então ganha de qualquer coisa acima de ~5 cm.
    candidatos.push({ arma, ...tiro, pontuacao: 0.05, instantaneo: true });
  }

  for (const id of ARMAS_IA) {
    const arma = armaPorId(id);
    const ambiente = { gravidade: GRAVIDADE, arrasto: ARRASTO, vento: arma.vento ? estado.vento : 0 };
    const tiro = buscarTiroArco({ atacante, arma, alvoPos, ambiente, terreno, todas });
    candidatos.push({ arma, ...tiro, instantaneo: false });
  }

  candidatos.sort((a, b) => a.pontuacao - b.pontuacao);
  const escolhido = candidatos[0];

  let { angulo, poder } = escolhido;
  if (!escolhido.instantaneo) {
    angulo += rng.range(-ERRO_ANGULO, ERRO_ANGULO);
    poder = Math.max(0.12, Math.min(1, poder + rng.range(-ERRO_POTENCIA, ERRO_POTENCIA)));
  }

  return {
    armaId: escolhido.arma.id,
    direcao: escolhido.direcao,
    angulo,
    poder,
    // O pavio conta a partir da soltura, não do primeiro toque no chão — dá
    // pra mirar por cima do tempo de voo até o impacto simulado.
    pavio: escolhido.arma.ajustavel ? Math.max(1, Math.min(5, Math.round(escolhido.tempo ?? 3))) : null,
    // Só para o controlador decidir se vale andar antes de mirar — ver
    // `createAiController`. Não muda como o tiro é executado.
    pontuacao: escolhido.pontuacao,
    instantaneo: escolhido.instantaneo === true,
  };
}

/**
 * O controlador: um observador que roda a cada quadro e, quando é a vez de
 * um time de IA, decide e executa — parado no meio do turno de um humano,
 * ele não faz nada.
 */
export function createAiController(partida) {
  const { estado, turnos, comandos, rng } = partida;

  let turnoPlanejado = -1;
  let fase = 'ocioso'; // 'ocioso' | 'aproximando' | 'mirando' | 'carregando' | 'feito'
  let plano = null;
  let atraso = 0;
  let tempoAproximando = 0;
  // No máximo uma caminhada por turno — sem este limite, uma minhoca que
  // continua fora de alcance mesmo depois de andar ficaria andando pra
  // sempre e nunca chegaria a atirar.
  let jaTentouAproximar = false;

  function equipeDaVez() {
    if (!estado.ativa) return null;
    return partida.times[estado.equipeDaVez];
  }

  function reiniciar() {
    fase = 'ocioso';
    plano = null;
    tempoAproximando = 0;
    jaTentouAproximar = false;
  }

  function update(dt) {
    if (turnos.fase !== FASE.JOGANDO) {
      reiniciar();
      return;
    }

    const time = equipeDaVez();
    if (!time?.ia) {
      reiniciar();
      return;
    }

    // Turno novo (inclusive a primeira minhoca de um time de IA recém-chegado
    // à vez): descarta qualquer plano anterior e decide de novo do zero.
    if (turnoPlanejado !== turnos.turno) {
      turnoPlanejado = turnos.turno;
      reiniciar();
    }

    if (fase === 'ocioso') {
      plano = planejarTurno(partida);
      if (!plano) return; // sem alvo por ora — tenta de novo no próximo quadro

      // O melhor tiro achado ainda erra feio, e o alvo está longe o
      // bastante pra andar ajudar de verdade: tenta se aproximar antes de
      // mirar, em vez de atirar de onde está sabendo que vai errar. Só uma
      // vez por turno — depois disso atira com o que tiver, mesmo que ainda
      // erre; a alternativa seria andar (e gastar o relógio) pra sempre.
      if (!jaTentouAproximar && !plano.instantaneo && plano.pontuacao > LIMITE_PONTUACAO_PARA_ANDAR) {
        jaTentouAproximar = true;
        comandos.virar(plano.direcao);
        tempoAproximando = 0;
        fase = 'aproximando';
        return;
      }

      comandos.trocarArma(plano.armaId);
      comandos.virar(plano.direcao);
      // Uma pausa curta antes de mover a mira: sem ela a IA "reage" no mesmo
      // quadro em que a vez começa, o que não parece uma decisão sendo tomada.
      atraso = rng.range(0.35, 0.7);
      fase = 'mirando';
      return;
    }

    if (fase === 'aproximando') {
      // Sempre sobra tempo pra mirar e atirar depois de andar: o teto de
      // caminhada encolhe conforme o relógio do turno também encolhe.
      const tempoMax = Math.min(TEMPO_MAX_ANDANDO, Math.max(0, turnos.relogio - RESERVA_PARA_ATIRAR));
      if (tempoAproximando >= tempoMax || !estado.ativa?.vivo) {
        fase = 'ocioso'; // replaneja do zero, já (talvez) mais perto
        plano = null;
        return;
      }
      comandos.andar(plano.direcao, dt);
      tempoAproximando += dt;
      return;
    }

    if (fase === 'mirando') {
      if (atraso > 0) {
        atraso -= dt;
        return;
      }
      const diferenca = plano.angulo - estado.ativa.angulo;
      if (Math.abs(diferenca) > 0.01) {
        const passo = Math.sign(diferenca) * Math.min(Math.abs(diferenca), VELOCIDADE_MIRA * dt);
        comandos.mirar(passo);
        return;
      }
      if (plano.pavio != null) comandos.ajustarPavio(plano.pavio);
      // Para escopeta/sniper/soltável isto já dispara na hora — o jogo trata
      // "carregar" sem força pra acumular como "atirar", e a fase abaixo só
      // entra se ainda houver o que esperar.
      comandos.carregar();
      fase = turnos.fase === FASE.JOGANDO && estado.carregando ? 'carregando' : 'feito';
      return;
    }

    if (fase === 'carregando') {
      if (!estado.carregando || estado.carga >= plano.poder - 0.001) {
        comandos.disparar();
        fase = 'feito';
      }
      return;
    }

    // 'feito': só falta a máquina de turnos sair de JOGANDO por conta própria
    // (o tiro dispara essa saída) — nada mais para esta minhoca fazer.
  }

  return { update };
}
