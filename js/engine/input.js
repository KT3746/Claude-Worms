/**
 * Entrada unificada: mouse, toque e teclado viram o mesmo modelo de "ponteiro"
 * mais um conjunto de ações. O jogo nunca fala diretamente com o DOM.
 */

export function createInput(canvas) {
  const pointer = { x: 0, y: 0, down: false, justPressed: false, justReleased: false };
  const keys = new Set();
  const pressedThisFrame = new Set();

  function positionFrom(event) {
    const rect = canvas.getBoundingClientRect();
    const source = event.touches?.[0] ?? event.changedTouches?.[0] ?? event;
    pointer.x = source.clientX - rect.left;
    pointer.y = source.clientY - rect.top;
  }

  function onDown(event) {
    positionFrom(event);
    if (!pointer.down) pointer.justPressed = true;
    pointer.down = true;
    if (event.cancelable) event.preventDefault();
  }

  function onMove(event) {
    positionFrom(event);
    if (pointer.down && event.cancelable) event.preventDefault();
  }

  function onUp(event) {
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
  });

  return {
    pointer,
    isDown: (code) => keys.has(code),
    wasPressed: (code) => pressedThisFrame.has(code),
    /** Chamado ao final de cada quadro para limpar os eventos de borda. */
    endFrame() {
      pointer.justPressed = false;
      pointer.justReleased = false;
      pressedThisFrame.clear();
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
  'KeyR',
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyN',
  'Backspace',
  'Digit1',
  'Digit2',
  'Digit3',
  'Digit4',
  'Digit5',
  'BracketLeft',
  'BracketRight',
]);
