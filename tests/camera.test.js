/**
 * Câmera: fixação nos limites do mapa e as folgas (`insets`) que HUD e
 * botões de toque reservam.
 *
 * Reproduz o bug relatado: a minhoca ativa perto da borda do mapa era
 * empurrada até a beirada da tela — que é bem onde moram os botões — e
 * sumia atrás deles mesmo "dentro" do campo de visão da câmera.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createCamera } from '../js/engine/camera.js';

/** Câmera de 800×450 travada num mapa de 100×50 m, sem folga nenhuma. */
function cameraDeTeste() {
  const cam = createCamera();
  cam.resize(800, 450);
  cam.setBounds({ minX: 0, maxX: 100, minY: 0, maxY: 50 });
  return cam;
}

test('sem insets, a câmera para exatamente na borda do mapa', () => {
  const cam = cameraDeTeste();
  cam.snap(98, 25, 20); // pede pra olhar quase no fim do mapa (x=98)
  cam.update(0); // clampToBounds roda dentro de update

  const meiaL = cam.halfWidth; // 800/(2*20) = 20 m
  assert.equal(cam.x, 100 - meiaL); // grudou no limite direito do mapa
});

test('inset à direita empurra o centro da câmera pra longe daquela borda', () => {
  const cam = cameraDeTeste();
  cam.setInsets({ right: 160 }); // 160px reservados por um painel de botões
  cam.snap(98, 25, 20);
  cam.update(0);

  const meiaL = cam.halfWidth;
  const folga = 160 / cam.scale; // 160px em metros, na escala atual
  // O limite direito agora é mais curto: o alvo para de avançar mais cedo,
  // sobrando exatamente `folga` metros de mapa visível além do que ele vê.
  assert.equal(cam.x, 100 - meiaL + folga);

  // A minhoca (ou o que a câmera está seguindo) não fica atrás do botão: a
  // borda do mapa projeta na tela dentro da área reservada, não além dela.
  const bordaNaTela = cam.toScreen(100, 25).x;
  assert.ok(bordaNaTela <= cam.width - 160 + 1e-9);
});

test('inset à esquerda faz o mesmo perto da outra borda', () => {
  const cam = cameraDeTeste();
  cam.setInsets({ left: 140 });
  cam.snap(2, 25, 20);
  cam.update(0);

  const meiaL = cam.halfWidth;
  const folga = 140 / cam.scale;
  assert.equal(cam.x, meiaL - folga);
});

test('insets verticais respeitam que o topo da tela é o maior y do mundo', () => {
  const cam = cameraDeTeste();
  cam.setInsets({ top: 100 }); // HUD (placar, relógio) no topo da tela
  cam.snap(50, 48, 20); // quase no topo do mapa (y alto)
  cam.update(0);

  const meiaA = cam.halfHeight;
  const folga = 100 / cam.scale;
  assert.equal(cam.y, 50 - meiaA + folga);
});

test('longe das bordas, insets não mudam nada — só entram perto do limite', () => {
  const cam = cameraDeTeste();
  cam.setInsets({ left: 200, right: 200, top: 200, bottom: 200 });
  cam.snap(50, 25, 20); // bem no meio do mapa
  cam.update(0);

  assert.equal(cam.x, 50);
  assert.equal(cam.y, 25);
});

test('mapa menor que a tela continua centralizando mesmo com insets moderados', () => {
  const cam = createCamera();
  cam.resize(800, 450);
  cam.setBounds({ minX: 0, maxX: 30, minY: 0, maxY: 50 }); // mapa mais estreito que a tela (meiaL=20 ⇒ 40 m)
  cam.setInsets({ left: 50, right: 50 }); // folga ainda sobra mesmo tirando o inset
  cam.snap(28, 25, 20);
  cam.update(0);

  assert.equal(cam.x, 15); // (0+30)/2 — cai no ramo "centraliza", sem travar numa borda
});

test('setInsets é incremental: só mexe nos lados passados', () => {
  const cam = cameraDeTeste();
  cam.setInsets({ right: 160 });
  cam.setInsets({ left: 140 });
  assert.deepEqual(cam.insets, { left: 140, right: 160, top: 0, bottom: 0 });
});
