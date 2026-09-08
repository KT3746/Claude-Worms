/**
 * Loop principal com passo de tempo fixo.
 *
 * A física roda sempre em passos iguais (determinística, independente do FPS)
 * e o render recebe `alpha` para interpolar entre o passo anterior e o atual.
 */

const MAX_FRAME = 0.25; // s — evita "espiral da morte" ao voltar de uma aba oculta

export function createLoop({ beginFrame, step, render, endFrame, dt }) {
  let running = false;
  let accumulator = 0;
  let last = 0;
  let frameId = 0;
  let timeScale = 1;

  function frame(now) {
    if (!running) return;
    frameId = requestAnimationFrame(frame);

    const elapsed = Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    accumulator += elapsed * timeScale;

    // Eventos discretos (clique, tecla) são tratados uma vez por quadro,
    // antes dos passos de física, e limpos depois do render.
    beginFrame?.(elapsed);

    let steps = 0;
    while (accumulator >= dt && steps < 240) {
      step(dt);
      accumulator -= dt;
      steps += 1;
    }

    render(accumulator / dt, elapsed);
    endFrame?.();
  }

  return {
    start() {
      if (running) return;
      running = true;
      last = performance.now();
      accumulator = 0;
      frameId = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(frameId);
    },
    get running() {
      return running;
    },
    /** Câmera lenta: 1 = normal, 0.25 = quatro vezes mais lento. */
    setTimeScale(value) {
      timeScale = Math.max(0.05, Math.min(1, value));
    },
    get timeScale() {
      return timeScale;
    },
  };
}
