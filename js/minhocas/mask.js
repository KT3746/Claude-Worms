/**
 * Máscara do terreno — um byte por pixel, funções puras, sem DOM.
 *
 * É como o Worms original faz, e é o que torna tudo o resto barato: abrir
 * cratera é pintar um círculo num array, e colisão é ler um índice.
 *
 * Espaço de coordenadas: PIXELS, com y crescendo para BAIXO (igual ao
 * `ImageData`). A conversão de metros para cá vive em `terrain.js` — aqui
 * dentro não existe metro nem câmera.
 *
 * Fora dos limites: acima do topo é céu aberto; os lados e o fundo são rocha,
 * de modo que nada escapa do mapa por acidente.
 */

export const AR = 0;
export const TERRA = 1;
export const GRAMA = 2;
export const ROCHA = 3;

/** Espessura da casca de grama, em pixels. */
export const GRAMA_ESPESSURA = 4;

export function createMask(width, height, fill = AR) {
  return {
    width,
    height,
    data: new Uint8Array(width * height).fill(fill),
  };
}

/** Material em (x, y), já tratando o que está fora do mapa. */
export function at(mask, x, y) {
  const px = x | 0;
  const py = y | 0;
  if (py < 0) return AR;
  if (px < 0 || px >= mask.width || py >= mask.height) return ROCHA;
  return mask.data[py * mask.width + px];
}

export function solidAt(mask, x, y) {
  return at(mask, x, y) !== AR;
}

/** Escreve um material sem sair do array (usado pela geração). */
export function setAt(mask, x, y, material) {
  const px = x | 0;
  const py = y | 0;
  if (px < 0 || px >= mask.width || py < 0 || py >= mask.height) return;
  mask.data[py * mask.width + px] = material;
}

/**
 * Abre uma cratera. Rocha não é destruída — é o que segura as bordas do mapa.
 *
 * @returns {{x0:number,y0:number,x1:number,y1:number}|null} região alterada,
 *          já incluindo a faixa abaixo onde a grama precisa ser refeita.
 */
