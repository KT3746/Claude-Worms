/**
 * HUD desenhado no canvas: relógio do turno, vento, arma, vida das equipes.
 *
 * O que é botão fica no DOM (`screens.js`); aqui só entra informação que
 * precisa acompanhar o jogo quadro a quadro.
 */

import { FASE } from '../turn.js';
import { ALTURA as ALTURA_MINHOCA } from '../worm.js';

const FUNDO = 'rgba(9, 16, 26, 0.62)';

/**
 * Abaixo desta largura não cabem três blocos lado a lado no topo: o vento e a
 * arma descem para o rodapé, onde em retrato sobra tela de sobra.
 */
const LARGURA_ESTREITA = 620;

/**
 * Onde cada bloco do HUD fica, para esta tela. Calcular a posição num lugar
 * só é o que impede caixas se sobreporem quando a janela encolhe.
 */
function layout(camera, reservaInferior = 0) {
  const estreito = camera.width < LARGURA_ESTREITA;
  const margem = 12;

  if (!estreito) {
    return {
      estreito,
      equipes: { x: margem, y: margem, largura: Math.min(190, camera.width * 0.3) },
      relogio: { x: camera.width / 2 - 48, y: margem, largura: 96, altura: 44 },
      vento: { x: camera.width - 132 - margem, y: margem, largura: 132, altura: 34 },
      arma: { x: camera.width - 168 - margem, y: margem + 42, largura: 168, altura: 38 },
    };
  }

  const meia = (camera.width - margem * 3) / 2;
  // `reservaInferior` é o que os botões de tela ocupam: o rodapé sobe por cima
  // deles em vez de ficar escondido atrás.
  const base = camera.height - 38 - margem - reservaInferior;
  return {
    estreito,
    equipes: { x: margem, y: margem, largura: Math.min(160, camera.width * 0.42) },
    relogio: { x: camera.width - 96 - margem, y: margem, largura: 96, altura: 44 },
    vento: { x: margem, y: base, largura: meia, altura: 38 },
    arma: { x: margem * 2 + meia, y: base, largura: meia, altura: 38 },
  };
}

export function desenharHud(ctx, partida, camera, opcoes = {}) {
  const { estado, turnos } = partida;
  const l = layout(camera, opcoes.reservaInferior ?? 0);
  l.toque = opcoes.toque === true;

  ctx.save();
  ctx.textBaseline = 'top';

  desenharBarrasDeEquipe(ctx, partida, l);
  desenharRelogio(ctx, partida, l);
  desenharVento(ctx, estado, l);
  desenharArma(ctx, estado, l);
  if (estado.tempoMensagem > 0) desenharMensagem(ctx, estado, camera);
  if (turnos.fase === FASE.RECUANDO) desenharRecuo(ctx, turnos, camera);
  if (turnos.morteSubita) desenharMorteSubita(ctx, camera);
  desenharSetaForaDaTela(ctx, estado, camera, opcoes);

  ctx.restore();
}

function caixa(ctx, x, y, largura, altura, raio = 8) {
  ctx.fillStyle = FUNDO;
  ctx.beginPath();
  ctx.roundRect(x, y, largura, altura, raio);
  ctx.fill();
}

function desenharBarrasDeEquipe(ctx, partida, l) {
  const times = partida.times;
  const largura = l.equipes.largura;
  const alturaLinha = 22;
  const x = l.equipes.x;
  let y = l.equipes.y;

  const vidaMaxima = Math.max(
    1,
    ...times.map((t) => t.minhocas.length * 100),
  );

  for (const time of times) {
    caixa(ctx, x, y, largura, alturaLinha, 6);

    const fracao = Math.max(0, time.vida) / vidaMaxima;
    ctx.fillStyle = time.cores.corpo;
    ctx.beginPath();
    ctx.roundRect(x + 3, y + 3, (largura - 6) * fracao, alturaLinha - 6, 4);
    ctx.fill();

    ctx.font = '600 12px system-ui, sans-serif';
    ctx.fillStyle = '#f2f5f8';
    ctx.textAlign = 'left';
    ctx.fillText(time.nome, x + 8, y + 5);
    ctx.textAlign = 'right';
    ctx.fillText(String(Math.max(0, Math.round(time.vida))), x + largura - 8, y + 5);

    y += alturaLinha + 6;
  }
}

