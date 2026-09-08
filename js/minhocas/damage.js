/**
 * Dano e empurrão — funções puras.
 *
 * São poucas linhas, e são as linhas que definem o equilíbrio do jogo
 * inteiro: por isso ficam isoladas aqui, com teste próprio.
 */

/** Velocidade de queda a partir da qual a minhoca se machuca (m/s). */
export const LIMIAR_QUEDA = 8;

/** Dano por m/s acima do limiar. */
const FATOR_QUEDA = 2.6;

/** Empurrão ganha um viés para cima: minhoca voa, não desliza. */
const VIES_VERTICAL = 0.35;

/**
 * Dano no epicentro caindo linearmente até a borda da explosão.
 * @param {{dano:number, raio:number}} arma
 * @param {number} distancia em metros
 */
export function danoEm(arma, distancia) {
  if (distancia >= arma.raio) return 0;
  return arma.dano * (1 - distancia / arma.raio);
}

/**
 * Empurrão: do centro da explosão para fora, mais forte perto do epicentro.
 * @returns {{x:number, y:number}} impulso em m/s
 */
export function impulsoEm(arma, dx, dy, distancia) {
  if (distancia >= arma.raio) return { x: 0, y: 0 };
  const forca = (arma.impulso ?? 0) * (1 - distancia / arma.raio);

  if (distancia < 1e-4) return { x: 0, y: forca };

  let ux = dx / distancia;
  let uy = dy / distancia + VIES_VERTICAL;
  const len = Math.hypot(ux, uy) || 1;
  ux /= len;
  uy /= len;

  return { x: ux * forca, y: uy * forca };
}

/**
 * Resolve uma explosão contra uma lista de corpos.
 *
 * Não modifica nada: devolve o que aconteceria, para quem chamou aplicar na
 * ordem que quiser (e para o teste conferir sem montar um mundo inteiro).
 *
 * @param {Array<{x:number, y:number, vivo?:boolean}>} corpos
 * @returns {Array<{corpo:object, dano:number, impulso:{x:number,y:number}, distancia:number}>}
 */
export function explosao(corpos, x, y, arma) {
  const efeitos = [];

  for (const corpo of corpos) {
    if (corpo.vivo === false) continue;
    const dx = corpo.x - x;
    const dy = corpo.y - y;
    const distancia = Math.hypot(dx, dy);
    if (distancia >= arma.raio) continue;

    efeitos.push({
      corpo,
      dano: danoEm(arma, distancia),
      impulso: impulsoEm(arma, dx, dy, distancia),
      distancia,
    });
  }

  // Ordem determinística: do mais próximo ao mais distante do epicentro.
  efeitos.sort((a, b) => a.distancia - b.distancia);
  return efeitos;
}

/**
 * Dano de queda. Cair de alto dói; cair de um degrau não.
 * @param {number} velocidadeVertical valor negativo ao cair (m/s)
 */
export function danoDeQueda(velocidadeVertical) {
  const v = Math.abs(velocidadeVertical);
  if (v <= LIMIAR_QUEDA) return 0;
  return Math.min(40, Math.round((v - LIMIAR_QUEDA) * FATOR_QUEDA));
}