export function carveCircle(mask, cx, cy, radius) {
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(mask.width - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(mask.height - 1, Math.ceil(cy + radius));
  if (x1 < x0 || y1 < y0) return null;

  const r2 = radius * radius;
  let mudou = false;

  for (let y = y0; y <= y1; y += 1) {
    const dy = y - cy;
    const row = y * mask.width;
    for (let x = x0; x <= x1; x += 1) {
      const dx = x - cx;
      if (dx * dx + dy * dy > r2) continue;
      const i = row + x;
      const m = mask.data[i];
      if (m === AR || m === ROCHA) continue;
      mask.data[i] = AR;
      mudou = true;
    }
  }

  if (!mudou) return null;

  const rect = {
    x0,
    y0,
    x1,
    y1: Math.min(mask.height - 1, y1 + GRAMA_ESPESSURA),
  };
  regrowGrass(mask, rect);
  return rect;
}

/** Preenche um círculo com um material (geração de mapa, viga de construção). */
export function fillCircle(mask, cx, cy, radius, material = TERRA) {
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(mask.width - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(mask.height - 1, Math.ceil(cy + radius));
  const r2 = radius * radius;

  for (let y = y0; y <= y1; y += 1) {
    const dy = y - cy;
    for (let x = x0; x <= x1; x += 1) {
      const dx = x - cx;
      if (dx * dx + dy * dy <= r2) mask.data[y * mask.width + x] = material;
    }
  }
  return { x0, y0, x1, y1 };
}

/**
 * Preenche um retângulo com um material — a viga de construção vira isto.
 * Rocha não é sobrescrita, pelo mesmo motivo de `carveCircle`: ela segura a
 * borda do mapa.
 */
export function fillRect(mask, x0, y0, x1, y1, material = TERRA) {
  const ix0 = Math.max(0, Math.floor(Math.min(x0, x1)));
  const ix1 = Math.min(mask.width - 1, Math.ceil(Math.max(x0, x1)));
  const iy0 = Math.max(0, Math.floor(Math.min(y0, y1)));
  const iy1 = Math.min(mask.height - 1, Math.ceil(Math.max(y0, y1)));

  for (let y = iy0; y <= iy1; y += 1) {
    const linha = y * mask.width;
    for (let x = ix0; x <= ix1; x += 1) {
      if (mask.data[linha + x] !== ROCHA) mask.data[linha + x] = material;
    }
  }
  return { x0: ix0, y0: iy0, x1: ix1, y1: iy1 };
}

/**
 * Refaz a casca de grama numa região: pixel sólido com ar até
 * `GRAMA_ESPESSURA` acima vira grama, o resto vira terra. É o que faz a
 * borda de cada cratera nova ganhar verde sozinha.
 */
export function regrowGrass(mask, rect) {
  const x0 = Math.max(0, rect.x0);
  const x1 = Math.min(mask.width - 1, rect.x1);
  const y0 = Math.max(0, rect.y0);
  const y1 = Math.min(mask.height - 1, rect.y1);

  // Uma varredura por coluna, de cima para baixo, contando há quantas linhas
  // não se vê ar. É a mesma pergunta de antes ("tem ar até 4 px acima?"),
  // respondida com uma leitura por pixel em vez de quatro — e a repintura de
  // uma cratera grande é justamente onde o quadro engasgava.
  //
  // A varredura começa `GRAMA_ESPESSURA` linhas ACIMA do retângulo (sem
  // escrever nelas) só para o contador chegar em `y0` já sabendo o que havia
  // em cima, exatamente como o laço de trás pra frente enxergava.
  for (let x = x0; x <= x1; x += 1) {
    const inicio = Math.max(0, y0 - GRAMA_ESPESSURA);
    // Acima do topo do mapa é céu aberto (ver `at`): quem começa na linha 0
    // tem ar a exatamente uma linha de distância, não rocha. Começar em 0
    // aqui (em vez de 1) desloca a conta em um e faz a grama descer um pixel
    // a mais do que deveria — foi o que a prova de equivalência pegou.
    let desdeOAr = inicio === 0 ? 1 : GRAMA_ESPESSURA + 1;

    for (let y = inicio; y <= y1; y += 1) {
      const i = y * mask.width + x;
      const m = mask.data[i];

      if (y >= y0 && m !== AR && m !== ROCHA) {
        mask.data[i] = desdeOAr <= GRAMA_ESPESSURA ? GRAMA : TERRA;
      }

      desdeOAr = m === AR ? 1 : desdeOAr + 1;
    }
  }
}

/** Há matéria dentro do círculo? Amostra o centro e um anel de 12 pontos. */
export function circleHits(mask, cx, cy, radius) {
  if (solidAt(mask, cx, cy)) return true;
  for (let i = 0; i < 12; i += 1) {
    const a = (i / 12) * Math.PI * 2;
    if (solidAt(mask, cx + Math.cos(a) * radius, cy + Math.sin(a) * radius)) return true;
  }
  return false;
}

/**
 * Primeiro pixel sólido do segmento (x0,y0)→(x1,y1), por DDA.
 *
 * @returns {{x:number, y:number, material:number, t:number}|null}
 *          `t` é a fração percorrida do segmento até o impacto.
 */
export function raycast(mask, x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const passos = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
  const sx = dx / passos;
  const sy = dy / passos;

  let x = x0;
  let y = y0;
  for (let i = 0; i <= passos; i += 1) {
    const material = at(mask, x, y);
    if (material !== AR) {
      return { x, y, material, t: i / passos };
    }
    x += sx;
    y += sy;
  }
  return null;
}

/**
 * Normal aproximada da superfície em (x, y): soma os vetores até os pixels
 * sólidos da vizinhança e devolve o oposto, normalizado. É isso que permite
 * a granada ricochetear numa rampa sem que exista polígono de rampa nenhum.
 *
 * O vetor devolvido está em espaço de pixels (y para baixo).
 */
export function normalAt(mask, x, y, radius = 6) {
  let nx = 0;
  let ny = 0;

  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const d2 = dx * dx + dy * dy;
      if (d2 === 0 || d2 > radius * radius) continue;
      if (!solidAt(mask, x + dx, y + dy)) continue;
      const d = Math.sqrt(d2);
      nx -= dx / d;
      ny -= dy / d;
    }
  }

  const len = Math.hypot(nx, ny);
  if (len < 1e-6) return { x: 0, y: -1 }; // sem informação: aponta para cima
  return { x: nx / len, y: ny / len };
}
