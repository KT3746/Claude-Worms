/**
 * Controles de tela para quem joga no dedo.
 *
 * Cada botão empurra a *mesma tecla* que o teclado empurraria
 * (`input.setVirtualKey`), em vez de chamar os comandos da partida direto.
 * É o que faz o dedo herdar de graça toda a mecânica que já existe: segurar
 * FOGO carrega a força, liga o jetpack e solta a corda exatamente como
 * segurar Espaço, e ▲▼ miram ou encolhem a corda conforme a fase do turno.
 * Nenhuma regra do jogo precisa saber se quem apertou foi um dedo.
 *
 * A escolha de arma foge dessa regra por um motivo: no teclado ela é `[` e
 * `]` percorrendo a lista, o que no dedo viraria uma dúzia de toques. Aqui
 * vira uma folha com o arsenal inteiro, que fala com a partida direto.
 */

import { ARMAS } from '../weapons.js';
import { sfx } from '../../engine/audio.js';

/**
 * O teclado virtual da tela. `Space` é o botão grande porque é ele que atira,
 * prende a corda, liga o jetpack e teleporta — no teclado também é uma tecla só.
 */
const BOTOES = [
  { tecla: 'ArrowUp', rotulo: '▲', classe: 'tc-mira', area: 'cima', aria: 'Mirar para cima' },
  { tecla: 'ArrowLeft', rotulo: '◀', classe: 'tc-anda', area: 'esq', aria: 'Andar para a esquerda' },
  { tecla: 'ArrowRight', rotulo: '▶', classe: 'tc-anda', area: 'dir', aria: 'Andar para a direita' },
  { tecla: 'ArrowDown', rotulo: '▼', classe: 'tc-mira', area: 'baixo', aria: 'Mirar para baixo' },
];

const ACOES = [
  { tecla: 'Backspace', rotulo: '↺', classe: 'tc-pequeno', aria: 'Cambalhota para trás' },
  { tecla: 'Enter', rotulo: '↷', classe: 'tc-pequeno', aria: 'Pular' },
];

