/**
 * Sistema de partículas com pool fixo — nada de alocar objetos a cada quadro.
 * Coordenadas em metros, no mesmo espaço do mundo.
 */

const MAX = 1200;

export function createParticles() {
  const pool = Array.from({ length: MAX }, () => ({
    active: false,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    life: 0,
    maxLife: 1,
    size: 0.05,
    color: '#fff',
    gravity: 6,
    drag: 1.2,
    aditivo: false,
    encolhe: false,
  }));
  let cursor = 0;

  function spawn(options) {
    // Se o pool estiver cheio, reaproveita a partícula mais antiga.
    for (let i = 0; i < MAX; i += 1) {
      const p = pool[cursor];
      cursor = (cursor + 1) % MAX;
      if (!p.active) return init(p, options);
    }
    return init(pool[cursor], options);
  }

  function init(p, o) {
    p.active = true;
    p.x = o.x;
    p.y = o.y;
    p.vx = o.vx ?? 0;
    p.vy = o.vy ?? 0;
    p.maxLife = o.life ?? 0.6;
    p.life = p.maxLife;
    p.size = o.size ?? 0.05;
    p.color = o.color ?? '#ffffff';
    p.gravity = o.gravity ?? 6;
    p.drag = o.drag ?? 1.2;
    // `aditivo`: soma luz em vez de pintar por cima (fogo, faíscas) — as
    // partículas se sobrepondo ficam mais claras, como luz de verdade.
    // `encolhe`: o raio diminui junto com a vida (brasas se apagando).
    p.aditivo = o.aditivo === true;
    p.encolhe = o.encolhe === true;
    return p;
  }

  return {
    spawn,

    update(dt) {
      for (const p of pool) {
        if (!p.active) continue;
        p.life -= dt;
        if (p.life <= 0) {
          p.active = false;
          continue;
        }
        p.vy -= p.gravity * dt;
        const damping = Math.max(0, 1 - p.drag * dt);
        p.vx *= damping;
        p.vy *= damping;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
    },

    draw(ctx, camera) {
      // Duas passadas: as normais (fumaça, terra) e depois as de luz por
      // cima, com mistura aditiva — trocar o modo por partícula custaria caro.
      for (const aditivas of [false, true]) {
        if (aditivas) ctx.globalCompositeOperation = 'lighter';
        for (const p of pool) {
          if (!p.active || p.aditivo !== aditivas) continue;
          const vida = p.life / p.maxLife;
          const alpha = Math.max(0, Math.min(1, vida));
          const screen = camera.toScreen(p.x, p.y);
          const radius = Math.max(0.6, p.size * camera.scale * (p.encolhe ? 0.3 + vida * 0.7 : 1));
          ctx.globalAlpha = alpha;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    },

    clear() {
      for (const p of pool) p.active = false;
    },
  };
}
