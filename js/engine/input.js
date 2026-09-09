/**
 * Entrada unificada: mouse, toque e teclado viram o mesmo modelo de "ponteiro"
 * mais um conjunto de ações. O jogo nunca fala diretamente com o DOM.
 */

export function createInput(canvas) {
  const pointer = { x: 0, y: 0, down: false, justPressed: false, justReleased: false };
  // Acumula, quadro a quadro, o quanto os dois dedos se afastaram/aproximaram
  // (`fator`, 1 = nada mudou) e o quanto o ponto médio entre eles andou na
  // horizontal (`panX`, em pixels de tela, 0 = nada mudou) desde a última
  // leitura — pinça e arrasto de dois dedos ao mesmo tempo, como em qualquer
  // mapa. `endFrame()` zera os dois de volta, do mesmo jeito que zera
  // `justPressed`/`justReleased`.
  const pinch = { ativo: false, fator: 1, panX: 0 };
  let pinchDistancia = null;
  let pinchMeioX = null;
  const keys = new Set();
  const pressedThisFrame = new Set();

  function positionFrom(event) {
    const rect = canvas.getBoundingClientRect();
    const source = event.touches?.[0] ?? event.changedTouches?.[0] ?? event;
    pointer.x = source.clientX - rect.left;
    pointer.y = source.clientY - rect.top;
  }

  function distanciaEntreToques(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  }

  /**
   * Dois dedos na tela: pinça, não mira. Solta o ponteiro (sem soltar como
   * um "disparar" — nada aqui lê `justReleased` pra isso) pra o segundo dedo
   * não fazer a mira derivar atrás do primeiro enquanto os dois se mexem.
   */
  function atualizarPinca(event) {
    if (event.touches.length < 2) {
      pinch.ativo = false;
      pinchDistancia = null;
      pinchMeioX = null;
      return;
    }
    const distancia = distanciaEntreToques(event.touches);
    const meioX = (event.touches[0].clientX + event.touches[1].clientX) / 2;
    if (pinch.ativo && pinchDistancia > 0) {
      pinch.fator *= distancia / pinchDistancia;
      pinch.panX += meioX - pinchMeioX;
    } else {
      pinch.ativo = true;
      pointer.down = false;
    }
    pinchDistancia = distancia;
    pinchMeioX = meioX;
  }

  function onDown(event) {
    if (event.touches?.length >= 2) {
      atualizarPinca(event);
      if (event.cancelable) event.preventDefault();
      return;
    }
    positionFrom(event);
    if (!pointer.down) pointer.justPressed = true;
    pointer.down = true;
    if (event.cancelable) event.preventDefault();
  }

  function onMove(event) {
    if (event.touches?.length >= 2) {
      atualizarPinca(event);
      if (event.cancelable) event.preventDefault();
      return;
    }
    positionFrom(event);
    if (pointer.down && event.cancelable) event.preventDefault();
  }

  function onUp(event) {
    if (event.touches) atualizarPinca(event); // pode restar 1 dedo (ou 0) — atualiza/encerra a pinça
    positionFrom(event);
    // `touchend`/`mouseup` escutam a janela inteira para não perder o dedo (ou
    // o botão) que sai de cima do canvas no meio do gesto. Mas quem começou o
    // toque num botão do menu não é do jogo: em toque, `preventDefault()` no
    // `touchend` cancela o `click` sintetizado depois dele, e um toque em
    // "Jogar" morria sem nunca virar clique.
    const doJogo = pointer.down;
    if (doJogo) pointer.justReleased = true;
    pointer.down = false;
    if (doJogo && event.cancelable) event.preventDefault();
  }

  canvas.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  canvas.addEventListener('touchstart', onDown, { passive: false });
  canvas.addEventListener('touchmove', onMove, { passive: false });
  window.addEventListener('touchend', onUp, { passive: false });
  window.addEventListener('touchcancel', onUp, { passive: false });

  /** O jogo não escuta teclado enquanto alguém digita num campo. */
  function digitando(event) {
    const alvo = event.target;
    if (!alvo || !alvo.tagName) return false;
    const tag = alvo.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || alvo.isContentEditable;
  }

  window.addEventListener('keydown', (event) => {
    // Não sequestra atalhos do navegador nem a navegação por Tab.
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (digitando(event)) return;
    const code = event.code;
    if (!keys.has(code)) pressedThisFrame.add(code);
    keys.add(code);
    if (HANDLED_KEYS.has(code)) event.preventDefault();
  });

  window.addEventListener('keyup', (event) => keys.delete(event.code));

  // Soltar tudo quando a janela perde o foco evita teclas "grudadas".
  window.addEventListener('blur', () => {
    keys.clear();
    if (pointer.down) pointer.justReleased = true;
    pointer.down = false;
    pinch.ativo = false;
    pinchDistancia = null;
    pinchMeioX = null;
  });

  return {
    pointer,
    pinch,
    isDown: (code) => keys.has(code),
    wasPressed: (code) => pressedThisFrame.has(code),

    /**
     * Botão da tela (toque) empurrando a mesma tecla que o teclado empurraria.
     *
     * Entrar por aqui, e não por um caminho paralelo, é o que faz o dedo
     * herdar de graça tudo que a tecla já sabe fazer: segurar Espaço carrega
     * a força e liga o jetpack, ↑/↓ miram ou encolhem a corda conforme o
     * estado do turno. Nenhuma regra do jogo precisa saber quem apertou.
     */
    setVirtualKey(code, pressionada) {
      if (pressionada) {
        if (!keys.has(code)) pressedThisFrame.add(code);
        keys.add(code);
      } else {
        keys.delete(code);
      }
    },

    /** Solta tudo — ao esconder os controles, pausar ou trocar de tela. */
    releaseAll() {
      keys.clear();
      if (pointer.down) pointer.justReleased = true;
      pointer.down = false;
      pinch.ativo = false;
      pinchDistancia = null;
      pinchMeioX = null;
    },

    /** Chamado ao final de cada quadro para limpar os eventos de borda. */
    endFrame() {
      pointer.justPressed = false;
      pointer.justReleased = false;
      pressedThisFrame.clear();
      pinch.fator = 1;
      pinch.panX = 0;
    },
  };
}

const HANDLED_KEYS = new Set([
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'KeyP',
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyM',
  'Minus',
  'Equal',
  'Backspace',
  'Digit1',
  'Digit2',
  'Digit3',
  'Digit4',
  'Digit5',
  'BracketLeft',
  'BracketRight',
]);
