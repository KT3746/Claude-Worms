/**
 * Canvas grande fatiado em blocos, com marcação da REGIÃO suja de cada bloco.
 *
 * Um canvas de milhares de pixels de largura passa do limite de textura de
 * vários navegadores móveis e é caro de repintar inteiro. Aqui o desenho é
 * dividido em blocos quadrados, e cada bloco guarda o retângulo que precisa
 * ser refeito — uma cratera de 130 px não custa um bloco de 512 × 512.
 */

/**
 * Um contexto 2D de mentira, para quando não há Canvas nenhum disponível
 * (testes em Node). Aceita as mesmas chamadas de `pintarBloco` sem desenhar
 * de verdade — o que a lógica de jogo precisa é a contabilidade de blocos
 * sujos, nunca o pixel final.
 */
function contextoFalso() {
  return {
    createImageData: (w, h) => ({
      width: w,
      height: h,
      data: new Uint8ClampedArray(Math.max(0, w) * Math.max(0, h) * 4),
    }),
    putImageData() {},
    drawImage() {},
    fillRect() {},
    clearRect() {},
  };
}

function makeCanvas(width, height) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  // Sem navegador nenhum por perto: um canvas de mentira, só para o resto
  // do código poder chamar `.getContext('2d')` sem quebrar.
  return { width, height, getContext: () => contextoFalso() };
}

/**
 * @param {{width:number, height:number, size?:number,
 *          paint:(ctx:CanvasRenderingContext2D, bloco:object, area:{x0:number,y0:number,x1:number,y1:number}) => void}} options
 */
export function createChunks({ width, height, size = 512, paint }) {
  const cols = Math.ceil(width / size);
  const rows = Math.ceil(height / size);
  const list = [];

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = col * size;
      const y = row * size;
      const w = Math.min(size, width - x);
      const h = Math.min(size, height - y);
      const canvas = makeCanvas(w, h);
      list.push({
        col,
        row,
        x,
        y,
        width: w,
        height: h,
        canvas,
        ctx: canvas.getContext('2d'),
        /** Região local a repintar, ou null se o bloco está em dia. */
        sujo: { x0: 0, y0: 0, x1: w - 1, y1: h - 1 },
      });
    }
  }

  /** Cresce a região suja de um bloco para cobrir também `rect` (local). */
  function unir(bloco, x0, y0, x1, y1) {
    if (!bloco.sujo) {
      bloco.sujo = { x0, y0, x1, y1 };
      return;
    }
    const s = bloco.sujo;
    if (x0 < s.x0) s.x0 = x0;
    if (y0 < s.y0) s.y0 = y0;
    if (x1 > s.x1) s.x1 = x1;
    if (y1 > s.y1) s.y1 = y1;
  }

  const chunks = {
    list,
    size,
    cols,
    rows,
    width,
    height,

    /** Marca como suja a região (em pixels globais) em todo bloco que ela toca. */
    markRect(x0, y0, x1, y1) {
      const c0 = Math.max(0, Math.floor(x0 / size));
      const c1 = Math.min(cols - 1, Math.floor(x1 / size));
      const r0 = Math.max(0, Math.floor(y0 / size));
      const r1 = Math.min(rows - 1, Math.floor(y1 / size));

      for (let row = r0; row <= r1; row += 1) {
        for (let col = c0; col <= c1; col += 1) {
          const bloco = list[row * cols + col];
          unir(
            bloco,
            Math.max(0, Math.floor(x0) - bloco.x),
            Math.max(0, Math.floor(y0) - bloco.y),
            Math.min(bloco.width - 1, Math.ceil(x1) - bloco.x),
            Math.min(bloco.height - 1, Math.ceil(y1) - bloco.y),
          );
        }
      }
    },

    markAll() {
      for (const bloco of list) {
        bloco.sujo = { x0: 0, y0: 0, x1: bloco.width - 1, y1: bloco.height - 1 };
      }
    },

    /**
     * Repinta região suja até gastar `orcamento` PIXELS, e devolve quantos
     * blocos encostou. O orçamento é por área, não por bloco, porque a
     * região suja de um bloco é o retângulo que ENVOLVE tudo que sujou
     * nele: duas crateras em cantos opostos do mesmo bloco viram um
     * retângulo de 512 × 512 (~10 ms de repintura), e um limite contado em
     * blocos deixava dois desses caírem no mesmo quadro — o engasgo visível
     * depois de uma explosão grande.
     *
     * O que não couber no orçamento continua sujo e é repintado nos quadros
     * seguintes, em faixas horizontais: `putImageData` escreve na altura que
     * receber, então uma faixa por vez compõe a imagem final sem emenda. A
     * máscara já está correta para a física antes da primeira faixa — o
     * atraso é só de desenho, nunca de colisão.
     */
    repaint(orcamento = Infinity) {
      let gasto = 0;
      let blocos = 0;

      for (const bloco of list) {
        if (!bloco.sujo) continue;
        if (gasto >= orcamento) break;

        const s = bloco.sujo;
        const largura = s.x1 - s.x0 + 1;
        const alturaSuja = s.y1 - s.y0 + 1;
        if (largura <= 0 || alturaSuja <= 0) {
          bloco.sujo = null;
          continue;
        }

        // Ao menos uma linha por bloco, sempre: um orçamento apertado pode
        // atrasar a repintura, nunca parar de progredir.
        const cabem = Math.max(1, Math.floor((orcamento - gasto) / largura));
        const linhas = Math.min(alturaSuja, cabem);

        paint(bloco.ctx, bloco, { x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y0 + linhas - 1 });
        gasto += largura * linhas;
        blocos += 1;

        if (linhas >= alturaSuja) bloco.sujo = null;
        else s.y0 += linhas; // o resto fica para o próximo quadro
      }

      return blocos;
    },

    get dirtyCount() {
      let n = 0;
      for (const bloco of list) if (bloco.sujo) n += 1;
      return n;
    },

    /** Chama `fn(bloco)` para cada bloco que intersecta o retângulo visível. */
    forEachVisible(x0, y0, x1, y1, fn) {
      const c0 = Math.max(0, Math.floor(x0 / size));
      const c1 = Math.min(cols - 1, Math.floor(x1 / size));
      const r0 = Math.max(0, Math.floor(y0 / size));
      const r1 = Math.min(rows - 1, Math.floor(y1 / size));
      for (let row = r0; row <= r1; row += 1) {
        for (let col = c0; col <= c1; col += 1) fn(list[row * cols + col]);
      }
    },
  };

  return chunks;
}
