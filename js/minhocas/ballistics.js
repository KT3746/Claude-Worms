/**
 * Balística — funções puras, sem DOM e sem terreno concreto.
 *
 * O terreno entra como uma função `solido(x, y)`, então tudo aqui é testável
 * com um "mapa" de mentira montado à mão.
 *
 * Mundo em metros, y para cima. A integração é a mesma do Arqueiro (Euler
 * semi-implícito com arrasto sobre a velocidade *relativa ao ar*), porque é
 * assim que o vento empurra e freia o projétil com uma regra só.
 */

export const GRAVIDADE = 9.81;
export const ARRASTO = 0.0016;
export const DT_FISICA = 1 / 120;

/** Resolução da colisão varrida: 3 cm, bem abaixo de um pixel de terreno. */
const AMOSTRA = 0.03;

export const AMBIENTE_PADRAO = { gravidade: GRAVIDADE, arrasto: ARRASTO, vento: 0 };

export function lancar(x, y, angulo, velocidade) {
  return {
    x,
    y,
    vx: Math.cos(angulo) * velocidade,
    vy: Math.sin(angulo) * velocidade,
  };
}

/** Um passo de integração. Não modifica o estado recebido. */
export function passo(estado, dt, env = AMBIENTE_PADRAO) {
  const gravidade = env.gravidade ?? GRAVIDADE;
  const arrasto = env.arrasto ?? ARRASTO;
  const vento = env.vento ?? 0;

  const rx = estado.vx - vento;
  const ry = estado.vy;
  const velocidade = Math.hypot(rx, ry);

  const ax = -arrasto * velocidade * rx;
  const ay = -arrasto * velocidade * ry - gravidade;

  const vx = estado.vx + ax * dt;
  const vy = estado.vy + ay * dt;

  return { x: estado.x + vx * dt, y: estado.y + vy * dt, vx, vy };
}

/**
 * Avança um passo e testa o SEGMENTO percorrido contra o terreno.
 *
 * Testar só a posição final deixaria um projétil rápido atravessar uma parede
 * fina entre dois quadros — o bug clássico deste tipo de jogo.
 *
 * @returns {{estado:object, impacto:{x:number,y:number,livreX:number,livreY:number}|null}}
 */
export function avancar(estado, dt, env, solido) {
  const proximo = passo(estado, dt, env);
  const dx = proximo.x - estado.x;
  const dy = proximo.y - estado.y;
  const distancia = Math.hypot(dx, dy);
  const amostras = Math.max(1, Math.ceil(distancia / AMOSTRA));

  let livreX = estado.x;
  let livreY = estado.y;

  for (let i = 1; i <= amostras; i += 1) {
    const t = i / amostras;
    const x = estado.x + dx * t;
    const y = estado.y + dy * t;
    if (solido(x, y)) {
      return { estado: { ...proximo, x, y }, impacto: { x, y, livreX, livreY } };
    }
    livreX = x;
    livreY = y;
  }

  return { estado: proximo, impacto: null };
}

/**
 * Reflete a velocidade numa superfície de normal `n` (unitária, y para cima).
 *
 * @param {number} restituicao 0 = gruda, 1 = ricochete perfeito
 * @param {number} atrito quanto da componente tangencial se perde
 */
export function refletir(estado, n, restituicao = 0.45, atrito = 0.25) {
  const dot = estado.vx * n.x + estado.vy * n.y;
  // Componentes normal e tangencial.
  const nx = n.x * dot;
  const ny = n.y * dot;
  const tx = estado.vx - nx;
  const ty = estado.vy - ny;

  return {
    vx: tx * (1 - atrito) - nx * restituicao,
    vy: ty * (1 - atrito) - ny * restituicao,
  };
}

/**
 * Interseção do segmento p0→p1 com um círculo (centro, raio).
 *
 * Usado pelas armas de precisão (escopeta, sniper): o disparo já sabe onde
 * bate no terreno via `raycast`, e isto resolve se alguma minhoca no caminho
 * é atingida antes — devolve o menor `t` em [0, 1], ou null se não cruza.
 */
export function interseccaoSegmentoCirculo(p0, p1, centro, raio) {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const fx = p0.x - centro.x;
  const fy = p0.y - centro.y;

  // O ponto de partida já está dentro do círculo: acerto imediato em t = 0.
  // Sem isto, a quadrática abaixo devolveria o ponto de SAÍDA do círculo —
  // à queima-roupa, o tiro pareceria atravessar o alvo para acertar atrás dele.
  if (fx * fx + fy * fy <= raio * raio) return 0;

  const a = dx * dx + dy * dy;
  if (a < 1e-9) return null; // segmento degenerado (ponto)

  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - raio * raio;
  const discriminante = b * b - 4 * a * c;
  if (discriminante < 0) return null;

  const raizD = Math.sqrt(discriminante);
  const t1 = (-b - raizD) / (2 * a);
  const t2 = (-b + raizD) / (2 * a);

  if (t1 >= 0 && t1 <= 1) return t1;
  if (t2 >= 0 && t2 <= 1) return t2;
  return null;
}

/**
 * Simula a trajetória inteira. Serve para a linha de mira e para os testes.
 *
 * @returns {{pontos:Array<{x:number,y:number}>, estado:object, tempo:number, impacto:object|null}}
 */
export function simular(estado, env, solido, opts = {}) {
  const dt = opts.dt ?? DT_FISICA;
  const tempoMax = opts.tempoMax ?? 8;
  const passoRegistro = opts.passoRegistro ?? 6;

  let atual = { ...estado };
  const pontos = [{ x: atual.x, y: atual.y }];
  let tempo = 0;
  let impacto = null;
  let i = 0;

  while (tempo < tempoMax) {
    const r = avancar(atual, dt, env, solido);
    atual = r.estado;
    tempo += dt;
    i += 1;
    if (i % passoRegistro === 0) pontos.push({ x: atual.x, y: atual.y });
    if (r.impacto) {
      impacto = r.impacto;
      pontos.push({ x: atual.x, y: atual.y });
      break;
    }
  }

  return { pontos, estado: atual, tempo, impacto };
}