export function createTouchControls(root, { input, acoes }) {
  let visivel = false;
  let arsenalAberto = false;
  let armaAtual = null;
  let pavioAtual = null;

  root.innerHTML = '';
  root.hidden = true;

  // ------------------------------------------------------------- montagem

  const cruz = el('div', 'tc-cruz');
  for (const def of BOTOES) cruz.append(botaoDeTecla(def));

  const direita = el('div', 'tc-direita');
  const linhaPequena = el('div', 'tc-linha');
  for (const def of ACOES) linhaPequena.append(botaoDeTecla(def));

  const botaoArma = el('button', 'tc-btn tc-arma');
  botaoArma.type = 'button';
  botaoArma.setAttribute('aria-label', 'Escolher arma');
  botaoArma.addEventListener('click', () => {
    sfx.click();
    arsenal(!arsenalAberto);
  });

  const fogo = botaoDeTecla({
    tecla: 'Space',
    rotulo: 'FOGO',
    classe: 'tc-fogo',
    aria: 'Atirar: segure para dar força e solte',
  });

  direita.append(linhaPequena, botaoArma, fogo);

  const folha = el('div', 'tc-folha');
  folha.hidden = true;
  const grade = el('div', 'tc-grade');
  const botoesDeArma = new Map();
  for (const arma of ARMAS) {
    if (arma.oculta) continue;
    const b = el('button', 'tc-arma-opcao', arma.nome);
    b.type = 'button';
    b.addEventListener('click', () => {
      sfx.click();
      acoes.trocarArma(arma.id);
      arsenal(false);
    });
    botoesDeArma.set(arma.id, b);
    grade.append(b);
  }

  // O pavio (1 a 5) só existe para granada e fragmentação; some para o resto.
  const linhaPavio = el('div', 'tc-pavio');
  linhaPavio.append(el('span', 'tc-pavio-rotulo', 'Pavio'));
  const botoesDePavio = new Map();
  for (let n = 1; n <= 5; n += 1) {
    const b = el('button', 'tc-pavio-opcao', `${n}s`);
    b.type = 'button';
    b.addEventListener('click', () => {
      sfx.click();
      acoes.ajustarPavio(n);
    });
    botoesDePavio.set(n, b);
    linhaPavio.append(b);
  }

  folha.append(grade, linhaPavio);
  root.append(cruz, direita, folha);

  // Toque longo num botão abriria o menu de contexto do navegador por cima
  // do jogo — e num jogo em que segurar o botão *é* o comando, isso acontece
  // o tempo todo.
  root.addEventListener('contextmenu', (e) => e.preventDefault());

  // ------------------------------------------------------ botões de tecla

  /**
   * Um botão que segura uma tecla enquanto o dedo estiver nele.
   *
   * Usa Pointer Events com captura: cada dedo vira um `pointerId` próprio (dá
   * para andar e atirar ao mesmo tempo, com dois dedos), e a captura garante
   * que o botão receba o `pointerup` mesmo se o dedo escorregar para fora
   * antes de levantar — sem isso a tecla ficaria grudada.
   */
  function botaoDeTecla({ tecla, rotulo, classe, area, aria }) {
    const b = el('button', `tc-btn ${classe}`, rotulo);
    b.type = 'button';
    if (area) b.style.gridArea = area; // as áreas da cruz vêm de BOTOES
    if (aria) b.setAttribute('aria-label', aria);
    const dedos = new Set();

    function soltar(event) {
      if (!dedos.delete(event.pointerId)) return;
      if (dedos.size === 0) {
        input.setVirtualKey(tecla, false);
        b.classList.remove('tc-apertado');
      }
    }

    b.addEventListener('pointerdown', (event) => {
      // Impede o foco, a seleção de texto e o clique sintetizado depois.
      event.preventDefault();
      if (dedos.size === 0) {
        input.setVirtualKey(tecla, true);
        b.classList.add('tc-apertado');
      }
      dedos.add(event.pointerId);
      // A captura é um reforço, não um requisito: se o navegador recusar
      // (o ponteiro já sumiu, por exemplo), o botão ainda funciona pelos
      // eventos normais — mas cair aqui não pode derrubar o toque.
      try {
        b.setPointerCapture?.(event.pointerId);
      } catch {
        /* sem captura, tudo bem */
      }
    });

    b.addEventListener('pointerup', soltar);
    b.addEventListener('pointercancel', soltar);
    return b;
  }

  // --------------------------------------------------------------- estado

  function arsenal(abrir) {
    arsenalAberto = abrir;
    folha.hidden = !abrir;
    botaoArma.classList.toggle('tc-aberto', abrir);
    botaoArma.setAttribute('aria-expanded', String(abrir));
  }

  const controles = {
    get visivel() {
      return visivel;
    },

    get arsenalAberto() {
      return arsenalAberto;
    },

    mostrar() {
      visivel = true;
      root.hidden = false;
    },

    esconder() {
      visivel = false;
      root.hidden = true;
      arsenal(false);
      // Some no meio de um toque (pausa, fim de partida): sem isto a tecla
      // segurada nunca receberia o `pointerup` e ficaria presa para sempre.
      input.releaseAll();
      for (const b of root.querySelectorAll('.tc-apertado')) b.classList.remove('tc-apertado');
    },

    /** Espelha no botão de arma e na folha o que a partida está usando agora. */
    atualizar(partida) {
      if (!visivel || !partida) return;
      const { arma, pavio } = partida.estado;

      if (arma.id !== armaAtual) {
        armaAtual = arma.id;
        botaoArma.textContent = arma.nome;
        for (const [id, b] of botoesDeArma) {
          const ativa = id === arma.id;
          b.classList.toggle('ativa', ativa);
          b.setAttribute('aria-pressed', String(ativa));
        }
        linhaPavio.hidden = !arma.ajustavel;
      }

      if (pavio !== pavioAtual) {
        pavioAtual = pavio;
        for (const [n, b] of botoesDePavio) {
          const ativo = n === pavio;
          b.classList.toggle('ativa', ativo);
          b.setAttribute('aria-pressed', String(ativo));
        }
      }
    },
  };

  return controles;
}

function el(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
