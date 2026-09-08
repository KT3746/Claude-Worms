/**
 * Geração do mapa — pura e determinística a partir de uma semente.
 *
 * A mesma semente sempre produz o mesmo mapa, em qualquer máquina. É isso que
 * deixa um mapa bom virar algo que se compartilha por texto, e que permite ao
 * teste afirmar "a semente 12345 gera este relevo".
 */

import { createMask, setAt, at, regrowGrass, AR, TERRA, ROCHA } from './mask.js';

/** 160 m × 45 m a 20 px por metro. */
export const MAPA_PADRAO = { largura: 3200, altura: 900, ppm: 20 };

const MARGEM_ROCHA = 8; // px de rocha nas laterais
const LEITO_ROCHA = 12; // px de rocha no fundo
const FRACAO_AGUA = 0.9; // linha d'água, em fração da altura do mapa

/**
 * Relevo por deslocamento do ponto médio: começa com dois extremos e vai
 * quebrando cada segmento ao meio com um desvio que diminui a cada nível.
 * Dá cristas e vales em várias escalas, que é o que um relevo natural tem.
 */
function gerarRelevo(largura, altura, rng) {
  const topo = altura * 0.14;
  const base = altura * 0.60;
  const faixa = base - topo;

  // O algoritmo exige uma grade de 2^k + 1 pontos: cada nível quebra os
  // segmentos exatamente ao meio, e só fecha se os extremos já existirem.
  // Rodá-lo direto sobre a largura do mapa faria ele ler pontos vazios.
  let n = 2;
  while (n + 1 < largura) n *= 2;

  const grade = new Float32Array(n + 1);
  grade[0] = rng.range(topo + faixa * 0.12, base - faixa * 0.12);
  grade[n] = rng.range(topo + faixa * 0.12, base - faixa * 0.12);

  let passo = n;
  let amplitude = faixa * 0.5;
  while (passo > 1) {
    const meio = passo >> 1;
    for (let i = 0; i + passo <= n; i += passo) {
      grade[i + meio] = (grade[i] + grade[i + passo]) / 2 + rng.range(-amplitude, amplitude);
    }
    passo = meio;
    amplitude *= 0.52; // cada escala menor desvia menos: cristas grandes, rugas pequenas
  }

  // Reamostra a grade para a largura real do mapa.
  const alturas = new Float32Array(largura);
  for (let x = 0; x < largura; x += 1) {
    const g = ((x / (largura - 1)) * n);
    const i = Math.min(n - 1, Math.floor(g));
    alturas[x] = grade[i] + (grade[i + 1] - grade[i]) * (g - i);
  }

  // Tira as quinas que o algoritmo deixa e trava dentro da faixa jogável.
  for (let volta = 0; volta < 2; volta += 1) {
    for (let x = 1; x < largura - 1; x += 1) {
      alturas[x] = (alturas[x - 1] + alturas[x] * 2 + alturas[x + 1]) / 4;
    }
  }
  for (let x = 0; x < largura; x += 1) {
    alturas[x] = Math.max(topo, Math.min(base, alturas[x]));
  }

  return alturas;
}

/** Ruído de valor numa grade, com interpolação suave. */
function criarRuido(largura, altura, celula, rng) {
  const cols = Math.ceil(largura / celula) + 2;
  const rows = Math.ceil(altura / celula) + 2;
  const grade = new Float32Array(cols * rows);
  for (let i = 0; i < grade.length; i += 1) grade[i] = rng.next();

  const suave = (t) => t * t * (3 - 2 * t);

  return function amostra(x, y) {
    const gx = x / celula;
    const gy = y / celula;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const tx = suave(gx - x0);
    const ty = suave(gy - y0);
    const i = (cx, cy) => grade[Math.min(rows - 1, cy) * cols + Math.min(cols - 1, cx)];
    const a = i(x0, y0) + (i(x0 + 1, y0) - i(x0, y0)) * tx;
    const b = i(x0, y0 + 1) + (i(x0 + 1, y0 + 1) - i(x0, y0 + 1)) * tx;
    return a + (b - a) * ty;
  };
}

/**
 * Passe de limpeza: tira pixel solto e tapa furo de um pixel. Sem isso as
 * cavernas ficam cheias de cascalho de um pixel, que atrapalha a colisão do
 * projétil e fica feio na hora de pintar a grama.
 */
