/**
 * O terreno do jogo: embrulha a máscara (pixels, y para baixo) e expõe tudo
 * em coordenadas de mundo (metros, y para cima), que é como o resto do jogo
 * e a câmera pensam. Toda a conversão entre os dois espaços mora aqui.
 *
 * Também cuida do desenho: a máscara é pintada em blocos, e uma explosão só
 * suja os blocos que toca.
 */

import { createChunks } from '../engine/chunks.js';
import {
  at, solidAt, carveCircle, fillRect, regrowGrass, circleHits, raycast, normalAt,
  AR, TERRA, GRAMA, ROCHA,
} from './mask.js';

const TAMANHO_BLOCO = 512;

/** Ruído estável por pixel: repintar o mesmo bloco dá sempre o mesmo grão. */
function grao(x, y) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function createTerrain({ mask, alturas, nivelAgua, nascimentos, ppm }) {
  const larguraMundo = mask.width / ppm;
  const alturaMundo = mask.height / ppm;

  // ------------------------------------------------------- conversões

  const mx = (wx) => wx * ppm;
  const my = (wy) => mask.height - wy * ppm;
  const wx = (px) => px / ppm;
  const wy = (py) => (mask.height - py) / ppm;

  // ---------------------------------------------------------- pintura

  /**
   * Pinta apenas a região `area` (local ao bloco) a partir da máscara.
   *
   * Repintar o bloco inteiro a cada explosão custava um quadro perdido: uma
   * cratera suja ~130 × 130 px, e o bloco tem 512 × 512.
   */
  function pintarBloco(ctx, bloco, area) {
    const largura = area.x1 - area.x0 + 1;
    const altura = area.y1 - area.y0 + 1;
    if (largura <= 0 || altura <= 0) return;

    const img = ctx.createImageData(largura, altura);
    const d = img.data;

    for (let y = 0; y < altura; y += 1) {
      const py = bloco.y + area.y0 + y;
      for (let x = 0; x < largura; x += 1) {
        const px = bloco.x + area.x0 + x;
        const material = mask.data[py * mask.width + px];
        const i = (y * largura + x) * 4;

        const n = grao(px, py);

        if (material === AR) {
          // Ar ACIMA da linha original do relevo é céu; abaixo dela é o fundo
          // do subsolo. É o que faz uma caverna parecer caverna, e não um
          // buraco recortado no morro mostrando o céu do outro lado.
          const superficie = alturas[px] ?? 0;
          if (py <= superficie) {
            d[i + 3] = 0;
            continue;
          }
          const fundura = Math.min(1, (py - superficie) / (mask.height * 0.5));
          const v = (0.62 - fundura * 0.3) * (0.9 + n * 0.2);
          d[i] = 92 * v;
          d[i + 1] = 63 * v;
          d[i + 2] = 46 * v;
          d[i + 3] = 255;
          continue;
        }
        let r;
        let g;
        let b;

        if (material === GRAMA) {
          // Verde mais claro no topo da casca, escurecendo para baixo.
          const acima = at(mask, px, py - 1) === AR ? 1 : 0;
          r = 104 + n * 26 + acima * 22;
          g = 152 + n * 30 + acima * 26;
          b = 62 + n * 22 + acima * 14;
        } else if (material === ROCHA) {
          const v = 0.82 + n * 0.36;
          r = 74 * v;
          g = 82 * v;
          b = 96 * v;
        } else {
          // Terra: escurece com a profundidade e ganha faixas de estrato.
          const profundidade = Math.min(1, (py - (alturas[px] ?? 0)) / (mask.height * 0.55));
          const estrato = Math.sin(py * 0.055) * 0.07 + Math.sin(py * 0.011 + px * 0.002) * 0.05;
          const v = (1 - profundidade * 0.42 + estrato) * (0.88 + n * 0.26);
          r = 150 * v;
          g = 101 * v;
          b = 62 * v;
        }

        d[i] = r;
        d[i + 1] = g;
        d[i + 2] = b;
        d[i + 3] = 255;
      }
    }

    // `putImageData` substitui os pixels (não compõe), então o transparente
    // do céu apaga corretamente o que havia ali antes da explosão.
    ctx.putImageData(img, area.x0, area.y0);
  }

  const blocos = createChunks({
    width: mask.width,
    height: mask.height,
    size: TAMANHO_BLOCO,
    paint: pintarBloco,
  });

  // ------------------------------------------------------------- API

  const terreno = {
    mask,
    ppm,
    alturas,
    largura: larguraMundo,
    altura: alturaMundo,
    /** Linha d'água, em metros. Sobe na morte súbita. */
    nivelAgua: wy(nivelAgua),
    nascimentos: nascimentos.map((p) => ({ x: wx(p.x), y: wy(p.y) })),

    paraMascara: (x, y) => ({ x: mx(x), y: my(y) }),
    paraMundo: (x, y) => ({ x: wx(x), y: wy(y) }),

    solidoEm: (x, y) => solidAt(mask, mx(x), my(y)),
    materialEm: (x, y) => at(mask, mx(x), my(y)),

    /** Há terreno dentro de um círculo de raio `r` metros? */
    circuloBate: (x, y, r) => circleHits(mask, mx(x), my(y), r * ppm),

    /** Primeiro ponto sólido do segmento, em metros. */
    raio(x0, y0, x1, y1) {
      const hit = raycast(mask, mx(x0), my(y0), mx(x1), my(y1));
      if (!hit) return null;
      return { x: wx(hit.x), y: wy(hit.y), material: hit.material, t: hit.t };
    },

    /** Normal da superfície em coordenadas de mundo (y para cima). */
    normalEm(x, y, r = 0.3) {
      const n = normalAt(mask, mx(x), my(y), Math.max(2, r * ppm));
      return { x: n.x, y: -n.y };
    },

    /** Superfície logo abaixo (ou acima) de uma coluna, em metros. */
    superficieEm(x) {
      const px = Math.max(0, Math.min(mask.width - 1, Math.round(mx(x))));
      let py = 0;
      while (py < mask.height && at(mask, px, py) === AR) py += 1;
      return wy(py);
    },

    /** Abre uma cratera de raio `r` metros e suja os blocos afetados. */
    explodir(x, y, r) {
      const rect = carveCircle(mask, mx(x), my(y), r * ppm);
      if (!rect) return false;
      blocos.markRect(rect.x0, rect.y0, rect.x1, rect.y1);
      return true;
    },

    /**
     * Constrói um bloco sólido de `largura` × `altura` metros centrado em
     * (x, y) — é o que a viga vira ao assentar. Ganha casca de grama igual a
     * qualquer outro terreno novo, para não destoar visualmente.
     */
    construir(x, y, largura, altura) {
      const x0 = mx(x - largura / 2);
      const x1 = mx(x + largura / 2);
      const y0 = my(y + altura / 2);
      const y1 = my(y - altura / 2);
      const rect = fillRect(mask, x0, y0, x1, y1, TERRA);
      regrowGrass(mask, { ...rect, y1: rect.y1 + 4 });
      blocos.markRect(rect.x0, rect.y0, rect.x1, rect.y1 + 4);
      return rect;
    },

    /**
     * Repinta blocos sujos, no máximo `max` por quadro. A máscara já está
     * correta para a física antes disso — o limite só espalha o custo do
     * desenho, nunca atrasa a colisão.
     */
    repintar(max = 2) {
      return blocos.repaint(max);
    },

    /**
     * Pinta o mapa inteiro de uma vez. Chamado uma única vez, ainda na tela
     * de carregamento, para que nenhum quadro de jogo pague por isso.
     */
    repintarTudo() {
      blocos.repaint(Infinity);
    },

    get blocosSujos() {
      return blocos.dirtyCount;
    },

    /** Blit dos blocos visíveis. */
    desenhar(ctx, camera) {
      const k = camera.scale / ppm; // pixels de tela por pixel de máscara
      const x0 = mx(camera.x - camera.halfWidth) - 2;
      const x1 = mx(camera.x + camera.halfWidth) + 2;
      const y0 = my(camera.y + camera.halfHeight) - 2;
      const y1 = my(camera.y - camera.halfHeight) + 2;

      blocos.forEachVisible(x0, y0, x1, y1, (bloco) => {
        const canto = camera.toScreen(wx(bloco.x), wy(bloco.y));
        ctx.drawImage(
          bloco.canvas,
          Math.round(canto.x),
          Math.round(canto.y),
          Math.ceil(bloco.width * k) + 1,
          Math.ceil(bloco.height * k) + 1,
        );
      });
    },
  };

  return terreno;
}

export { AR, TERRA, GRAMA, ROCHA };
