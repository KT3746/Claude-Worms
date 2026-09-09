/**
 * Câmera 2D: converte metros (mundo, y para cima) em pixels (tela, y para baixo),
 * com suavização, zoom e tremida de impacto.
 */

export function createCamera() {
  const cam = {
    x: 0, // centro da vista, em metros
    y: 0,
    targetX: 0,
    targetY: 0,
    scale: 20, // pixels por metro
    targetScale: 20,
    width: 800, // tamanho do viewport, em pixels de CSS
    height: 450,
    shake: 0,
    shakeX: 0,
    shakeY: 0,
    smoothing: 6, // maior = mais rápido para alcançar o alvo
    shakeEnabled: true,
    bounds: null, // {minX, maxX, minY, maxY} em metros — limites do mapa

    // Pedaço da tela (em pixels) coberto por HUD e botões de toque, dos
    // quatro lados. `clampToBounds` some com o alvo debaixo do canto do
    // mapa em vez de deixá-lo espremido atrás de um botão: perto da borda,
    // a minhoca ativa é o alvo mais comum de ficar ali (ver `setInsets`).
    insets: { left: 0, right: 0, top: 0, bottom: 0 },

    /** Trava a câmera dentro do mapa. `null` solta de novo. */
    setBounds(bounds) {
      cam.bounds = bounds;
    },

    /**
     * Quanto de cada lado da tela está ocupado por UI por cima do jogo —
     * cruzeta, botões, HUD. Chamado todo quadro com as medidas de verdade
     * do DOM (ver `reservaDosControles` em main.js): eles encolhem e somem
     * junto com a tela e com o toque, uma constante fixa aqui erraria cedo.
     */
    setInsets(insets) {
      Object.assign(cam.insets, insets);
    },

    resize(width, height) {
      cam.width = width;
      cam.height = height;
    },

    /** Define para onde a câmera deve caminhar. */
    lookAt(x, y, scale = cam.targetScale) {
      cam.targetX = x;
      cam.targetY = y;
      cam.targetScale = scale;
    },

    /** Vai direto, sem suavizar (troca de nível, início de tiro). */
    snap(x, y, scale = cam.targetScale) {
      cam.lookAt(x, y, scale);
      cam.x = x;
      cam.y = y;
      cam.scale = scale;
    },

    addShake(amount) {
      if (!cam.shakeEnabled) return;
      cam.shake = Math.min(1.2, cam.shake + amount);
    },

    update(dt) {
      const t = 1 - Math.exp(-cam.smoothing * dt); // suavização estável em qualquer FPS
      cam.x += (cam.targetX - cam.x) * t;
      cam.y += (cam.targetY - cam.y) * t;
      cam.scale += (cam.targetScale - cam.scale) * t;
      clampToBounds();

      cam.shake = Math.max(0, cam.shake - dt * 2.2);
      const magnitude = cam.shake * cam.shake * 14;
      cam.shakeX = (Math.random() * 2 - 1) * magnitude;
      cam.shakeY = (Math.random() * 2 - 1) * magnitude;
    },

    /** Mundo (m) → tela (px). */
    toScreen(x, y) {
      return {
        x: (x - cam.x) * cam.scale + cam.width / 2 + cam.shakeX,
        y: cam.height / 2 - (y - cam.y) * cam.scale + cam.shakeY,
      };
    },

    /** Tela (px) → mundo (m). */
    toWorld(px, py) {
      return {
        x: (px - cam.width / 2 - cam.shakeX) / cam.scale + cam.x,
        y: (cam.height / 2 + cam.shakeY - py) / cam.scale + cam.y,
      };
    },

    /** Metade da largura/altura visível, em metros. */
    get halfWidth() {
      return cam.width / 2 / cam.scale;
    },
    get halfHeight() {
      return cam.height / 2 / cam.scale;
    },
  };

  /**
   * Mantém a vista dentro do mapa. Se o mapa for menor que a tela naquele
   * eixo, centraliza — é melhor ver a borda no meio do que grudada num canto.
   *
   * Perto de uma borda do mapa o alvo (a minhoca ativa, o mais das vezes)
   * seria empurrado até a beirada da tela — que é bem onde moram os botões
   * de toque e o HUD. `insets` encolhe a folga de cada lado por essa mesma
   * medida, então a borda do mapa para ali no botão, não atrás dele: quem
   * estava "na extrema direita" some por trás do painel de armas, não por
   * falta de zoom nem de câmera — falta essa folga.
   */
  function clampToBounds() {
    const b = cam.bounds;
    if (!b) return;

    const meiaL = cam.halfWidth;
    const meiaA = cam.halfHeight;
    const { left, right, top, bottom } = cam.insets;

    const livreEsq = Math.max(0, meiaL - left / cam.scale);
    const livreDir = Math.max(0, meiaL - right / cam.scale);
    // Mundo com y para cima, tela com y para baixo: o topo da tela mostra o
    // maior y do mundo, e o rodapé, o menor.
    const livreCima = Math.max(0, meiaA - top / cam.scale);
    const livreBaixo = Math.max(0, meiaA - bottom / cam.scale);

    if (b.maxX - b.minX <= livreEsq + livreDir) cam.x = (b.minX + b.maxX) / 2;
    else cam.x = Math.max(b.minX + livreEsq, Math.min(b.maxX - livreDir, cam.x));

    if (b.maxY - b.minY <= livreCima + livreBaixo) cam.y = (b.minY + b.maxY) / 2;
    else cam.y = Math.max(b.minY + livreBaixo, Math.min(b.maxY - livreCima, cam.y));
  }

  return cam;
}