function limpar(mask) {
  const { width, height, data } = mask;
  const copia = data.slice();

  // Índices diretos, sem função auxiliar: são ~23 milhões de leituras e uma
  // chamada por vizinho custaria mais que o resto da geração inteira.
  for (let y = 1; y < height - 1; y += 1) {
    const linha = y * width;
    for (let x = 1; x < width - 1; x += 1) {
      const i = linha + x;
      const atual = copia[i];
      if (atual === ROCHA) continue;

      const cima = i - width;
      const baixo = i + width;
      const vizinhos =
        (copia[cima - 1] !== AR ? 1 : 0) + (copia[cima] !== AR ? 1 : 0) + (copia[cima + 1] !== AR ? 1 : 0) +
        (copia[i - 1] !== AR ? 1 : 0) + (copia[i + 1] !== AR ? 1 : 0) +
        (copia[baixo - 1] !== AR ? 1 : 0) + (copia[baixo] !== AR ? 1 : 0) + (copia[baixo + 1] !== AR ? 1 : 0);

      if (atual !== AR && vizinhos <= 2) data[i] = AR;
      else if (atual === AR && vizinhos >= 7) data[i] = TERRA;
    }
  }
}

/**
 * Pontos de nascimento: superfície plana, fora d'água, com teto livre.
 * São escolhidos espaçados para nenhuma equipe começar encurralada.
 */
function acharNascimentos(mask, alturas, nivelAgua, ppm) {
  const candidatos = [];
  const largura = mask.width;
  const folga = Math.round(ppm * 1.6); // teto livre acima da minhoca
  const passo = Math.max(4, Math.round(ppm * 0.4));

  for (let x = MARGEM_ROCHA + 20; x < largura - MARGEM_ROCHA - 20; x += passo) {
    // Primeiro pixel sólido de cima para baixo.
    let y = 0;
    while (y < mask.height && at(mask, x, y) === AR) y += 1;
    if (y >= mask.height || y > nivelAgua - folga) continue;

    // Teto livre?
    let livre = true;
    for (let k = 1; k <= folga; k += 1) {
      if (at(mask, x, y - k) !== AR) { livre = false; break; }
    }
    if (!livre) continue;

    // Plano o bastante? Compara com os vizinhos a meia largura de minhoca.
    const meia = Math.round(ppm * 0.5);
    const desnivel = Math.abs(alturas[Math.max(0, x - meia)] - alturas[Math.min(largura - 1, x + meia)]);
    if (desnivel > ppm * 0.5) continue;

    candidatos.push({ x, y });
  }

  return candidatos;
}

/**
 * @param {{largura?:number, altura?:number, ppm?:number, rng:object}} options
 * @returns {{mask:object, alturas:Float32Array, nivelAgua:number, nascimentos:Array, ppm:number}}
 */
export function gerarTerreno({ largura = MAPA_PADRAO.largura, altura = MAPA_PADRAO.altura, ppm = MAPA_PADRAO.ppm, rng }) {
  const mask = createMask(largura, altura, AR);
  const alturas = gerarRelevo(largura, altura, rng);
  const nivelAgua = Math.round(altura * FRACAO_AGUA);

  // 1. Tudo abaixo da linha do relevo vira terra.
  for (let x = 0; x < largura; x += 1) {
    const topo = Math.round(alturas[x]);
    for (let y = topo; y < altura; y += 1) mask.data[y * largura + x] = TERRA;
  }

  // 2. Cavernas: duas oitavas de ruído, com limiar que fecha perto da
  //    superfície (senão o relevo vira renda) e perto do leito.
  const grosso = criarRuido(largura, altura, 96, rng);
  const fino = criarRuido(largura, altura, 38, rng);

  for (let x = 0; x < largura; x += 1) {
    const topo = Math.round(alturas[x]);
    for (let y = topo + 24; y < nivelAgua - 6; y += 1) {
      const profundidade = (y - topo) / Math.max(1, nivelAgua - topo);
      // Mais buraco no miolo, sólido perto da superfície e perto do fundo.
      const janela = Math.sin(Math.min(1, profundidade) * Math.PI);
      const limiar = 0.62 - janela * 0.14;
      const valor = grosso(x, y) * 0.68 + fino(x, y) * 0.32;
      if (valor > limiar) mask.data[y * largura + x] = AR;
    }
  }

  limpar(mask);

  // 3. Rocha indestrutível nas bordas e no leito.
  for (let x = 0; x < largura; x += 1) {
    for (let y = altura - LEITO_ROCHA; y < altura; y += 1) setAt(mask, x, y, ROCHA);
  }
  for (let y = 0; y < altura; y += 1) {
    for (let k = 0; k < MARGEM_ROCHA; k += 1) {
      if (at(mask, k, y) !== AR) setAt(mask, k, y, ROCHA);
      if (at(mask, largura - 1 - k, y) !== AR) setAt(mask, largura - 1 - k, y, ROCHA);
    }
  }

  // 4. Casca de grama no mapa inteiro (depois só as crateras a refazem).
  regrowGrass(mask, { x0: 0, y0: 0, x1: largura - 1, y1: altura - 1 });

  const nascimentos = acharNascimentos(mask, alturas, nivelAgua, ppm);

  return { mask, alturas, nivelAgua, nascimentos, ppm };
}