function desenharRelogio(ctx, partida, l) {
  const { turnos, estado } = partida;
  const { x, y, largura, altura } = l.relogio;
  const centro = x + largura / 2;

  caixa(ctx, x, y, largura, altura);

  const segundos = Math.ceil(turnos.relogio);
  const urgente = segundos <= 5 && turnos.fase === FASE.JOGANDO;

  ctx.textAlign = 'center';
  ctx.font = `700 24px system-ui, sans-serif`;
  ctx.fillStyle = urgente ? '#ff6b5e' : '#f2f5f8';
  ctx.fillText(String(segundos).padStart(2, '0'), centro, y + 6);

  const time = estado.ativa ? partida.times[estado.equipeDaVez] : null;
  ctx.font = '600 10px system-ui, sans-serif';
  ctx.fillStyle = time ? time.cores.corpo : '#9fb0c0';
  const rotulo = time ? `${time.nome} · ${estado.ativa.nome}${time.ia ? ' · IA' : ''}` : '—';
  ctx.fillText(rotulo.toUpperCase(), centro, y + 31);
}

function desenharVento(ctx, estado, l) {
  const { x, y, largura, altura } = l.vento;

  caixa(ctx, x, y, largura, altura);

  ctx.font = '600 10px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#9fb0c0';
  ctx.fillText('VENTO', x + 10, y + 5);

  // Barra que cresce para o lado em que o vento sopra, centrada na caixa.
  const meia = Math.max(24, Math.min(46, largura / 2 - 20));
  const meio = x + largura / 2;
  const centroY = y + altura - 12;
  const forca = Math.min(1, Math.abs(estado.vento) / 9);
  const dir = Math.sign(estado.vento) || 1;

  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fillRect(meio - meia, centroY - 4, meia * 2, 8);
  ctx.fillStyle = forca > 0.66 ? '#ff8a5e' : forca > 0.33 ? '#ffd24a' : '#7bc65f';
  ctx.fillRect(meio, centroY - 4, dir * meia * forca, 8);
  ctx.fillStyle = '#f2f5f8';
  ctx.fillRect(meio - 1, centroY - 7, 2, 14);

  ctx.textAlign = 'right';
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.fillText(`${Math.abs(estado.vento).toFixed(1)} m/s`, x + largura - 10, y + 5);
}

function desenharArma(ctx, estado, l) {
  const { x, y, largura, altura } = l.arma;

  caixa(ctx, x, y, largura, altura);

  ctx.textAlign = 'left';
  ctx.font = '700 14px system-ui, sans-serif';
  ctx.fillStyle = '#f2f5f8';
  ctx.fillText(estado.arma.nome, x + 10, y + 5);

  ctx.font = '500 10px system-ui, sans-serif';
  ctx.fillStyle = '#9fb0c0';
  const detalhe = detalheDaArma(estado, l.toque);
  ctx.fillText(recortar(ctx, detalhe, largura - 20), x + 10, y + 23);
}

/** O que mostrar na linha de baixo da caixa da arma: estado, não só a dica. */
function detalheDaArma(estado, toque = false) {
  if (estado.corda) return `comprimento: ${estado.corda.L.toFixed(1)} m`;
  if (estado.arma.acao === 'jetpack') return `combustível: ${Math.max(0, estado.jetpackCombustivel).toFixed(1)} s`;
  if (estado.arma.ajustavel) return `pavio ${estado.pavio}s`;
  // Só a corda tem dica que nomeia tecla e chega a ser mostrada aqui.
  return (toque && estado.arma.dicaToque) || estado.arma.dica;
}

/** Corta um texto com reticências para caber na largura pedida. */
function recortar(ctx, texto, largura) {
  if (ctx.measureText(texto).width <= largura) return texto;
  let corte = texto;
  while (corte.length > 1 && ctx.measureText(`${corte}…`).width > largura) {
    corte = corte.slice(0, -1);
  }
  return `${corte.trimEnd()}…`;
}

function desenharMensagem(ctx, estado, camera) {
  const alpha = Math.min(1, estado.tempoMensagem);
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center';
  ctx.font = '700 18px system-ui, sans-serif';

  const largura = ctx.measureText(estado.mensagem).width + 32;
  const x = camera.width / 2 - largura / 2;
  const y = camera.height * 0.16;

  caixa(ctx, x, y, largura, 34, 10);
  ctx.fillStyle = '#ffd24a';
  ctx.fillText(estado.mensagem, camera.width / 2, y + 8);
  ctx.globalAlpha = 1;
}

