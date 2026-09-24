/**
 * Caixa de vida que cai de paraquedas.
 *
 * Física própria e bem simples: com o paraquedas aberto desce devagar e
 * deriva com o vento; depois de pousar, perde o paraquedas e, se o chão for
 * cavado embaixo dela, cai de novo em queda livre. Nada aqui desenha nem
 * toca som — isso fica com `match.js`; o módulo é puro e testável.
 */

export const LADO = 0.6;          // m — a caixa é um quadrado
export const VIDA_DA_CAIXA = 25;  // quanto cura quem pega
export const QUEDA_PARAQUEDAS = 2.4; // m/s de descida com o paraquedas aberto
const QUEDA_MAXIMA = 20;          // m/s em queda livre
const DERIVA_VENTO = 0.12;        // fração do vento que empurra o paraquedas
const PASSO_MAX = 0.05;           // m por sub-passo — evita atravessar chão fino

const MEIO = LADO / 2;

export function createCrate({ x, y, valor = VIDA_DA_CAIXA }) {
  return { x, y, vy: 0, valor, paraquedas: true, apoiada: false, tempo: 0 };
}

/** Algum dos três pontos da base (meio e quinas) está em cima de chão? */
function baseBate(terreno, x, y) {
  return (
    terreno.solidoEm(x, y) ||
    terreno.solidoEm(x - MEIO * 0.9, y) ||
    terreno.solidoEm(x + MEIO * 0.9, y)
  );
}

/**
 * Um passo de física. `y` é a BASE da caixa (como os pés da minhoca).
 * `env` = { gravidade, vento, largura }.
 */
export function atualizarCaixa(c, terreno, dt, { gravidade, vento = 0, largura = Infinity }) {
  c.tempo += dt;

  if (baseBate(terreno, c.x, c.y - 0.02)) {
    c.vy = 0;
    c.paraquedas = false;
    c.apoiada = true;
    return;
  }
  c.apoiada = false;

  if (c.paraquedas) {
    c.vy = -QUEDA_PARAQUEDAS;
    c.x = Math.max(1, Math.min(largura - 1, c.x + vento * DERIVA_VENTO * dt));
  } else {
    c.vy = Math.max(-QUEDA_MAXIMA, c.vy - gravidade * dt);
  }

  const total = c.vy * dt;
  const passos = Math.max(1, Math.ceil(Math.abs(total) / PASSO_MAX));
  const passo = total / passos;
  for (let i = 0; i < passos; i += 1) {
    if (baseBate(terreno, c.x, c.y + passo)) {
      c.vy = 0;
      c.paraquedas = false;
      c.apoiada = true;
      return;
    }
    c.y += passo;
  }
}

/** A cápsula da minhoca (pés em `w.y`, altura `alturaMinhoca`) encosta na caixa? */
export function tocaCaixa(c, w, larguraMinhoca, alturaMinhoca) {
  return (
    Math.abs(w.x - c.x) < MEIO + larguraMinhoca / 2 &&
    w.y < c.y + LADO &&
    w.y + alturaMinhoca > c.y
  );
}

/** A explosão em (x, y) de raio `raio` pega a caixa? */
export function explosaoPega(c, x, y, raio) {
  return Math.hypot(c.x - x, c.y + MEIO - y) < raio + MEIO;
}

/**
 * Sorteia uma coluna de pouso: sobre terra firme (não sobre água) e longe
 * das bordas. Devolve null se não achar em algumas tentativas.
 */
export function sortearPouso(terreno, nivelAgua, rng, margem = 6) {
  for (let t = 0; t < 12; t += 1) {
    const x = rng.range(margem, terreno.largura - margem);
    if (terreno.superficieEm(x) > nivelAgua + 1) return { x, y: terreno.altura - 1 };
  }
  return null;
}
