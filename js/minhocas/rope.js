/**
 * Corda ninja — pivôs empilhados, funções puras, sem DOM e sem terreno
 * concreto (recebe `raio`/`solido` como funções, no mesmo molde de
 * `ballistics.js`, então é testável com um mapa de mentira).
 *
 * A ideia central: a minhoca fica presa a uma distância `L` do pivô ativo.
 * A cada passo ela integra livremente (só gravidade — a corda não é
 * balística) e, se afastou mais que `L`, é projetada de volta para o círculo
 * de raio `L` com a componente RADIAL da velocidade removida — sobra só a
 * tangencial, e é isso que produz o balanço.
 *
 * Se o segmento pivô→minhoca esbarra numa quina do terreno, o ponto de
 * dobra vira um novo pivô empilhado e `L` encolhe para o resto da corda.
 * Quando o balanço reabre para o lado de onde veio, o pivô do topo é
 * removido e `L` volta a crescer.
 */

const GRAVIDADE_PADRAO = 9.81;

function cross(a, b) {
  return a.x * b.y - a.y * b.x;
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Dispara a corda em direção a (alvoX, alvoY). Devolve `null` se não achou
 * onde prender.
 *
 * @param {{x:number,y:number,vx?:number,vy?:number}} origem
 * @param {(x0:number,y0:number,x1:number,y1:number) => {x:number,y:number,t:number}|null} raio
 */
export function lancar(origem, alvoX, alvoY, raio) {
  const hit = raio(origem.x, origem.y, alvoX, alvoY);
  if (!hit) return null;

  const pivo = { x: hit.x, y: hit.y };
  return {
    x: origem.x,
    y: origem.y,
    vx: origem.vx ?? 0,
    vy: origem.vy ?? 0,
    pivos: [pivo],
    // O sentido de cada pivô empilhado (menos o primeiro, que não tem pai e
    // por isso nunca desempilha). Índice 0 é um espaço reservado, não usado.
    sentidos: [0],
    L: dist(origem, pivo),
  };
}

/**
 * Um passo da corda: integra, prende no raio, empilha ou desempilha pivô.
 *
 * @param {object} estado o que `lancar` devolveu (ou o resultado do passo anterior)
 * @param {number} dt
 * @param {{gravidade?:number, raio?:Function, comprimentoMin?:number, comprimentoMax?:number}} [opts]
 */
export function passo(estado, dt, opts = {}) {
  const gravidade = opts.gravidade ?? GRAVIDADE_PADRAO;
  const raio = opts.raio;
  const comprimentoMin = opts.comprimentoMin ?? 1;
  const comprimentoMax = opts.comprimentoMax ?? 60;

  // 1. Integração livre — só gravidade. A corda não é balística: nada de
  // arrasto de ar nem vento puxando a minhoca pendurada.
  const vx = estado.vx;
  const vy = estado.vy - gravidade * dt;
  let x = estado.x + vx * dt;
  let y = estado.y + vy * dt;
  let nvx = vx;
  let nvy = vy;

  // 2. Prende no círculo do pivô ativo: fora dele, projeta de volta e some
  // com a componente radial da velocidade.
  const ativo = estado.pivos[estado.pivos.length - 1];
  const dx = x - ativo.x;
  const dy = y - ativo.y;
  const distancia = Math.hypot(dx, dy);

  if (distancia > estado.L && distancia > 1e-9) {
    const nx = dx / distancia;
    const ny = dy / distancia;
    x = ativo.x + nx * estado.L;
    y = ativo.y + ny * estado.L;
    const vDotN = nvx * nx + nvy * ny;
    nvx -= vDotN * nx;
    nvy -= vDotN * ny;
  }

  let pivos = estado.pivos;
  let sentidos = estado.sentidos;
  let L = estado.L;

  // 3. Novo pivô: o segmento do pivô ativo até a posição atual cruza terreno
  // antes de chegar à minhoca?
  if (raio) {
    const hit = raio(ativo.x, ativo.y, x, y);
    if (hit && hit.t > 1e-3 && hit.t < 1 - 1e-3) {
      const corner = { x: hit.x, y: hit.y };
      const cornerParaPai = { x: ativo.x - corner.x, y: ativo.y - corner.y };
      const cornerParaMinhoca = { x: x - corner.x, y: y - corner.y };
      const sentido = Math.sign(cross(cornerParaPai, cornerParaMinhoca)) || 1;

      pivos = [...pivos, corner];
      sentidos = [...sentidos, sentido];
      L = dist({ x, y }, corner);
    }
  }

  // 4. Desempilha: o ângulo em relação ao pivô anterior reabriu para o
  // outro lado — a quina não segura mais a corda.
  while (pivos.length > 1) {
    const corner = pivos[pivos.length - 1];
    const pai = pivos[pivos.length - 2];
    const cornerParaPai = { x: pai.x - corner.x, y: pai.y - corner.y };
    const cornerParaMinhoca = { x: x - corner.x, y: y - corner.y };
    const atual = Math.sign(cross(cornerParaPai, cornerParaMinhoca));
    const guardado = sentidos[sentidos.length - 1];

    if (atual !== 0 && atual !== guardado) {
      pivos = pivos.slice(0, -1);
      sentidos = sentidos.slice(0, -1);
      L = dist({ x, y }, pivos[pivos.length - 1]);
    } else {
      break;
    }
  }

  return {
    x,
    y,
    vx: nvx,
    vy: nvy,
    pivos,
    sentidos,
    L: Math.max(comprimentoMin, Math.min(comprimentoMax, L)),
  };
}

/** Encolhe (`delta` negativo) ou alonga a corda, dentro dos limites. */
export function ajustarComprimento(estado, delta, opts = {}) {
  const min = opts.comprimentoMin ?? 1;
  const max = opts.comprimentoMax ?? 60;
  return { ...estado, L: Math.max(min, Math.min(max, estado.L + delta)) };
}

/** Solta a corda: devolve o corpo livre, com a velocidade que tinha no instante. */
export function soltar(estado) {
  return { x: estado.x, y: estado.y, vx: estado.vx, vy: estado.vy };
}

/** O pivô ao qual a minhoca está presa agora. */
export function pivoAtivo(estado) {
  return estado.pivos[estado.pivos.length - 1];
}