function desenharRecuo(ctx, turnos, camera) {
  ctx.textAlign = 'center';
  ctx.font = '700 13px system-ui, sans-serif';
  const texto = `CORRA!  ${Math.ceil(Math.max(0, turnos.tempo))}`;
  const largura = ctx.measureText(texto).width + 26;
  const x = camera.width / 2 - largura / 2;
  // Na tela estreita o topo é das barras e do relógio: o aviso desce para o céu.
  const y = camera.width < LARGURA_ESTREITA ? Math.round(camera.height * 0.22) : 62;
  caixa(ctx, x, y, largura, 26, 8);
  ctx.fillStyle = '#ff8a5e';
  ctx.fillText(texto, camera.width / 2, y + 6);
}

function desenharMorteSubita(ctx, camera) {
  const estreito = camera.width < LARGURA_ESTREITA;
  ctx.textAlign = 'center';
  ctx.font = '700 11px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255, 107, 94, 0.9)';
  ctx.fillText('MORTE SÚBITA', camera.width / 2, estreito ? camera.height - 76 : camera.height - 30);
}

/**
 * Seta na borda quando a minhoca da vez está fora da tela — ou só fora da
 * parte visível de verdade, atrás de HUD e botões de toque, o que dá no
 * mesmo para quem está tentando enxergá-la. As mesmas medidas que afastam a
 * câmera desses cantos (ver `setInsets`, em `camera.js`) valem aqui: sem
 * elas a seta ficaria escondida bem no momento em que mais faria falta.
 */
function desenharSetaForaDaTela(ctx, estado, camera, opcoes = {}) {
  const w = estado.ativa;
  if (!w?.vivo) return;

  const p = camera.toScreen(w.x, w.y + ALTURA_MINHOCA);
  const margemX = 30 + (opcoes.reservaLateral ?? 0);
  const margemTopo = 30 + (opcoes.reservaTopo ?? 0);
  const margemBase = 30 + (opcoes.reservaInferior ?? 0);
  if (p.x >= margemX && p.x <= camera.width - margemX && p.y >= margemTopo && p.y <= camera.height - margemBase) {
    return;
  }

  const x = Math.max(margemX, Math.min(camera.width - margemX, p.x));
  const y = Math.max(margemTopo, Math.min(camera.height - margemBase, p.y));
  const angulo = Math.atan2(p.y - y, p.x - x);

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angulo);
  ctx.fillStyle = '#ffd24a';
  ctx.beginPath();
  ctx.moveTo(12, 0);
  ctx.lineTo(-6, -8);
  ctx.lineTo(-6, 8);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Rodapé com os controles, nos primeiros turnos. */
export function desenharDica(ctx, partida, camera, opcoes = {}) {
  if (partida.turnos.turno > 1) return;

  const estreito = camera.width < LARGURA_ESTREITA;
  const toque = opcoes.toque === true;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.font = '500 12px system-ui, sans-serif';

  /**
   * Onde a dica cabe depende de qual vizinho ela tem naquele canto.
   *
   * Em tela estreita o rodapé inteiro é do vento e da arma, que já subiram por
   * causa dos botões: a dica sobe junto e tem a largura toda. Em tela larga o
   * rodapé é livre no meio — os botões de toque ficam nos dois cantos —, então
   * ela continua embaixo e o que falta é largura, não altura.
   */
  const baseY = estreito
    ? camera.height - 62 - (opcoes.reservaInferior ?? 0)
    : camera.height - 16;
  const caber = camera.width - 24 - (estreito ? 0 : (opcoes.reservaLateral ?? 0) * 2);

  const [longa, curta] = toque
    ? ['◀ ▶ anda · ▲ ▼ mira · segure FOGO e solte · arraste para mirar · segure 🗺️ para ver o mapa',
       '◀ ▶ anda · ▲ ▼ mira · segure FOGO']
    : ['← → anda · ↑ ↓ mira · Espaço segura e solta · Enter pula · [ ] arma · segure M para ver o mapa',
       '← → anda · ↑ ↓ mira · Espaço atira'];

  // A versão longa só entra se couber inteira: meia frase cortada com
  // reticências ensina menos que a frase curta completa.
  const texto = ctx.measureText(longa).width + 28 <= caber ? longa : curta;
  const visivel = recortar(ctx, texto, caber - 28);
  const largura = Math.min(caber, ctx.measureText(visivel).width + 28);

  ctx.fillStyle = FUNDO;
  ctx.beginPath();
  ctx.roundRect(camera.width / 2 - largura / 2, baseY - 28, largura, 28, 8);
  ctx.fill();
  ctx.fillStyle = '#c8d4e0';
  ctx.fillText(visivel, camera.width / 2, baseY - 7);
  ctx.restore();
}
